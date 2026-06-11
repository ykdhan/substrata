# Substrata Architecture

## Two-Layer Model

Substrata separates **footprint** (what happened in one work session) from **memory** (durable knowledge extracted from footprints).

```
Footprint Layer         Memory Layer
─────────────────────────────────────
One agent session       Curated knowledge
Timestamped            Timeless
Detailed context       High signal
(many per repo)        (few, well-maintained)
```

This separation lets agents quickly surface actionable knowledge without wading through individual session logs.

## Files as Source of Truth

Markdown and YAML files in `.substrata/` are the authoritative record:

- **Git-friendly**: easy to diff, blame, review, merge
- **Portable**: work offline, no database migration, no vendor lock-in
- **Readable**: agents and humans can read them directly
- **Durable**: survive repo moves, migrations, tool changes
- **Version-controlled**: full history in Git

### SQLite as Generated Index

SQLite (via FTS5) is used only for search and ranking. It must always be regenerable from repo files:

```
.substrata/footprints/ (canonical)
        ↓
   SQLite FTS5     (generated)
        ↓
 search results
```

The `.substrata/index/footprint.sqlite` file is **gitignored**. After a clone, the index is absent; `search` and `context` rebuild it lazily on first use.

## Package Responsibilities

### `@substrata/core`

Core file model and setup.

- **Type system**: `Footprint`, `MemoryDocument`, `SearchResult`, `WriteFootprintInput`, etc.
- **Parsing**: load frontmatter, parse Markdown sections, extract metadata
- **Writing**: create/update footprint and memory files with random-suffix IDs
- **ID generation**: `fp_YYYYMMDD_<slug>_<base32-6>` format ensures no same-day collisions
- **Redaction**: key-based (recursive) + content/pattern scanning
- **Config**: load and validate `.substrata/config.yml`
- **Setup writers**: idempotent, dry-runnable functions for `.gitignore`, shell rc, AGENTS.md, pre-commit hook
- **Supersede**: flip status and links when one footprint replaces another

### `@substrata/search`

Search index, querying, ranking, and freshness.

- **SQLite schema**: FTS5 virtual table for title/tags/files/content, plus index metadata
- **Indexing**: scan footprints and memory files, populate index
- **Querying**: keyword search with file/tag filters
- **Ranking**: BM25 score + boosts for recency, file overlap, architecture decisions + penalties for superseded/deprecated
- **Freshness**: track source file count and mtime; detect missing/stale/fresh index
- **Auto-rebuild**: lazy rebuild on missing or stale

### `substrata-cli` (published as the single npm package)

User-facing commands and interaction.

- **Commands**: `init`, `add`, `search`, `context`, `list`, `show`, `doctor`, `supersede`, `memory update`, `hook install`, `mcp`
- **Init wizard**: interactive setup with preflight checks, agent attribution, security defaults, AGENTS.md integration, MCP registration, idempotent update mode
- **MCP client registry**: auto-detection and registration for Claude Code, Cursor, Windsurf
- **Rendering**: human-readable tables, JSON output, context formatting for LLMs
- **Attribution resolution**: actor/model/requester by precedence (flags → env vars → config → defaults)

### `@substrata/mcp-server`

MCP protocol implementation and tools.

- **Server**: stdio transport, tool registration
- **Tools**: `substrata_search`, `substrata_context`, `substrata_add`, `substrata_related_to_file`, `substrata_list_recent`
- **Zod schemas**: strict input validation for each tool
- **Error handling**: secret-scan gate for `add` tool with structured error response

## Index Freshness Design

The index must be regenerable without losing data, and agents should not wait for slow rebuilds.

### Freshness Status

```ts
type IndexStatus =
  | { state: 'missing' }
  | { state: 'stale'; reason: 'mtime' | 'count' | 'schema' }
  | { state: 'fresh' };
```

### Detection Strategy

Compare metadata stored in the index (`index_meta` table) against the current filesystem:

- `schema_version`: mismatch → stale (incompatible DB)
- `source_file_count`: changed → stale (files added/removed)
- `source_max_mtime`: newer file exists → stale (content changed)

No file parsing required; just a cheap stat walk of `.substrata/footprints/` and `.substrata/memory/`.

### Lazy Rebuild

`search` and `context` commands call `ensureFreshIndex()` before querying:

- Missing or stale → rebuild automatically (unless `--no-auto-index`)
- Fresh → use immediately

Rebuilds are fast (< 1 second for typical repos) because the index is local and incremental.

## Concurrency and Merge Conflicts

Multiple agents may work on the same branch. Substrata minimizes conflict surface structurally:

### Footprints (append-only)

- Each agent writes a **distinct new file** with a unique random suffix
- Corrections are **new footprints** that supersede the old one, not in-place edits
- Same-day same-slug collisions are impossible (6-char base32 random suffix)
- **Result**: footprint files almost never conflict

### Memory Files (marker-delimited)

- Entries live between stable markers: `<!-- substrata:entries:start -->` and `<!-- substrata:entries:end -->`
- `memory update` appends new entries before the end marker without rewriting existing ones
- Concurrent appends conflict only on the trailing marker line
- **Result**: conflict surface is minimal and trivially resolvable

### MVP Stance

Substrata does **not** attempt automatic merge resolution. It minimizes conflict surface and relies on Git for the rest. In practice, rare conflicts are manual and simple: two agents appending to the same memory file typically only collide on the end marker.

## Ranking Rules (Quick Reference)

See `docs/architecture.md` § Ranking for full details. Search results are ranked by:

1. **Hard filters** applied first (file/tag restrictions)
2. **BM25 FTS score** from SQLite
3. **Multiplicative boosts**:
   - File overlap: × 1.5
   - Recency: × (1 + 0.15 × decay)
   - Architecture decisions: recency boost is halved (stay durable)
4. **Status penalties**:
   - Superseded: × 0.15
   - Deprecated: × 0.10
   - Draft: × 0.50

Superseded/deprecated are demoted but still returned by `search` (so humans can trace history). The `context` command and `--exclude-superseded` drop them entirely (agents should see only current decisions).

## Token Budget and Approximation

`context` uses a simple character-based approximation for token budgeting:

```ts
estimateTokens(text) = ceil(text.length / 3.5);
```

No tokenizer dependency is bundled in MVP. The output notes that counts are approximate. This is sufficient for keeping context under a fixed budget; real token counting can be added in v0.2+.

## Why SQLite, Not Vector Search

SQLite FTS5 is used in MVP because:

- No external dependencies (no embedding API, no embeddings provider)
- Fast enough for typical repos (< 100ms for keyword queries)
- Good keyword ranking via BM25
- Can be hybridized with embeddings later

Future versions (v0.3+) can add semantic search with local or remote embeddings, hybrid ranking, or repo-aware reranking without breaking the file-based source of truth.
