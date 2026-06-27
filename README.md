# 🪨 Substrata

**Stop re-explaining your codebase to every agent.**

Substrata is a shared memory layer for AI coding agents that records important engineering decisions, implementation context, rejected alternatives, and repo-specific knowledge in a Git-friendly format so other agents can retrieve and use it later.

> ### ✨ New in 0.2.0
>
> - 🕸️ **Graph Memory / Graph RAG** — an auxiliary SQLite graph index that
>   understands _relationships_ between footprints (shared files, tags, concepts,
>   decisions, and `SUPERSEDES` chains), not just keywords. FTS is untouched.
> - 🤖 **Editor-agnostic auto-setup** — `init` wires up Claude Code, Cursor,
>   Gemini CLI, and Codex with MCP config **and** per-editor rule files, so any
>   agent uses Substrata automatically.

## 🤔 What is Substrata?

Git records **what changed**.

Substrata records **why an agent changed it, what it learned, what alternatives were rejected, and what future agents should remember**.

```
Engineer A's agent works on the repo
  ↓
Agent leaves a footprint
  ↓
Footprint is committed to the repo
  ↓
Memory index is generated locally
  ↓
Engineer B's agent retrieves it later
  ↓
The second agent avoids repeating context discovery and past mistakes
```

Substrata is **not** a replacement for Git commits, PR descriptions, ADRs, or documentation. It is an **agent-native memory system** optimized for coding agents that need project context before making changes.

## 🚀 Quick Start

### Installation and Setup

The npm package name `substrata` is taken by an unrelated package, so the published package is `substrata-cli`. Set up a repository with:

```bash
npx substrata-cli init
```

This starts an interactive setup wizard that scaffolds `.substrata/`, sets up environment variables for agent attribution, registers MCP with your editor, and builds an initial search index. Every prompt has a sensible default, so you can press Enter through the whole wizard for a working setup.

Non-interactive setup (CI/scripts):

```bash
npx substrata-cli init --yes --project my-app
```

> **Note:** `npx` runs the CLI from a cache — it does **not** install a global `substrata` command. Either keep using `npx substrata-cli <command>`, or install globally for the bare binary:
>
> ```bash
> npm install -g substrata-cli
> substrata --help
> ```

### 🤖 After setup, agents take over

You normally don't run Substrata by hand. `init` wires up two things that make agents use it automatically — for **every editor it detects**:

- **Agent rules** — `AGENTS.md` plus per-editor files (`CLAUDE.md`, `GEMINI.md`, `.cursor/rules/substrata.mdc`) telling agents to check context before non-trivial work and leave a footprint after.
- **MCP registration** — agents call `substrata_context`, `substrata_graph_context`, `substrata_add`, etc. directly as tools. Claude Code → `.mcp.json`, Cursor → `.cursor/mcp.json`, Gemini CLI → `.gemini/settings.json`, Codex → `~/.codex/config.toml`.

Not on a detected editor? `substrata mcp print-config --client <codex|gemini|generic>` prints a copy-pasteable config. Open a new agent session in the repository and it picks Substrata up from there. To try it manually:

```bash
source ~/.zshrc                                                 # load attribution env vars (if wizard created them)
npx substrata-cli context "I need to improve user search"       # index builds automatically on first query
```

### Automatic context injection & recording (Claude Code)

MCP tools make Substrata _available_, but an agent only benefits if it actually
calls `substrata_context` before work and `substrata_add` after. In practice that
read side rarely happens on its own. The Claude Code lifecycle hooks close the
loop deterministically instead of relying on the model to remember:

- **On session start** — the most recent footprints are injected so the session
  knows project memory exists and what was last decided.
- **On every prompt** — footprints relevant to your prompt are searched and
  injected as additional context (within `hooks.max_context_tokens`, falling back
  to `search.max_context_tokens`; nothing below `hooks.min_score` is injected, so
  irrelevant memory never adds noise).
- **When the agent stops after non-trivial work** — a reminder to record a
  footprint fires (suppressed for subagents to avoid footprint floods, and never
  loops).

Install them into `.claude/settings.json` (the `init` wizard offers this when
Claude Code is detected; this is also how you retrofit an already-initialized
repo):

```bash
npx -y substrata-cli hook claude            # install (idempotent)
npx -y substrata-cli hook claude --remove   # remove cleanly
```

The write is surgical — only Substrata's own hook entries are touched, so any
hooks you already have are preserved. Tune behavior under the `hooks:` block in
`.substrata/config.yml`:

```yaml
hooks:
  enabled: true # master switch
  inject_context: true # SessionStart / UserPromptSubmit injection
  # max_context_tokens: 1600 # defaults to search.max_context_tokens
  min_score: 0 # raise to suppress low-relevance injections
  remind_on_stop: true # footprint reminder on Stop
  non_trivial_threshold: 2 # changed-file count that counts as non-trivial
```

Hooks fail open: if anything goes wrong (no config, parse error, slow disk) the
handler stays silent and exits 0 — a Substrata hook never blocks your session.

### Measuring whether memory is read (`substrata stats`)

Footprints used to be write-only in practice: there was no way to tell whether
they were ever read back. Each retrieval (`context` / `search` / `list` /
`related`, from the CLI, MCP tools, or hooks) now appends one row to a local,
gitignored access log, and `substrata stats` reports on it:

```bash
substrata stats              # all-time read:write ratio, by op/source, hot/cold footprints
substrata stats --days 7     # trailing window
substrata stats --json       # machine-readable
```

```
Substrata usage (all time):

  reads:writes      2.00:1  (2 reads / 1 writes)
  footprints        12 total, 3 never referenced
  ...
```

The read:write ratio is the headline health metric — a healthy repo reads its
memory more often than it writes it. The log lives in `.substrata/index/` (a
separate DB from the search index, so rebuilds don't wipe it), is never
transmitted, and can be turned off or made count-only:

```yaml
telemetry:
  enabled: true # set false to disable logging entirely
  store_queries: false # opt-in: set true to also keep the query/prompt text (secret patterns are redacted first)
```

`substrata doctor` also surfaces these as health warnings (hooks not installed,
no recent footprints, a low read:write ratio), and `substrata gc` reports
duplicate/stale footprints — `gc --auto-supersede` links older duplicates to the
newest so retrieval only surfaces the current one.

### Troubleshooting `better-sqlite3`

Substrata uses `better-sqlite3` for the local FTS search index. It's a native module and can be tricky to install in some environments (Node version mismatch, ARM architecture, corporate proxy, etc.).

If installation fails during `npm install` or `pnpm install`:

1. **Check Node version compatibility**: `better-sqlite3` requires Node ≥ 14.21 or ≥ 16.x.
2. **Rebuild the native module**:
   ```bash
   pnpm rebuild better-sqlite3
   ```
   or
   ```bash
   npm rebuild better-sqlite3
   ```
3. **Corporate proxy**: ensure `npm config` has `proxy` and `https-proxy` set correctly.
4. **Fallback**: if native build still fails, the search index can be rebuilt or regenerated locally without downtime; users can still read and add footprints.

## 🕸️ Graph Memory (Graph RAG)

Keyword search finds footprints that _mention_ your query. Graph Memory finds
the ones that are _connected_ to them — work that touched the same files, shared
a tag or concept, or **superseded** an earlier decision. It's an auxiliary
SQLite index (`.substrata/index/graph.sqlite`) built alongside FTS — **FTS is
never replaced**, and the whole layer is fail-open (a missing/corrupt graph
degrades to plain FTS, never errors).

```
Query
  ↓  FTS search                → top footprints (seeds)
  ↓  graph expansion           → related files, decisions, memories
  ↓  re-rank (shared file > decision > concept > tag; SUPERSEDES strongest)
  ↓
Enriched context  (Relevant Memories + Related Decisions + Rejected Alternatives
                   + Related Files + Related Concepts + a "why selected" reason)
```

```bash
substrata index                              # builds FTS + graph together
substrata graph context "improve search"     # hybrid, enriched, source-linked
substrata graph related api/learners.ts      # what else touches / relates to this?
substrata graph explain <fromId> <toId>      # WHY are two footprints connected?
substrata graph stats                        # node/edge counts, most-connected
```

Enable/tune it in `.substrata/config.yml` (on by default, fully backward-compatible):

```yaml
search:
  hybrid_graph: true # graph context + hook injection expand FTS seeds via the graph
graph:
  enabled: true # build + use the graph index
  expansion_depth: 1 # hops from each seed (1 = direct neighbors)
  max_nodes: 40 # expansion bounds (keeps it cheap on dense graphs)
  max_edges: 80
```

See **[docs/graph.md](docs/graph.md)** for the full design, node/edge model, and MCP tools.

## 🔁 The Core Loop

```
┌─────────────────────────────────────────┐
│ 1. Agent checks context before work     │  substrata context "..."
│    (index builds automatically)         │
├─────────────────────────────────────────┤
│ 2. Agent makes the change               │
├─────────────────────────────────────────┤
│ 3. Agent leaves a concise footprint     │  substrata add --title "..." --purpose "..."
│    (decision/implementation/learning)   │
├─────────────────────────────────────────┤
│ 4. Footprint becomes shared team memory │  (committed to repo)
├─────────────────────────────────────────┤
│ 5. Future agents retrieve it            │  substrata search / context / MCP tools
└─────────────────────────────────────────┘
```

## 📟 Command Reference

| Command              | Purpose                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `init`               | One-command setup wizard: scaffold `.substrata/`, env vars, agent rules, MCP registration, initial index |
| `add`                | Create a new footprint (interactive or non-interactive)                                                  |
| `search <query>`     | Full-text search footprints and memory                                                                   |
| `context <task>`     | Concise context for an agent before work (LLM-friendly, excludes superseded by default)                  |
| `graph <sub>`        | 🕸️ Graph Memory: `build`, `related <id\|file>`, `explain <from> [to]`, `stats`, `context <task>`         |
| `list`               | List recent footprints by date, tag, or file                                                             |
| `show <id>`          | Display one footprint in full                                                                            |
| `index`              | Build or rebuild the local search index (FTS + graph)                                                    |
| `doctor`             | Verify repository setup                                                                                  |
| `stats`              | Report memory read/write usage (read:write ratio, hot/cold footprints) from the local access log         |
| `gc`                 | Report duplicate/stale footprints; `--auto-supersede` links older duplicates to the newest               |
| `supersede <old-id>` | Mark an old footprint as replaced by a new one                                                           |
| `memory update`      | Append suggestions from recent footprints to curated memory files                                        |
| `hook install`       | Install a pre-commit secret scan hook (optional)                                                         |
| `hook claude`        | Install/remove the Claude Code lifecycle hooks (auto context injection + footprint reminder)             |
| `upgrade`            | Refresh generated artifacts (agent rules, gitignore, MCP registrations, indexes) after a CLI upgrade     |
| `mcp`                | Run the MCP server; `mcp install [--client …]` and `mcp print-config [--client …]` to wire up editors    |

## ⚙️ Key Options

### `init`

```bash
substrata init                          # interactive
substrata init --yes                    # accept all defaults
substrata init --project my-app         # custom project name
substrata init --actor claude-code      # default actor
substrata init --with-hook              # install pre-commit secret hook
substrata init --print-config           # show resolved config, no write
```

### `add`

```bash
substrata add                           # interactive
substrata add --title "Fix login bug" --purpose "Users couldn't log in" --actor claude-code
substrata add --from-git                # populate from Git branch/files/commit
substrata add --supersedes fp_20260609_old_id
```

### `search` and `context`

```bash
substrata search "pagination"           # full-text search
substrata search "Redis" --tag performance
substrata search "learner" --files api/learners.ts
substrata context "I need to improve search"  # LLM-friendly context
substrata context "..." --max-tokens 800
```

## 🔌 MCP Setup

Substrata ships with an MCP server so AI agents can call it directly. `init`
**auto-wires every editor it detects** — no manual MCP editing. Each registration
is idempotent (re-running `init` or `upgrade` refreshes it in place):

| Editor         | MCP config (written by `init` / `mcp install`) | Agent-rule file               |
| -------------- | ---------------------------------------------- | ----------------------------- |
| 🟣 Claude Code | `.mcp.json` (project)                          | `CLAUDE.md` + `AGENTS.md`     |
| 🔵 Cursor      | `.cursor/mcp.json` (project)                   | `.cursor/rules/substrata.mdc` |
| ⭐ Gemini CLI  | `.gemini/settings.json` (project)              | `GEMINI.md`                   |
| 🟢 Codex       | `~/.codex/config.toml` (global, managed block) | `AGENTS.md`                   |
| 🌊 Windsurf    | printed snippet (global)                       | `AGENTS.md`                   |

Every config points at the same launcher: `npx -y substrata-cli mcp`. Retrofit an
existing repo or wire up a client by hand with:

```bash
substrata mcp install --client cursor          # register into a detected/named editor
substrata mcp print-config --client codex      # print a copy-pasteable config (TOML for Codex,
                                               # mcpServers JSON for everything else)
```

After upgrading the CLI, run `substrata upgrade` once to refresh all of the above
(agent rules + every MCP registration) and rebuild the indexes.

## 🧰 MCP Tools

The server exposes **nine** underscore-named tools — five core, four graph:

| Tool                         | Purpose                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `substrata_search`           | Full-text search (query, limit, files, tags, excludeSuperseded)                                  |
| `substrata_context`          | Concise context for a task (task, files, maxTokens)                                              |
| `substrata_add`              | Create a footprint (title, purpose, actor, decisions, rejected options, etc.; secret-scan gated) |
| `substrata_related_to_file`  | Find memory related to a file (filePath, limit)                                                  |
| `substrata_list_recent`      | List recent footprints (limit, tags)                                                             |
| 🕸️ `substrata_graph_context` | Graph-aware enriched context: hybrid retrieval + "why selected" (task, files, maxTokens)         |
| 🕸️ `substrata_graph_related` | Graph-related records for an id or file, with bridge provenance (target, file, limit)            |
| 🕸️ `substrata_graph_explain` | Shortest graph path between two records, or one record's relations (from, to)                    |
| 🕸️ `substrata_graph_stats`   | Graph node/edge counts and most-connected records (topN)                                         |

See `docs/mcp.md` for detailed tool signatures and `docs/graph.md` for the graph model.

## 📂 Repository Structure

```
.substrata/
  config.yml                 # project config (schema version, security, agent defaults)
  README.md                  # wizard-generated intro
  footprints/
    2026/06/...md           # timestamped footprints (committed)
  memory/
    conventions.md          # curated memory files (committed)
    domain/...md
  templates/
    footprint.md            # template for interactive add
    memory.md
  index/                     # generated, gitignored — safe to delete and rebuild
    footprint.sqlite        # SQLite FTS search index
    graph.sqlite            # 🕸️ SQLite graph index (auxiliary, built alongside FTS)
    access.sqlite           # local read/write telemetry (survives index rebuilds)
  cache/                     # temporary data (gitignored)
```

## 🔒 Security Defaults

Substrata files are committed to the repo, so security defaults are conservative:

- **Key-based redaction**: common keys (`token`, `apiKey`, `password`, `secret`, etc.) have values replaced with `[REDACTED]`
- **Content scanning**: pattern scan detects AWS keys, GitHub PATs, JWTs, private keys, etc.
- **Block on secret**: by default, `add` refuses to write if a secret remains after redaction (override with `--allow-secret`, not recommended)
- **Pre-commit hook**: optional (`substrata hook install`) runs the same scan over staged files

The CLI secret scan is **best-effort, not a guarantee**. See `docs/security.md` for details and recommendations.

Never store secrets, credentials, API keys, tokens, or sensitive user data in Substrata files.

## 📦 Monorepo Packages

| Package                 | Purpose                                                                       | Published                       |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| `substrata-cli`         | CLI binary, commands, init wizard, MCP client registry, MCP server entrypoint | yes — the only npm package      |
| `@substrata/core`       | File model, footprint/memory parsing, redaction, ID generation, setup writers | no — bundled into substrata-cli |
| `@substrata/search`     | SQLite FTS index, querying, ranking, freshness detection                      | no — bundled into substrata-cli |
| `@substrata/mcp-server` | MCP server and tool implementations                                           | no — bundled into substrata-cli |

## 🤝 Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full guide. Quick version:

### Development Setup

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm format
```

### Project Layout

- `packages/core/` — file model, parsing, setup writers
- `packages/search/` — SQLite FTS, indexing, ranking
- `packages/cli/` — commands, wizard, MCP client registry
- `packages/mcp-server/` — MCP tools
- `examples/basic-repo/` — reference example with smoke tests
- `docs/` — architecture, formats, security, roadmap

### Versioning

Substrata uses Changesets for version management. Create a changeset:

```bash
pnpm changeset
```

before pushing your PR.

## 📚 Documentation

- **[Architecture](docs/architecture.md)** — two-layer model, file-as-source-of-truth strategy, package responsibilities, index freshness
- **[Graph Memory / Graph RAG](docs/graph.md)** 🕸️ — graph index, node/edge model, hybrid retrieval, CLI + MCP usage
- **[Footprint Format](docs/footprint-format.md)** — full schema reference with examples
- **[Memory Format](docs/memory-format.md)** — curated memory with marker-delimited entries
- **[MCP](docs/mcp.md)** — tool signatures and integration guide
- **[Security](docs/security.md)** — redaction, secret patterns, pre-commit hook
- **[Roadmap](docs/roadmap.md)** — v0.1 through v1.0 plans

## 📄 License

MIT. See [LICENSE](LICENSE).
