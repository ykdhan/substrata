# Substrata Roadmap

## v0.1 (MVP)

**Focus:** Local repo memory, CLI with setup wizard, full-text search, MCP integration, AGENTS.md rules.

- [x] Repository bootstrap (monorepo, TypeScript, build tooling)
- [x] Core file model (footprints, memory, types)
- [x] Footprint parsing and writing
- [x] CLI with init wizard (interactive setup, agent attribution, MCP registration)
- [x] Core commands: `add`, `list`, `show`, `doctor`, `supersede`
- [x] SQLite FTS5 search index
- [x] CLI commands: `search`, `context`, `index`
- [x] MCP server with 5 tools
- [x] Security: key-based redaction, content pattern scanning, block-on-secret
- [x] Documentation and examples
- [x] Pre-commit hook (optional)

## v0.2

**Focus:** Better developer experience, improved workflows, tighter integrations.

- Better `add --from-git` (auto-populate from commit, branch, changed files)
- Smarter `memory update` workflow with suggestions and review
- Git hook integration (auto-add footprints on PR creation)
- PR template integration (link to relevant memory, suggest footprint sections)
- Search ranking improvements (query expansion, synonym hints)
- CLI output improvements (better tables, export formats)
- Performance optimizations (lazy index loading, caching)
- More examples and templates

## v0.3

**Focus:** Semantic and hybrid search, agent session capture.

- Optional semantic search (local embeddings, optional remote embedding provider)
- Hybrid keyword + semantic ranking
- Repo-aware reranking (boost docs that reference similar files/tags)
- Agent session import (transcript analysis to auto-create footprints)
- Claude Code transcript import (if API becomes available)
- Advanced memory organization (sections, subsections, cross-links)
- Better conflict resolution for concurrent appends

## v0.4

**Focus:** UI and visualization.

- VSCode extension (browse footprints, create from editor, inline context)
- Web UI for footprint browsing and full-text search
- Footprint graph visualization (by file, tag, decision relationships)
- Team memory dashboard (recent activity, trending topics)
- Export to markdown/HTML

## v1.0

**Focus:** Stability and team adoption.

- Stable footprint schema (no breaking changes)
- Stable MCP tool signatures
- Team adoption guide and best practices
- Migration tools (ADR import, prior session logs)
- Multi-repo organization memory (optional federation)
- Enterprise support (audit logging, access control)

## Non-Goals (Not in Roadmap)

- Hosted service / cloud sync (users own their memory)
- GitHub App / PR bot (too heavyweight for MVP; can be added later)
- Automatic session recording (opt-in only; requires user intent)
- Multi-tenant organization (stay focused on single-repo teams first)
- Replacement for version control or formal documentation
