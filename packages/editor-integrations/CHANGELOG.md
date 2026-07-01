# @substrata/editor-integrations

## 0.3.0

### Minor Changes

- ba3f5b7: Shareable per-project index DB, token/latency benchmark, and an editor-agnostic package split.

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

  Ledger-model sharing (recommended over committing the binary):

  - **Share the markdown, re-derive the index** — because the index is a deterministic function of the committed markdown "ledger", the default `local` mode keeps the DB gitignored and re-derives the identical index everywhere (Git history stays bounded/text-only). The `shared` (commit-the-binary) mode is now documented as a niche opt-in with an unbounded-history caveat.
  - **Auto-rebuild git hooks** — `init` installs `post-merge`/`post-checkout` hooks (`--no-index-hook` to skip) that re-derive the index after a pull/checkout, detached + silent, only when content actually changed — so `local` mode feels prebuilt with no manual rebuild.
  - **Docs** — README gains a "Why Substrata (vs an agent writing its own markdown)?" section and a ledger-model sharing explanation.

  Incremental indexing + seamless version migration:

  - **Incremental FTS + graph index** — a per-file manifest (stat + content hash) means only the footprints that actually changed are re-parsed and re-indexed, so re-derivation scales with the size of the change, not the size of the memory (validated by a fuzz test asserting `incremental == full rebuild` across add/edit/remove/supersede). `substrata index` still forces a full deterministic rebuild.
  - **Automatic data migration** — the index schema is versioned, so an index built by an older CLI is detected as stale and rebuilt transparently; old `config.yml` files keep working via default deep-merge.
  - **Version-drift nudge** — `init`/`upgrade` stamp the CLI version locally; `substrata doctor` warns to run `substrata upgrade` when a newer CLI is installed, so generated setup files (hooks, gitignore, editor rules, MCP regs) never silently drift.

### Patch Changes

- Updated dependencies [ba3f5b7]
  - @substrata/core@0.3.0
