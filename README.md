# Substrata

**Stop re-explaining your codebase to every agent.**

Substrata is a shared memory layer for AI coding agents that records important engineering decisions, implementation context, rejected alternatives, and repo-specific knowledge in a Git-friendly format so other agents can retrieve and use it later.

## What is Substrata?

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

## Quick Start

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

### After setup, agents take over

You normally don't run Substrata by hand. `init` wires up two things that make agents use it automatically:

- **AGENTS.md** — rules telling agents to check context before non-trivial work and leave a footprint after.
- **MCP registration** — agents call `substrata_context`, `substrata_search`, and `substrata_add` directly as tools.

Open a new agent session (e.g. Claude Code) in the repository and it picks Substrata up from there. To try it manually:

```bash
source ~/.zshrc                                                 # load attribution env vars (if wizard created them)
npx substrata-cli context "I need to improve user search"       # index builds automatically on first query
```

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

## The Core Loop

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

## Command Reference

| Command              | Purpose                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `init`               | One-command setup wizard: scaffold `.substrata/`, env vars, AGENTS.md, MCP registration, initial index |
| `add`                | Create a new footprint (interactive or non-interactive)                                                |
| `search <query>`     | Full-text search footprints and memory                                                                 |
| `context <task>`     | Concise context for an agent before work (LLM-friendly, excludes superseded by default)                |
| `list`               | List recent footprints by date, tag, or file                                                           |
| `show <id>`          | Display one footprint in full                                                                          |
| `index`              | Build or rebuild the local search index                                                                |
| `doctor`             | Verify repository setup                                                                                |
| `supersede <old-id>` | Mark an old footprint as replaced by a new one                                                         |
| `memory update`      | Append suggestions from recent footprints to curated memory files                                      |
| `hook install`       | Install a pre-commit secret scan hook (optional)                                                       |
| `upgrade`            | Refresh generated artifacts (AGENTS.md section, gitignore, MCP registrations) after a CLI upgrade      |
| `mcp`                | Run the MCP server (for agent integration)                                                             |

## Key Options

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

## MCP Setup

Substrata ships with an MCP server so AI agents can call it directly. The `init` wizard auto-registers with supported editors.

### Claude Code (via init wizard)

The wizard writes a project-scoped `.mcp.json` (idempotent — re-running `init` or `upgrade` refreshes the entry in place):

```json
{
  "mcpServers": {
    "substrata": {
      "command": "npx",
      "args": ["-y", "substrata-cli", "mcp"]
    }
  }
}
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

Add to `.windsurf/mcp.json` (same shape as Cursor).

## MCP Tools

The server exposes five underscore-named tools:

| Tool                        | Purpose                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `substrata_search`          | Full-text search (query, limit, files, tags, excludeSuperseded)                                  |
| `substrata_context`         | Concise context for a task (task, files, maxTokens)                                              |
| `substrata_add`             | Create a footprint (title, purpose, actor, decisions, rejected options, etc.; secret-scan gated) |
| `substrata_related_to_file` | Find memory related to a file (filePath, limit)                                                  |
| `substrata_list_recent`     | List recent footprints (limit, tags)                                                             |

See `docs/mcp.md` for detailed tool signatures.

## Repository Structure

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
  index/                     # SQLite FTS search index (gitignored, auto-generated)
    footprint.sqlite
  cache/                     # temporary data (gitignored)
```

## Security Defaults

Substrata files are committed to the repo, so security defaults are conservative:

- **Key-based redaction**: common keys (`token`, `apiKey`, `password`, `secret`, etc.) have values replaced with `[REDACTED]`
- **Content scanning**: pattern scan detects AWS keys, GitHub PATs, JWTs, private keys, etc.
- **Block on secret**: by default, `add` refuses to write if a secret remains after redaction (override with `--allow-secret`, not recommended)
- **Pre-commit hook**: optional (`substrata hook install`) runs the same scan over staged files

The CLI secret scan is **best-effort, not a guarantee**. See `docs/security.md` for details and recommendations.

Never store secrets, credentials, API keys, tokens, or sensitive user data in Substrata files.

## Monorepo Packages

| Package                 | Purpose                                                                       | Published                       |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| `substrata-cli`         | CLI binary, commands, init wizard, MCP client registry, MCP server entrypoint | yes — the only npm package      |
| `@substrata/core`       | File model, footprint/memory parsing, redaction, ID generation, setup writers | no — bundled into substrata-cli |
| `@substrata/search`     | SQLite FTS index, querying, ranking, freshness detection                      | no — bundled into substrata-cli |
| `@substrata/mcp-server` | MCP server and tool implementations                                           | no — bundled into substrata-cli |

## Contributing

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

## Documentation

- **[Architecture](docs/architecture.md)** — two-layer model, file-as-source-of-truth strategy, package responsibilities, index freshness
- **[Footprint Format](docs/footprint-format.md)** — full schema reference with examples
- **[Memory Format](docs/memory-format.md)** — curated memory with marker-delimited entries
- **[MCP](docs/mcp.md)** — tool signatures and integration guide
- **[Security](docs/security.md)** — redaction, secret patterns, pre-commit hook
- **[Roadmap](docs/roadmap.md)** — v0.1 through v1.0 plans

## License

MIT. See [LICENSE](LICENSE).
