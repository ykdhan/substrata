# MCP Server Integration

Substrata ships with an MCP server so AI agents can query and write footprints programmatically.

## Running the Server

```bash
substrata mcp
```

This starts a stdio-based MCP server that agents can invoke via MCP tools.

## Tool Signatures

All tools use underscore naming (dots are not universally safe across MCP clients). Input validation uses Zod schemas.

### `substrata_search`

Full-text search over footprints and memory.

**Input:**

```ts
{
  query: string;           // free-text search query (required)
  limit?: number;          // max results (default: 8)
  files?: string[];        // restrict to docs touching these file paths
  tags?: string[];         // restrict to docs with these tags
  excludeSuperseded?: boolean;  // drop superseded/deprecated entirely
}
```

**Output:**

```ts
{
  results: SearchResult[];
}
```

Where `SearchResult`:

```ts
{
  id: string;              // footprint id (e.g., fp_20260609_...)
  title: string;           // footprint or memory title
  filePath: string;        // repo-relative path
  score: number;           // search ranking score
  snippet: string;         // excerpt or first few lines
  tags: string[];          // associated tags
  createdAt?: string;      // ISO 8601 creation timestamp
  filesTouched: string[];  // files mentioned in this doc
  status: "draft" | "completed" | "superseded" | "deprecated";
}
```

### `substrata_context`

Return concise, source-linked context for an agent before work begins.

**Input:**

```ts
{
  task: string;            // description of work about to start (required)
  files?: string[];        // files the task will touch (boosts related docs)
  maxTokens?: number;      // approximate token budget (default: config max)
}
```

**Output:**

```ts
{
  context: string;         // numbered, source-linked context block
  sources: ContextSource[];
}
```

Where `ContextSource`:

```ts
{
  id: string; // footprint/memory id
  title: string; // document title
  filePath: string; // repo-relative path
}
```

**Notes:**

- Excludes superseded footprints by default (agents should see current decisions)
- Token budget uses character-based estimation (`ceil(chars / 3.5)`), not a real tokenizer
- Output is LLM-friendly with numbered blocks and source paths

### `substrata_add`

Create a new footprint. Runs a secret scan and refuses on detection.

**Input:**

```ts
{
  title: string;           // short title (required)
  purpose: string;         // why the work was done (required)
  actor: string;           // agent identifier (required)
  requester?: string;      // who requested the work
  workType?: enum;         // one of: implementation, implementation_decision, bug_fix,
                           // refactor, investigation, architecture_decision,
                           // test_update, documentation
  decisions?: string[];    // decisions made (array)
  rejectedOptions?: Array<{  // alternatives considered
    option: string;
    reason: string;
  }>;
  implementationNotes?: string;  // how it was done
  memoryLearned?: string[];      // durable facts (array)
  futureAgentGuidance?: string;  // guidance for next agents
  filesTouched?: string[];       // files changed (array)
  tags?: string[];               // topic tags (array)
  supersedes?: string[];         // ids this footprint replaces
  related?: {                    // optional related metadata
    commits?: string[];
    prs?: Array<string | number>;
    issues?: Array<string | number>;
    urls?: string[];
  };
}
```

**Output on success:**

```ts
{
  id: string; // new footprint id
  filePath: string; // repo-relative path
}
```

**Output on secret detection:**

```ts
{
  type: "error";
  error: {
    type: "text";
    text: "Refusing to write footprint: N potential secret(s) detected: ...";
  };
  # Additional structured data may be present (tool-dependent)
}
```

**Security note:** The secret scan is **always run** before writing. If a secret is detected, the write is refused and the error message includes pattern names and line numbers (never the secret value). The footprint is **not written** in this case.

### `substrata_related_to_file`

Find footprints and memory related to a file path.

**Input:**

```ts
{
  filePath: string;        // file path to search for (required)
  limit?: number;          // max results (default: 8)
}
```

**Output:**

```ts
{
  results: SearchResult[];
}
```

### `substrata_list_recent`

List recent footprints.

**Input:**

```ts
{
  limit?: number;          // max footprints (default: 8)
  tags?: string[];         // restrict to footprints with these tags
}
```

**Output:**

```ts
{
  results: SearchResult[];
}
```

Footprints are sorted by `updated_at` (or `created_at` if not updated), newest first.

### Graph tools

Four additional tools expose the Graph Memory / Graph RAG layer. They mirror the
`substrata graph …` CLI subcommands, auto-(re)build the graph on first use, and
fail open (returning empty results rather than erroring on an absent graph):

- **`substrata_graph_context`** — `{ task, files?, maxTokens? }` → `{ context, sources }`.
  Like `substrata_context`, but seeds with FTS and expands through the graph,
  returning enriched sections (Relevant Memories with a "why selected" line,
  Related Decisions, Rejected Alternatives, Related Files, Related Concepts).
- **`substrata_graph_related`** — `{ target, file?, limit?, excludeSuperseded? }` →
  `{ results }`. Records graph-related to a footprint id or file path, each with
  `bridges` provenance (which shared files/tags/concepts/decisions or supersedes
  link connects them).
- **`substrata_graph_explain`** — `{ from, to? }`. With two ids, returns the shortest
  graph `path` between them; with one id, returns its graph-`related` records.
- **`substrata_graph_stats`** — `{ topN? }` → node/edge counts by kind/relation and
  the most-connected records.

See [graph.md](./graph.md) for the full design and CLI equivalents.

## Client Registration

`substrata init` auto-wires every editor it detects — no manual MCP editing:

| Editor      | MCP config written by `init` / `mcp install`   | Agent-rule file written by `init` |
| ----------- | ---------------------------------------------- | --------------------------------- |
| Claude Code | `.mcp.json` (project)                          | `CLAUDE.md` + `AGENTS.md`         |
| Cursor      | `.cursor/mcp.json` (project)                   | `.cursor/rules/substrata.mdc`     |
| Gemini CLI  | `.gemini/settings.json` (project)              | `GEMINI.md`                       |
| Codex       | `~/.codex/config.toml` (global, managed block) | `AGENTS.md`                       |
| Windsurf    | printed snippet (global config)                | `AGENTS.md`                       |

The agent-rule files (generated unless `--no-editor-rules`) teach each editor's
agent to call `substrata_context` / `substrata_graph_context` before work and
`substrata_add` after — so the tools are not just available, they get used.

Standalone commands:

- `substrata mcp install [--client claude|cursor|windsurf|codex|gemini] [--dry]` —
  register the server into a detected or named editor (retrofit an existing repo).
- `substrata mcp print-config [--client claude|cursor|codex|gemini|generic]` —
  print a copy-pasteable config (Codex uses TOML; the rest use `mcpServers` JSON)
  for any client you'd rather configure by hand.

### After upgrading the CLI

A new `substrata-cli` version does **not** retroactively rewrite on-disk config.
After bumping the version, run `substrata upgrade` once: it idempotently refreshes
the AGENTS.md/CLAUDE.md/GEMINI.md sections, the Cursor rule, the `.gitignore` lines,
and every existing MCP registration (Claude/Cursor/Gemini/Codex), then rebuilds the
search + graph index. It never adds integrations you opted out of — re-run `init`
for that.

### Claude Code

The `init` wizard offers to register via:

```bash
claude mcp add --scope project
```

To manually add, edit `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "substrata": {
      "command": "node",
      "args": ["/absolute/path/to/node_modules/substrata-cli/dist/bin.js", "mcp"]
    }
  }
}
```

Get the absolute path:

```bash
realpath ./node_modules/substrata-cli/dist/bin.js
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "substrata": {
      "command": "node",
      "args": ["/absolute/path/to/node_modules/substrata-cli/dist/bin.js", "mcp"]
    }
  }
}
```

### Windsurf

Add to `.windsurf/mcp.json` (same as Cursor).

## Example Usage

### Agent Checking Context Before Work

```
Agent calls: substrata_context({ task: "Add pagination to learner search" })

Response:
{
  context: "Relevant Substrata context:\n\n1. Learner search uses cursor pagination...",
  sources: [
    { id: "fp_20260609_...", title: "Improve learner search", filePath: ".substrata/..." },
    ...
  ]
}
```

### Agent Recording Work

```
Agent calls: substrata_add({
  title: "Add filter to learner search",
  purpose: "Users requested ability to filter by enrollment status",
  actor: "claude-code",
  requester: "product-team",
  workType: "implementation",
  decisions: [
    "Add status filter to search API",
    "Cache filter options for performance"
  ],
  filesTouched: ["api/learners.ts"],
  tags: ["learner-search", "performance"],
  memoryLearned: [
    "Filter options are stable; safe to cache",
    "Always check LearnerQueryService first"
  ]
})

Response on success:
{
  id: "fp_20260610_add_learner_filter_abc123",
  filePath: ".substrata/footprints/2026/06/2026-06-10-add-learner-filter-abc123.md"
}
```

## MCP Server Behavior

- **Stdio transport**: the server reads MCP requests from stdin and writes responses to stdout. All diagnostics go to stderr.
- **Auto-index**: tools that require search (e.g., `substrata_search`, `substrata_context`) automatically rebuild a stale/missing index before querying.
- **Error handling**: structured errors include pattern names and line numbers (not secret values) on secret detection.
- **Repo-relative paths**: file paths in responses are always repo-relative (never absolute) for portability.

## Token Budget Notes

The `substrata_context` tool uses an approximate character-based token count:

```ts
estimateTokens(text) = ceil(text.length / 3.5);
```

This is sufficient for keeping context under a fixed budget but is not a real tokenizer. The response context includes a note that token counts are approximate. For more precise counting, integrate a tokenizer in v0.2+.

## Future Enhancements

Potential additions in later versions:

- `substrata_memory_update` — programmatic memory update
- `substrata_supersede` — mark one footprint as replaced
- Streaming responses for large result sets
- Pagination cursors for large searches
- Structured metadata in context responses
