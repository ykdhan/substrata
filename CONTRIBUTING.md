# 🤝 Contributing to Substrata

Thanks for helping make agent memory better! 🙌

## 🛠️ Development Setup

### Prerequisites

- Node.js 20+
- pnpm (install with `npm install -g pnpm`)
- Git

### Installation

```bash
git clone https://github.com/ykdhan/substrata.git
cd substrata
pnpm install
```

### Build and Test

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Run linter
pnpm lint

# Run type checker
pnpm typecheck

# Format code
pnpm format
```

All checks must pass before pushing.

## 🗂️ Project Structure

```
packages/
  core/                  # Pure domain: file model, parsing, redaction, config, IDs, supersede
  index/                 # SQLite FTS + 🕸️ graph index (src/graph/*): extraction, hybrid retrieval, ranking, bench
  editor-integrations/   # Setup writers: .gitignore, .gitattributes, shell rc, AGENTS.md, editor rules, secret hook, cli devDep, auto-rebuild git hooks
  hooks/                 # Claude Code lifecycle hook primitives (stdin/stdout protocol + settings installer)
  cli/                   # Commands, wizard, MCP client registry (claude/cursor/windsurf/codex/gemini)
  mcp-server/            # MCP server and tools (5 core + 4 graph)
```

Each package has:

- `src/` — TypeScript source
- `test/` — vitest tests
- `dist/` — built output (generated)

The graph layer lives in `packages/index/src/graph/` (schema, extraction,
indexer, query, hybrid retrieval, renderer) and is **strictly additive + fail-open**
on top of FTS — see [docs/graph.md](docs/graph.md).

## ✍️ Making Changes

### Before Implementing

1. Check the plan (`substrata-plan.md`) to understand scope
2. Review related documentation in `docs/`
3. If it's a larger feature, discuss via issue first

### Code Style

- **TypeScript**: strict mode, no `any` unless absolutely necessary
- **Naming**: PascalCase for types/classes, camelCase for functions/variables
- **Imports**: absolute paths via `@substrata/package`, not relative
- **Testing**: unit tests for core logic, snapshot tests for generated output

### Testing

Write tests for:

- Happy path
- Error cases
- Edge cases (empty inputs, invalid data, etc.)
- Security-relevant behavior (redaction, secret scanning)

Run tests locally before pushing:

```bash
pnpm test
```

To update snapshots after intentional changes:

```bash
pnpm test -- -u
```

### Documentation

- Update relevant `docs/*.md` files if behavior changes
- Include code examples that are tested and verified
- Keep documentation concise and scannable (headers, bullets, tables)

## 🔖 Versioning

Substrata uses Changesets for semantic versioning.

Before pushing your PR, create a changeset:

```bash
pnpm changeset
```

This opens an interactive prompt:

1. Select which packages changed (core, search, cli, mcp-server)
2. Choose bump type: patch, minor, major
3. Write a concise summary (one sentence)

Example changeset for a CLI improvement:

```
- cli: Add --json output to list command
```

Commit the generated `.changeset/*.md` file with your PR.

On release, changesets are combined, versions are bumped, and CHANGELOG is updated automatically.

## 🚀 Submitting a PR

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes, write tests, update docs
3. Ensure all checks pass: `pnpm build && pnpm test && pnpm lint && pnpm typecheck && pnpm format:check`
4. Create a changeset: `pnpm changeset`
5. Push and open a PR
6. Address review feedback

## 🧩 Common Tasks

### Adding a New CLI Command

1. Create `packages/cli/src/commands/my-command.ts`
2. Register in `packages/cli/src/index.ts` via `registerMyCommandCommand(program)`
3. Add tests in `packages/cli/test/` (e.g. `commands.test.ts`)
4. Update `docs/` and README if user-visible

> For a command **group** with subcommands (parent + `build`/`stats`/…), see
> `packages/cli/src/commands/graph.ts` as a worked example.

### Adding a New MCP Tool

1. Create `packages/mcp-server/src/tools/my-tool.ts` with a Zod input shape and handler
2. Register in `packages/mcp-server/src/server.ts`
3. Export types and test the handler in `packages/mcp-server/test/server.test.ts`
4. Update `docs/mcp.md`

### Adding an MCP Client (editor integration)

1. Create `packages/cli/src/mcp-clients/my-editor.ts` implementing `McpClient`
   (`detect` / `register` / `unregister`) — reuse `mergeMcpJson` for JSON configs
2. Add it to `MCP_CLIENTS` in `packages/cli/src/mcp-clients/registry.ts` (this
   auto-wires it into `init` detection and `substrata mcp install`)
3. If the editor has a native rules file, add a writer in
   `packages/editor-integrations/src/editor-rules.ts` (reuse `SUBSTRATA_RULES_MARKDOWN`)
4. Add tests in `packages/cli/test/mcp-clients.test.ts`

### Working on Search / Graph

1. FTS ranking: `packages/index/src/ranking.ts` (+ `test/ranking.test.ts`)
2. Graph extraction/expansion: `packages/index/src/graph/*` (+ `test/graph.test.ts`)
3. Keep the graph layer additive + fail-open; update `docs/graph.md` if user-visible

## ❓ Questions?

- Check `substrata-plan.md` for design decisions
- Review `docs/` for architecture details
- Look at existing code for patterns and conventions
- Open an issue for questions or discussion

## 🌟 Code of Conduct

Be respectful, inclusive, and constructive. We welcome all contributions.
