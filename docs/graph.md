# Graph Memory / Graph RAG

Substrata now includes an auxiliary Graph Memory index that enriches retrieval by understanding relationships between footprints, memories, files, decisions, and concepts. The graph is built alongside the existing FTS index and surfaces related context that keyword search alone would miss.

## Overview

The graph is an **auxiliary SQLite index** stored at `.substrata/index/graph.sqlite` and built alongside the FTS index — FTS is never replaced or removed. Key properties:

- **Zero setup**: SQLite, no external dependencies, `.substrata/index/` is gitignored
- **Fail-open**: if the graph is missing, stale, or corrupt, queries degrade gracefully to pure FTS
- **Incremental**: `graph.enabled` and `search.hybrid_graph` can be toggled in config; workflows without graph behave identically
- **Additive**: hybrid retrieval always preserves FTS seed results; graph relations surface additional context

## Node Kinds

Nodes represent typed entities extracted from footprints and memory documents:

| Kind              | Meaning                   | Node ID Format              |
| ----------------- | ------------------------- | --------------------------- |
| `footprint`       | A footprint document      | `footprint:fp_20260609_...` |
| `memory`          | A memory document         | `memory:mem_20260609_...`   |
| `file`            | A file path touched       | `file:src/api/auth.ts`      |
| `tag`             | A topic tag               | `tag:authentication`        |
| `decision`        | An architecture decision  | `decision:use_oauth2`       |
| `rejected_option` | An alternative considered | `rejected_option:use_saml`  |
| `concept`         | A keyword or phrase       | `concept:token_refresh`     |
| `actor`           | An agent/author           | `actor:claude-code`         |

All node IDs follow the format `${kind}:${key}`, where the key is deterministic and extracted from the footprint content.

## Edge Relations

Directed edges connect nodes with weighted relations. Higher weights indicate stronger signals:

| Relation       | Meaning                        | Weight | Notes                                                   |
| -------------- | ------------------------------ | ------ | ------------------------------------------------------- |
| `TOUCHES_FILE` | Footprint mentions a file      | 1      | Direct connection between footprint and file nodes      |
| `HAS_TAG`      | Footprint has a topic tag      | 1      | Direct connection between footprint and tag             |
| `HAS_DECISION` | Footprint records a decision   | 1      | Direct connection between footprint and decision        |
| `REJECTED`     | Footprint rejects an option    | 1      | Direct connection between footprint and rejected option |
| `MENTIONS`     | Footprint mentions a concept   | 0.6–1  | Phrase concepts (1), token concepts (0.6)               |
| `AUTHORED_BY`  | Footprint authored by an actor | 1      | Direct connection between footprint and actor           |
| `SUPERSEDES`   | Footprint replaces another     | 3      | **Strongest signal** — memory evolution                 |

**RELATED_TO** is **not materialized** as an edge. Instead, it is derived at query time through shared intermediate nodes (file, tag, decision, concept). This keeps the graph lightweight and avoids dense, low-signal hubs.

## Hybrid Retrieval

When both FTS and graph are enabled, queries follow this flow:

```
Query
  ↓
FTS Search → Top Footprints (seeds)
  ↓
Graph Expansion (via shared files/tags/decisions/concepts)
  ↓
Related Memories (graph-surfaced docs)
  ↓
Re-rank (consider distance, bridge strength, recency, status)
  ↓
Context
```

### Hybrid Retrieval Properties

1. **FTS seeds are never dropped**: keyword matches always lead the ranked list
2. **Graph expansion is additive**: only surfaces docs not already matched by FTS
3. **Fail-open**: if graph is unavailable, returns pure FTS results
4. **Distance decay**: footprints reachable through more hops score lower
5. **Bridge strength weights**:
   - `supersedes`: 1.5 (memory evolution)
   - `file`: 1 (structural co-location)
   - `decision`: 0.9 (domain alignment)
   - `concept`: 0.7 (semantic connection)
   - `tag`: 0.5 (loose topical link)

## Graph-Aware Context Sections

The `graph context` command renders enriched context with five sections:

1. **Relevant Memories** — top retrieved footprints/memories, each with a "Why selected" line explaining the connection (e.g., "matched query", "shares file X", "supersedes a matched memory")
2. **Related Decisions** — aggregated architecture decisions from the retrieved set
3. **Rejected Alternatives** — options considered and rejected in the retrieved footprints
4. **Related Files** — files connected via graph bridges or touched by retrieved footprints
5. **Related Concepts** — keywords/phrases mentioned in related footprints

Sections are emitted in priority order within a token budget (approximated as `chars / 3.5`), so tight budgets preserve Relevant Memories and trim the rest.

## CLI Commands

All graph commands support `--json` for machine-readable output and degrade gracefully if the graph is missing.

### Build or rebuild the graph index

```bash
substrata graph build
```

Outputs node and edge counts:

```
Graph index built (247 nodes, 892 edges).
```

### Find graph-related records

```bash
substrata graph related <target> [options]
```

Find footprints/memories related to a footprint id or file path. The command auto-detects file paths (containing `/` or file extensions) but can be forced with `--id` or `--file`.

**Example: find memories related to a file**

```bash
substrata graph related src/auth/token.ts
```

Output:

```
Graph-related to src/auth/token.ts (3):

1. Add token refresh flow  [score 2.15]
   via shared file src/auth/token.ts
   Source: .substrata/footprints/2026/06/2026-06-10-add-token-refresh-...md

2. Implement OAuth2 strategy  [score 1.92]
   via shared decision use_oauth2; shared concept token_refresh
   Source: .substrata/footprints/2026/06/2026-06-09-oauth2-strategy-...md

3. Deprecate SAML integration  [score 1.45]
   via supersedes link
   Source: .substrata/footprints/2026/06/2026-06-08-deprecate-saml-...md
```

**Options**

- `--file` — force treating target as a file path
- `--id` — force treating target as a footprint id
- `--limit <n>` — max results (default: config `search.default_limit`)
- `--exclude-superseded` — drop superseded/deprecated records
- `--json` — output as JSON

### Explain graph paths

```bash
substrata graph explain <from> [to]
```

When given one id, shows that record's related connections. When given two ids, shows the shortest graph path between them.

**Example: explain relations of one footprint**

```bash
substrata graph explain fp_20260610_add_token_refresh_abc123
```

**Example: explain why two footprints are connected**

```bash
substrata graph explain fp_20260610_add_token_refresh_abc123 fp_20260609_oauth2_strategy_def456
```

Output:

```
Graph path from fp_20260610_... to fp_20260609_...:

  Add token refresh flow (footprint)
    ──HAS_TAG──▶ token_refresh (concept)
    ──HAS_DECISION──▶ use_oauth2 (decision)
    ──HAS_DECISION──▶ Implement OAuth2 strategy (footprint)
```

**Options**

- `--json` — output as JSON

### Report graph statistics

```bash
substrata graph stats
```

Shows node/edge counts by kind and relation, plus most-connected records:

```
Graph index stats (built 2026-06-27T15:42:03Z):

Nodes: 247
  footprint         89
  memory            12
  file              64
  tag               35
  decision          28
  concept           19
  ...

Edges: 892
  TOUCHES_FILE      156
  HAS_TAG           184
  HAS_DECISION       76
  MENTIONS          312
  SUPERSEDES         12
  ...

Most connected:
  1. authentication (tag) — degree 28
  2. src/auth/token.ts (file) — degree 24
  3. use_oauth2 (decision) — degree 18
```

**Options**

- `--json` — output as JSON

### Graph-aware context for an agent

```bash
substrata graph context <task> [options]
```

Retrieve enriched, source-linked context for an agent task, combining FTS and graph. Outputs the five context sections and sources (sources are also returned in JSON if `--json` is used).

**Example**

```bash
substrata graph context "Add two-factor authentication to the login flow"
```

Output:

```
Relevant Substrata context (graph-aware):

Relevant Memories:
1. Implement OAuth2 strategy
   Why selected: matched "authentication"
   Source: .substrata/footprints/2026/06/2026-06-09-oauth2-strategy-...md

2. Add token refresh flow
   Why selected: shares decision use_oauth2 with a matched memory
   Source: .substrata/footprints/2026/06/2026-06-10-add-token-refresh-...md

Related Decisions:
- Use OAuth2 for third-party auth (from Implement OAuth2 strategy)
- Cache refresh tokens in Redis (from Add token refresh flow)

Related Files:
- src/auth/oauth2.ts
- src/auth/token.ts
- tests/auth.test.ts

Related Concepts:
- token_refresh, session_management, third_party_auth
```

**Options**

- `--max-tokens <n>` — approximate token budget (chars/3.5), default from config
- `--files <path>` — bias toward docs touching this file (repeatable)
- `--no-auto-index` — skip auto-rebuilding a stale/missing index
- `--json` — output as `{ context, sources }`

## Integration with `substrata index`

The main `index` command now builds both FTS and graph:

```bash
substrata index
```

Output:

```
Index built (FTS + graph).
```

To skip graph building (e.g., if disabled in config or for performance):

```bash
substrata index --no-graph
```

## MCP Tools

Four new MCP tools mirror the CLI subcommands so agents can use the same interface across any MCP-capable editor:

### `substrata_graph_context`

Retrieve enriched graph-aware context.

**Input**

```json
{
  "task": "string (required) — What the agent is about to do",
  "files": ["string (optional) — Files the task will touch"],
  "maxTokens": "number (optional) — Token budget; defaults to config max_context_tokens"
}
```

**Output**

```json
{
  "context": "string — formatted context block with sections",
  "sources": [
    {
      "id": "string",
      "title": "string",
      "filePath": "string",
      "origin": "fts | graph"
    }
  ]
}
```

### `substrata_graph_related`

Find records graph-related to a footprint id or file path.

**Input**

```json
{
  "target": "string (required) — Footprint id or file path",
  "file": "boolean (optional) — Force treating target as a file path",
  "limit": "number (optional) — Max results",
  "excludeSuperseded": "boolean (optional) — Drop superseded/deprecated records"
}
```

**Output**

```json
{
  "results": [
    {
      "ref": "string",
      "label": "string",
      "filePath": "string",
      "score": "number",
      "bridges": [
        {
          "kind": "file | tag | decision | concept | supersedes",
          "label": "string",
          "weight": "number"
        }
      ]
    }
  ]
}
```

### `substrata_graph_explain`

Explain WHY two records are connected, or list relations of one.

**Input**

```json
{
  "from": "string (required) — Footprint id",
  "to": "string (optional) — Target footprint id for shortest-path query"
}
```

**Output** (when `to` is provided)

```json
{
  "path": {
    "found": "boolean",
    "path": [
      {
        "node": { "kind": "string", "label": "string" },
        "rel": "string (optional)"
      }
    ]
  }
}
```

**Output** (when `to` is omitted — lists relations)

```json
{
  "related": [
    {
      "ref": "string",
      "label": "string",
      "filePath": "string",
      "score": "number",
      "bridges": [...]
    }
  ]
}
```

### `substrata_graph_stats`

Report graph node/edge counts and most-connected records.

**Input**

```json
{
  "topN": "number (optional) — How many most-connected records to list"
}
```

**Output**

```json
{
  "totalNodes": "number",
  "nodesByKind": { "footprint": 89, "file": 64, ... },
  "totalEdges": "number",
  "edgesByRelation": { "TOUCHES_FILE": 156, "HAS_TAG": 184, ... },
  "builtAt": "string (ISO 8601 timestamp)",
  "topConnected": [
    {
      "kind": "string",
      "label": "string",
      "degree": "number"
    }
  ]
}
```

The five original MCP tools (`substrata_search`, `substrata_context`, `substrata_add`, `substrata_related_to_file`, `substrata_list_recent`) remain unchanged.

## Configuration

Graph settings live in `.substrata/config.yml` under two blocks:

```yaml
search:
  # Master switch for hybrid retrieval (FTS + graph)
  hybrid_graph: true

graph:
  # Enable the graph index
  enabled: true

  # How many hops to expand from FTS seeds
  expansion_depth: 1

  # Max nodes to visit during expansion (circuit-breaker)
  max_nodes: 40

  # Max edges to follow during expansion (circuit-breaker)
  max_edges: 80
```

### Configuration Reference

- **`search.hybrid_graph`** — When true, the `graph context` command and the prompt-submit hook expand FTS seeds through the graph; when false, they degrade to FTS-only. The plain `substrata context` command and `substrata_context` MCP tool are unaffected (always FTS). Default: `true`
- **`graph.enabled`** — When true, graph index is built and used by hybrid retrieval. When false, graph commands fail gracefully and hybrid search degrades to FTS. Default: `true`
- **`graph.expansion_depth`** — Number of hops to explore from each FTS seed footprint. Depth 1 reaches direct neighbors only. Depth 2 reaches neighbors-of-neighbors. Higher depths risk dense, low-signal expansion. Default: `1`
- **`graph.max_nodes`** — Hard cap on nodes visited during expansion. Prevents runaway traversals in highly connected graphs. Default: `40`
- **`graph.max_edges`** — Hard cap on edges traversed during expansion. Prevents runaway traversals. Default: `80`

## Hook Integration

The Claude Code `UserPromptSubmit` hook now prefers graph-aware context when conditions are met:

1. `graph.enabled === true` AND `search.hybrid_graph === true`
   → Use `substrata graph context`
2. Graph unavailable or disabled
   → Fall back to `substrata context` (FTS-only)
3. No context available
   → Skip injection (fail-open)

This is automatic and requires no configuration. Agents receive richer context without changing their workflows.

## Design Principles

The graph implementation adheres to these core principles:

1. **Keep FTS; add graph as auxiliary** — The graph never replaces FTS. Keyword matching remains the baseline.

2. **Zero setup with SQLite** — No external database, embedding service, or migration. The index lives in `.substrata/index/` and is gitignored.

3. **Identical CLI + MCP interface** — Any agent (Claude Code, Cursor, Codex, OpenAI agents, Gemini CLI) uses the same tools and commands.

4. **Fail-open, incremental adoption** — If the graph is missing or corrupt, queries degrade gracefully. Graph can be disabled at any time without breaking workflows.

5. **Don't break existing workflows** — Existing users see no change unless they opt into graph-aware context.

6. **Lean into SUPERSEDES** — Memory evolution (newer footprints replacing older ones) is the strongest signal. SUPERSEDES edges receive the highest weight, so agents discover the current state of decisions first.

## Further Reading

- [Architecture](./architecture.md) — Substrata's overall design and FTS ranking model
- [MCP Server Integration](./mcp.md) — MCP tool registration for editors
- Design plan (Korean): [graph-rag-implementation.md](./graph-rag-implementation.md)
