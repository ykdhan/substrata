# @substrata/mcp-server

## 0.2.0

### Minor Changes

- Add Graph Memory / Graph RAG and editor-agnostic auto-setup.

  - **Graph Memory / Graph RAG (auxiliary SQLite graph index).** A new
    `.substrata/index/graph.sqlite` is built alongside the FTS index (never
    replacing it). Footprints/memory are decomposed into typed nodes (footprint,
    memory, file, tag, decision, rejected_option, concept, actor) and weighted
    edges (TOUCHES_FILE, HAS_TAG, HAS_DECISION, REJECTED, MENTIONS, AUTHORED_BY,
    SUPERSEDES). `substrata index` now builds FTS + graph together.
  - **Hybrid retrieval.** `graph context` seeds with FTS, expands through the
    graph, and re-ranks — surfacing related decisions/files/memories a keyword
    query alone misses, with a "why selected" reason per result. Strictly additive
    and fail-open: with no/empty graph the result equals pure FTS.
  - **New CLI + MCP surface.** `substrata graph build|related|explain|stats|context`
    and four MCP tools (`substrata_graph_context`, `substrata_graph_related`,
    `substrata_graph_explain`, `substrata_graph_stats`). The five original MCP
    tools are unchanged.
  - **Graph-aware Claude Code hook.** The prompt-submit hook prefers graph context,
    falling back to FTS, then to no injection (fail-open).
  - **Editor-agnostic auto-setup.** `init` now generates per-editor rule files
    (CLAUDE.md, GEMINI.md, `.cursor/rules/substrata.mdc`) from a single shared
    source, and the MCP client registry gains Codex (`~/.codex/config.toml`) and
    Gemini CLI (`.gemini/settings.json`) so `substrata mcp install` auto-registers
    them. New `substrata mcp install` / `substrata mcp print-config` commands.
  - **Config.** New `graph.{enabled,expansion_depth,max_nodes,max_edges}` and
    `search.hybrid_graph` (snake_case); legacy configs without the block still load.

  All graph reads fail open (a corrupt/absent graph degrades to FTS, never throws),
  so existing workflows are unaffected.

- 597fc73: Close and measure the memory loop (IMPROVEMENT_PLAN M1–M3).

  - **M1 — automatic retrieval/recording (Claude Code lifecycle hooks).** New
    `hooks.*` config and `substrata hook claude [--remove]` write idempotent,
    surgical `.claude/settings.json` entries. Runtime handlers
    (`hook session-start|prompt-submit|session-end`) inject relevant footprints on
    session start / each prompt and remind to record after non-trivial work. All
    handlers fail open and never block a session. `init` offers installation.
  - **M2 — usage telemetry + `substrata stats`.** Each retrieval (CLI/MCP/hooks)
    is logged to a local, gitignored access DB (separate from the search index, so
    rebuilds don't wipe it). `substrata stats` reports the read:write ratio,
    by-op/source breakdown, and hot/cold footprints. Gated by `telemetry.*`.
  - **M3 — quality + ops.** `substrata doctor` now emits health warnings (hooks
    not installed, no recent footprints, low read:write ratio). New `substrata gc`
    reports duplicate/stale footprints and `--auto-supersede` links older
    duplicates to the newest. `related_to_file` expands to neighbor files in the
    same directory. (Embedding-based semantic search is intentionally deferred.)

### Patch Changes

- Updated dependencies
- Updated dependencies [597fc73]
  - @substrata/core@0.2.0
  - @substrata/index@0.2.0
