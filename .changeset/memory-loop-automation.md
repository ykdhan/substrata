---
'substrata-cli': minor
'@substrata/core': minor
'@substrata/search': minor
'@substrata/mcp-server': minor
---

Close and measure the memory loop (IMPROVEMENT_PLAN M1–M3).

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
