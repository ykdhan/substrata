# substrata-cli

**Stop re-explaining your codebase to every AI agent.**

Substrata is a shared, versioned memory layer for AI coding agents. Agents record
the _why_ behind their work — decisions, rejected alternatives, gotchas, repo
conventions — as Git-committed markdown, and later agents **retrieve only the
relevant slice** through a local graph + full-text index. No re-discovery, no
repeating past mistakes, no cloud.

```bash
npx substrata-cli init                          # one-command setup wizard
substrata context "what I'm about to work on"   # concise, relevant memory for an agent
substrata add --title "..." --purpose "..."     # record a decision/learning
substrata bench                                 # token + latency vs reading the whole corpus
```

> The npm name `substrata` belongs to an unrelated package, so the published
> package is **`substrata-cli`** — but the installed binary is still `substrata`.

## Why not just let the agent write its own markdown file?

| Self-written notes           | Substrata                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Siloed to one agent/session  | **Shared** — committed to the repo, used by every teammate's agent                      |
| Whole file dumped to context | **Retrieved** — graph + FTS surface just what's relevant, within a token budget         |
| Flat prose                   | **Relational** — supersedes chains + shared file/decision/concept links                 |
| Rots and contradicts         | **Evolves** — `supersede`, `gc`, and status lifecycle keep memory current               |
| Rarely read before work      | **Deterministic** — Claude Code hooks inject context each prompt + nudge a record after |

## Highlights

- 🕸️ **Graph Memory / Graph RAG** — a local SQLite graph index that understands
  _relationships_ between footprints, not just keywords. Retrieval stays small and
  relevant as memory grows (98%+ fewer tokens than reading the corpus — see
  `substrata bench`).
- 🤖 **Editor-agnostic** — `init` wires up MCP + per-editor rules for Claude Code,
  Cursor, Gemini CLI, and Codex so any agent uses Substrata automatically.
- 🔁 **Deterministic read/write loop** — optional Claude Code lifecycle hooks inject
  relevant memory on each prompt and remind the agent to leave a footprint.
- 🔒 **100% local** — everything lives in `.substrata/` and a local SQLite index.
  Nothing is ever transmitted; query text stays in a gitignored local log.
- ⚡ **Incremental + shareable** — the index re-derives deterministically from the
  committed markdown (the "ledger"), rebuilds only what changed, and auto-refreshes
  on `git pull`.

## Install

```bash
npm install -g substrata-cli   # global `substrata` binary
# or run ad-hoc:
npx substrata-cli <command>
```

This package ships self-contained: the internal `@substrata/core`,
`@substrata/index`, `@substrata/hooks`, `@substrata/editor-integrations`, and
`@substrata/mcp-server` workspace packages are bundled in at build time.

## Documentation

Full docs — graph memory, MCP tools, security model, architecture — live in the
[repository](https://github.com/ykdhan/substrata).

MIT © Substrata
