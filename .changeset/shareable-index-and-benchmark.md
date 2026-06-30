---
'substrata-cli': minor
'@substrata/core': minor
'@substrata/index': minor
'@substrata/editor-integrations': minor
'@substrata/hooks': minor
'@substrata/mcp-server': minor
---

Shareable per-project index DB, token/latency benchmark, and an editor-agnostic package split.

- **Shareable index DB** — `substrata init` now offers `storage.sharing: local | shared` (`--sharing <mode>`). In `shared` mode the binary SQLite index/graph DB is committed so a team shares one prebuilt index; `local` (default) keeps it gitignored and rebuilt per developer. The telemetry access log moves to `.substrata/local/` and is always gitignored in both modes, so query text is never committed. `substrata upgrade` honors the configured mode.
- **`substrata bench`** — new command (and `runBenchmark` API) comparing the token + latency cost of reading the whole markdown corpus vs budget-bounded indexed retrieval.
- **Seamless setup** — `substrata init` adds `substrata-cli` to the project's `package.json` devDependencies (`--no-cli-dep` to skip).
- **Package refactor** — `@substrata/search` renamed to `@substrata/index`; new `@substrata/editor-integrations` (editor/project setup writers) and `@substrata/hooks` (Claude Code hook primitives); `@substrata/core` is now pure domain. Internal packages remain bundled into the published `substrata-cli`.

Shared-mode hardening so the committed DB is actually pleasant to live with:

- **Content-based freshness** — a committed DB is recognized as fresh after a clone/pull (mtime changes on checkout no longer trigger a needless rebuild), so teammates get the prebuilt index with no rebuild.
- **Auto-resolving merge driver** — `init`/`upgrade` register a `substrata-rebuild` git merge driver so a conflicting `.sqlite` is resolved automatically by rebuilding from the merged markdown.
- **Content-deterministic build** — no wall-clock `built_at` + `VACUUM`, so rebuilding unchanged content yields a near-identical file (minimal git churn).
- **Doctor guards** — shared-mode warnings when the committed DB drifts from the markdown or grows large enough to bloat history.
- **`substrata bench`** no longer force-rebuilds (won't dirty a committed DB); `--sharing` is validated; `upgrade` migrates the pre-0.3 telemetry log out of `index/`.
