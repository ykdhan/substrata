# Substrata Implementation Plan

> This is the consolidated plan. All review revisions (merge-conflict handling,
> index freshness, redaction hardening, `confidence` removal, supersede flow,
> token-budget heuristic, `--from-git` actor resolution, naming/MCP validation)
> and the one-command `init` setup wizard are integrated directly into the
> relevant sections below.

## 0. Project Summary

### Project name

**Substrata**

### One-line description

A shared memory layer for AI coding agents that records important engineering decisions, implementation context, rejected alternatives, and repo-specific knowledge in a Git-friendly format so other agents can retrieve and use it later.

### Core idea

Git records **what changed**.

Substrata records **why an agent changed it, what it learned, what alternatives were rejected, and what future agents should remember**.

```txt
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

### Product positioning

> Stop re-explaining your codebase to every agent.

Alternative positioning:

> Shared project memory for AI engineering agents.

Substrata is not a replacement for Git commits, PR descriptions, ADRs, or documentation.
It is an **agent-native memory system** optimized for coding agents that need project context before making changes.

---

## 1. Problem Statement

AI coding agents are increasingly used by multiple engineers on the same codebase.
However, each agent session starts with limited memory.

This creates repeated friction:

- Agents rediscover the same repo conventions.
- Agents reverse previous decisions because they do not know the context.
- Engineers repeat the same explanations to different agents.
- PR reviewers give the same feedback repeatedly.
- Important rejected alternatives disappear from history.
- Commit messages explain the final change but not the investigation path.
- ADRs are too heavyweight for everyday agent work.

Substrata solves this by storing lightweight, structured, searchable memory inside the repo.

---

## 2. Core Concept

Substrata has two layers.

```txt
Footprint = one work session / decision / implementation record
Memory    = searchable knowledge extracted from footprints
```

### Footprint

A timestamped record of a meaningful agent-assisted engineering task.

A footprint answers:

- What was the purpose?
- Who requested the work?
- Which agent performed it?
- What files were touched?
- What decisions were made?
- What alternatives were rejected?
- What commands were run?
- What did the agent learn about the repo?
- What should future agents know?

### Memory

The accumulated, queryable knowledge derived from footprints and curated memory files.

Memory answers:

- What conventions does this repo follow?
- Why did we choose this architecture?
- Why should this file be modified in a particular way?
- What past decisions are relevant to this task?
- What should an agent check before changing this area?

---

## 3. Source of Truth Strategy

Use **Markdown/YAML files as the source of truth** and **SQLite as a generated local search index**.

```txt
.substrata/
  config.yml
  footprints/             # committed source of truth
  memory/                 # committed curated memory
  index/                  # ignored generated search index
  cache/                  # ignored temporary data
```

### Why files are the source of truth

Files are:

- Git-friendly
- PR-reviewable
- Easy to diff
- Easy to blame
- Easy to revert
- Easy for humans to read
- Easy for agents to read
- Portable across environments
- Long-term durable

### Why SQLite is used

SQLite is used only for search and indexing.
It must always be regenerable from repo files.

```txt
Markdown/YAML = canonical data
SQLite FTS    = local generated index
```

Do not store canonical memory only in SQLite.

---

## 4. Repository Layout

When initialized inside a repo:

```txt
.substrata/
  config.yml
  README.md
  footprints/
    2026/
      06/
        2026-06-09-learner-search-performance-k7m2qx.md
  memory/
    conventions.md
    architecture.md
    domain/
      learner-search.md
  templates/
    footprint.md
    memory.md
  index/
    footprint.sqlite       # gitignored
  cache/
    embeddings/            # gitignored, future use
```

**Footprint filenames carry a short random suffix** (see §5) so that two agents
creating same-day footprints with the same slug never collide:

```txt
YYYY/MM/YYYY-MM-DD-<slug>-<base32-6>.md
```

Recommended `.gitignore` additions:

```gitignore
.substrata/index/
.substrata/cache/
.substrata/tmp/
```

Committed files:

```txt
.substrata/config.yml
.substrata/README.md
.substrata/footprints/**/*.md
.substrata/memory/**/*.md
.substrata/templates/**/*.md
```

Ignored files:

```txt
.substrata/index/**
.substrata/cache/**
.substrata/tmp/**
```

### Concurrency & merge-conflict strategy

Multiple agents may work on the same branch or PR. Substrata minimizes the
conflict surface structurally rather than attempting automatic merge resolution:

- **Footprints are append-only.** A correction is a *new* footprint that
  supersedes the old one (see §5), not an in-place edit. Each agent writes a
  distinct new file, so footprint files almost never conflict.
- **Filenames and IDs carry a 6-char random suffix**, eliminating same-day
  same-slug collisions.
- **Memory files use delimited, append-friendly sections** (see §6) so two agents
  appending different learnings touch different regions; concurrent appends
  conflict only on a trailing marker line, which is trivially resolvable.

MVP stance: Substrata does not attempt automatic merge resolution. It
minimizes conflict surface and relies on Git for the rest.

---

## 5. Footprint File Format

Use Markdown with YAML frontmatter.

**ID format** (note the random suffix):

```txt
id        : fp_<YYYYMMDD>_<slug>_<base32-6>
filename  : YYYY/MM/YYYY-MM-DD-<slug>-<base32-6>.md
example   : fp_20260609_learner_search_performance_k7m2qx
```

### Example footprint

```md
---
schema_version: 1
id: fp_20260609_learner_search_performance_k7m2qx
created_at: 2026-06-09T10:30:00+09:00
updated_at: 2026-06-09T10:45:00+09:00
actor: claude-code
requester: david.han
agent_model: claude-sonnet-4
work_type: implementation_decision
status: completed

repo:
  name: outschool/app
  branch: feature/learner-search-performance

related:
  commits:
    - abc123
  prs:
    - 456
  issues:
    - ENG-789
  supersedes: []
  superseded_by: []

files_touched:
  - api/learners.ts
  - services/LearnerQueryService.ts
  - db/migrations/20260609103000_add_learner_cursor_index.sql

tags:
  - learner-search
  - pagination
  - performance
  - backend
---

# Improve learner search performance

## Purpose

Large organizations were seeing slow learner search because the existing implementation loaded too many records and filtered them on the client.

## Decisions

- Move learner search pagination to the backend.
- Use cursor pagination instead of offset pagination.
- Route learner-related queries through `LearnerQueryService`.
- Add an index on the cursor field used by learner search.

## Rejected options

### Redis cache

Rejected because it would introduce consistency risk and operational overhead for learner profile data.

### Offset pagination

Rejected because offset pagination becomes slower for large organizations with many learners.

## Implementation notes

- Added cursor-based pagination parameters to the learner search endpoint.
- Updated the frontend query to pass `afterCursor`.
- Added a DB migration for the cursor field index.

## Commands run

```bash
pnpm test learner-search
pnpm typecheck
pnpm db:migrate
```

## Memory learned

- This repo avoids the repository pattern for learner domain logic.
- Learner-related DB access should go through `LearnerQueryService`.
- Avoid client-side filtering for organization-level learner data.

## Future agent guidance

Before changing learner search again:

1. Check `LearnerQueryService` first.
2. Avoid Redis cache unless consistency requirements have changed.
3. Preserve cursor pagination unless there is a strong reason to replace it.
4. Run learner search performance tests.
```

> **Note on `confidence`:** the original draft included a `confidence: 0.82`
> frontmatter field. It is **removed from the MVP** because it had no defined
> author, scale, or consumer, and an agent emitting arbitrary numbers only adds
> noise. If reintroduced later, it must be defined precisely as an agent
> self-report (0..1, "how settled is this decision"), surfaced as an advisory
> caveat in `show`/`context`, and **never used in search ranking**.

### Supersede relationships

When a later footprint replaces an earlier decision, the relationship is recorded
explicitly via `related.supersedes` / `related.superseded_by` and the old
footprint's `status` becomes `superseded`. This is produced by the `supersede`
command (see §8.9) and consumed by ranking (see §11) to demote stale decisions.

---

## 6. Curated Memory File Format

Memory files are durable summaries that future agents should read often.
They are not tied to one task.

To keep concurrent appends conflict-light, memory entries live between stable
markers, and `memory update` appends new entries before the end marker without
rewriting existing ones.

### Example memory file

```md
---
schema_version: 1
id: mem_repo_conventions
updated_at: 2026-06-09T10:45:00+09:00
type: repo_conventions
tags:
  - conventions
  - architecture
---

# Repo conventions

## Service layer

- Prefer domain services over repository classes.
- Learner-related DB access should go through `LearnerQueryService`.
- Payment-related logic should go through `PaymentService`.

## Testing

- Add unit tests for domain services.
- Add integration tests for API behavior when modifying user-facing flows.

## Agent guidance

Before making non-trivial changes:

1. Search Substrata for relevant files.
2. Check domain-specific memory files.
3. Do not introduce new architectural patterns without leaving a footprint.

<!-- substrata:entries:start -->
<!-- substrata:entry id=fp_20260609_learner_search_performance_k7m2qx -->
- Learner-related DB access should go through `LearnerQueryService`.
<!-- /substrata:entry -->
<!-- substrata:entries:end -->
```

---

## 7. Data Model

### Footprint metadata

```ts
export type FootprintFrontmatter = {
  schema_version: 1;
  id: string;
  created_at: string;
  updated_at?: string;

  actor: string;
  requester?: string;
  agent_model?: string;

  work_type:
    | "implementation"
    | "implementation_decision"
    | "bug_fix"
    | "refactor"
    | "investigation"
    | "architecture_decision"
    | "test_update"
    | "documentation";

  status: "draft" | "completed" | "superseded" | "deprecated";

  repo?: {
    name?: string;
    branch?: string;
  };

  related?: {
    commits?: string[];
    prs?: Array<string | number>;
    issues?: Array<string | number>;
    urls?: string[];
    supersedes?: string[];      // ids this footprint replaces
    superseded_by?: string[];   // ids that replace this one (tool-maintained)
  };

  files_touched?: string[];
  tags?: string[];
};
```

> `confidence` is intentionally omitted (see §5). If added in v0.3+, document it
> as advisory-only and keep it out of ranking.

### Parsed footprint

```ts
export type Footprint = {
  frontmatter: FootprintFrontmatter;
  title: string;
  body: string;
  sections: {
    purpose?: string;
    decisions?: string[];
    rejectedOptions?: Array<{
      option: string;
      reason: string;
    }>;
    implementationNotes?: string;
    commandsRun?: string[];
    memoryLearned?: string[];
    futureAgentGuidance?: string;
  };
  filePath: string;
  raw: string;
};
```

### Search result

```ts
export type SearchResult = {
  id: string;
  title: string;
  filePath: string;
  score: number;
  snippet: string;
  tags: string[];
  createdAt?: string;
  filesTouched: string[];
  status: "draft" | "completed" | "superseded" | "deprecated";
};
```

---

## 8. CLI Design

Binary name:

```bash
substrata
```

A short alias (e.g. `sub`) is **not registered as an npm bin in MVP** (such short
names collide with existing tools); users may alias locally if they wish.

### 8.1 `init` — One-command setup wizard

Initialize Substrata via an interactive wizard. One command does
everything; every prompt has a default, so pressing Enter through the wizard
yields a working, agent-integrated setup. There is **no standalone setup script** —
its responsibilities live here.

```bash
npx substrata init          # interactive wizard
npx substrata init --yes    # accept all defaults, no prompts
```

Realistic onboarding for a fresh repo is 2–3 lines:

```bash
npx substrata init           # scaffold, env, AGENTS.md, MCP, initial index
source ~/.zshrc                    # load attribution env vars (wizard names the file)
substrata context "..."      # first query — index builds automatically
```

**Wizard flow.** Answers are collected first; the wizard prints a change plan and
writes nothing until one final confirmation, so it can be aborted cleanly.

```txt
0. Preflight (no prompts): verify Git repo (offer `git init`), detect package
   manager, detect MCP-capable clients, detect existing .substrata/
   (→ update mode).
1. Project basics: project name (default from package.json/folder), footprints dir.
2. Agent attribution: default actor / model / requester; offer to persist as env
   vars to the shell rc (zsh/bash detected). Decline → prints export snippet;
   missing values fall back to "unknown-agent" (non-fatal).
3. Security defaults: redaction + content scan (default yes); refuse write on
   detected secret (default yes); optional pre-commit hook (default no).
4. AGENTS.md: insert the Substrata section between begin/end markers
   (default yes; no duplication on re-run).
5. MCP registration: multi-select among detected clients (Claude Code, Cursor,
   Windsurf, …). Claude Code → `claude mcp add --scope project`; others → merged
   JSON block or printed snippet.
6. Plan & confirm: print summary of all intended changes, confirm once, apply,
   then run the embedded health check (the `doctor` logic).
```

**Created on apply**

```txt
.substrata/config.yml
.substrata/README.md
.substrata/footprints/
.substrata/memory/
.substrata/templates/
```

Plus, depending on answers: `.gitignore` entries, a shell-rc env block,
`AGENTS.md` section, MCP client registration (e.g. `.mcp.json`), an initial
search index, and an optional pre-commit hook.

**Idempotency / update mode.** If `.substrata/` already exists, `init`
enters update mode: existing footprints/memory are never overwritten; the env
block and AGENTS.md section use begin/end markers and are replaced in place; MCP
registration is remove-then-add. The safe answer to "did my setup drift?" is to
re-run `init`.

**Flags**

```bash
--yes                 Accept all defaults, no prompts
--project <name>      Project name
--actor <id>          Default actor
--model <id>          Default agent model
--requester <id>      Default requester
--no-env              Don't touch shell rc; print snippet instead
--no-agents-md        Skip AGENTS.md
--no-mcp              Skip MCP registration
--mcp-client <name>   Register only this client (claude|cursor|windsurf); repeatable
--no-gitignore        Don't edit .gitignore
--no-redact           Disable security redaction (NOT recommended)
--with-hook           Install the pre-commit secret hook
--no-index            Skip building the initial index
--print-config        Print resolved config.yml without writing anything
```

Non-TTY contexts (piped input, CI) behave as `--yes`.

### 8.2 `add`

Create a new footprint.

Interactive mode:

```bash
substrata add
```

Non-interactive mode:

```bash
substrata add \
  --title "Improve learner search performance" \
  --purpose "Reduce latency for large organizations" \
  --actor "claude-code" \
  --requester "david.han" \
  --files "api/learners.ts,services/LearnerQueryService.ts" \
  --tag learner-search \
  --tag performance
```

From Git changes:

```bash
substrata add --from-git
```

This inspects the current branch, staged files, unstaged files, and the recent
commit to populate `repo.branch`, `files_touched`, and `related.commits`.

**Actor / model / requester resolution.** These cannot be inferred from Git, so
they resolve by precedence (first non-empty wins):

```txt
actor:       --actor  →  $SUBSTRATA_ACTOR      →  config agent.default_actor  →  "unknown-agent"
agent_model: --model  →  $SUBSTRATA_MODEL      →  config agent.default_model  →  omitted
requester:   --requester → $SUBSTRATA_REQUESTER → git config user.email       →  omitted
```

Before writing, `add` runs the secret scan (see §12). If secrets remain after
redaction and `security.block_on_secret` is true, the write is refused (override
with `--allow-secret`, not recommended — footprints are committed).

From template:

```bash
substrata add --template implementation_decision
```

### 8.3 `search`

Search footprints and memory.

```bash
substrata search "why did we avoid Redis for learner search"
```

If the index is missing or stale, `search` rebuilds it automatically (see §8.5)
unless `--no-auto-index` is passed.

Options:

```bash
substrata search "pagination" --json
substrata search "learner" --files api/learners.ts
substrata search "Redis" --tag performance
substrata search "learner" --limit 5
substrata search "learner" --exclude-superseded
```

By default `search` includes superseded footprints (demoted in ranking) so humans
can trace history; `--exclude-superseded` drops them.

### 8.4 `context`

Return concise context for an agent before work begins.

```bash
substrata context "I need to improve learner search performance"
```

Output is optimized for LLM consumption. `context` **excludes superseded
footprints by default** — agents about to do work should see the current decision,
not the replaced one. Like `search`, it auto-(re)builds a stale/missing index.

Example output:

```txt
Relevant Substrata context:

1. Learner search uses cursor pagination.
   Reason: offset pagination was rejected for large organizations.
   Source: .substrata/footprints/2026/06/2026-06-09-learner-search-performance-k7m2qx.md

2. Avoid Redis cache for learner search unless consistency requirements changed.
   Reason: Redis was previously rejected due to consistency risk and operational overhead.
   Source: .substrata/footprints/2026/06/2026-06-09-learner-search-performance-k7m2qx.md

3. Learner-related DB access should go through LearnerQueryService.
   Source: .substrata/memory/domain/learner-search.md
```

**Token budget.** `--max-tokens` uses a documented character-based approximation
(`ceil(chars / 3.5)`), not a real tokenizer, and rounds up so it under-fills
rather than overflows. No tokenizer dependency is bundled in MVP. The output notes
that counts are approximate. Sources are added in ranked order until the budget
would be exceeded.

Options:

```bash
substrata context "task" --json
substrata context "task" --max-tokens 1200
substrata context "task" --files api/learners.ts
```

### 8.5 `index`

Build or rebuild the local search index.

```bash
substrata index
substrata index --rebuild
```

This generates `.substrata/index/footprint.sqlite`.

Because `index/` is gitignored, it is **always absent right after clone**. This is
normal: `search` and `context` lazily (re)build a missing or stale index on first
use. Freshness is determined by comparing the index's recorded `source_max_mtime`
and `source_file_count` (stored in an `index_meta` table) against a cheap stat
walk of the footprint and memory directories — no file parsing required.

### 8.6 `list`

List recent footprints.

```bash
substrata list
substrata list --tag learner-search
substrata list --file api/learners.ts
substrata list --since 2026-06-01
```

### 8.7 `show`

Show one footprint.

```bash
substrata show fp_20260609_learner_search_performance_k7m2qx
```

Options:

```bash
substrata show fp_... --json
substrata show fp_... --path
```

### 8.8 `doctor`

Check repository setup.

```bash
substrata doctor
```

Checks (a missing/stale index is reported as informational, **not** an error;
exit code stays 0 unless there is a genuine fault):

```txt
✔ .substrata exists
✔ config valid
ℹ index missing — run `substrata index` (or it builds automatically on first search)
✔ gitignore covers index/ and cache/
✔ 12 footprint files parsed
✔ 3 memory files parsed
```

Non-zero exit only for: invalid config, unparseable footprint/memory files, or a
gitignore that would commit the generated DB.

### 8.9 `supersede`

Mark an old footprint as replaced by a new one.

```bash
substrata supersede <old-id> --by <new-id>
# or, when creating the replacement in one step:
substrata add --supersedes <old-id> --title "..." --purpose "..."
```

Atomically: sets `status: superseded` and appends `<new-id>` to `superseded_by`
on the old footprint (frontmatter only — body is never rewritten), and appends
`<old-id>` to `supersedes` on the new one.

### 8.10 `memory update`

Update curated memory from footprints.

```bash
substrata memory update
```

MVP behavior:

- Scan recent footprints; extract `Memory learned` sections.
- Append suggested entries before the `substrata:entries:end` marker; never rewrite
  existing entries.
- Do not auto-edit without confirmation unless `--yes` is passed.

```bash
substrata memory update --since 2026-06-01
substrata memory update --yes
```

### 8.11 `hook` (optional)

Install a pre-commit hook that runs the secret scan over staged
`.substrata/**` files as a second line of defense.

```bash
substrata hook install
```

### 8.12 `mcp`

Run the MCP server (see §9).

```bash
substrata mcp
```

---

## 9. MCP Server Design

Substrata ships with an MCP server so AI agents can call it directly.

Command:

```bash
substrata mcp
```

MCP tool names use **underscores only** (dots are not universally safe across MCP
clients):

#### `substrata_search`

Input:

```ts
{ query: string; limit?: number; files?: string[]; tags?: string[]; excludeSuperseded?: boolean; }
```

Output:

```ts
{ results: SearchResult[]; }
```

#### `substrata_context`

Input:

```ts
{ task: string; files?: string[]; maxTokens?: number; }
```

Output:

```ts
{
  context: string;
  sources: Array<{ id: string; title: string; filePath: string; }>;
}
```

#### `substrata_add`

Input:

```ts
{
  title: string;
  purpose: string;
  actor: string;
  requester?: string;
  workType?: string;
  decisions?: string[];
  rejectedOptions?: Array<{ option: string; reason: string; }>;
  implementationNotes?: string;
  memoryLearned?: string[];
  futureAgentGuidance?: string;
  filesTouched?: string[];
  tags?: string[];
  supersedes?: string[];
  related?: {
    commits?: string[];
    prs?: Array<string | number>;
    issues?: Array<string | number>;
    urls?: string[];
  };
}
```

Output:

```ts
{ id: string; filePath: string; }
```

The `add` tool runs the same secret scan as the CLI; a detected secret causes a
structured error rather than a silent write.

#### `substrata_related_to_file`

Input:

```ts
{ filePath: string; limit?: number; }
```

Output:

```ts
{ results: SearchResult[]; }
```

#### `substrata_list_recent`

Input:

```ts
{ limit?: number; tags?: string[]; }
```

Output:

```ts
{ results: SearchResult[]; }
```

---

## 10. AGENTS.md Integration

AGENTS.md generation is a default step of the `init` wizard (§8.1, step 4),
controllable via `--no-agents-md`. The section is inserted between begin/end
markers so repeated `init` runs replace it in place rather than duplicating.

Recommended section:

```md
<!-- substrata:start -->
## Substrata Rules

This repository uses Substrata for shared agent memory.

Set these once per agent session so footprints are attributed correctly:
- `SUBSTRATA_ACTOR`     (e.g. "claude-code")
- `SUBSTRATA_MODEL`     (e.g. "claude-opus-4")
- `SUBSTRATA_REQUESTER` (falls back to git user.email)

Before making non-trivial changes:

1. Run `substrata context "<task description>"`.
2. Search for relevant files using `substrata search` or the MCP tool `substrata_context`.
3. Respect prior architectural decisions unless the user explicitly asks to override them.

After making non-trivial changes:

1. Add a footprint with `substrata add` or MCP tool `substrata_add`.
2. Include: purpose, requester, actor, files changed, decisions made, rejected
   alternatives, implementation notes, commands run, memory learned, future agent guidance.
3. If the work changes durable repo conventions, update `.substrata/memory/`.
4. If the work reverses a prior decision, use `substrata supersede`.

Do not store secrets, credentials, private keys, tokens, or sensitive user data in Substrata files.
<!-- substrata:end -->
```

---

## 11. Search Architecture

### MVP search

Use SQLite FTS5.

Index: footprint title, purpose, decisions, rejected options, implementation
notes, memory learned, future agent guidance, tags, files touched, and curated
memory files.

### SQLite schema

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT,
  created_at TEXT,
  updated_at TEXT,
  tags_json TEXT NOT NULL,
  files_json TEXT NOT NULL,
  raw_text TEXT NOT NULL
);

CREATE VIRTUAL TABLE documents_fts USING fts5(
  id UNINDEXED,
  title,
  tags,
  files,
  content,
  tokenize = 'porter unicode61'
);

-- freshness metadata so search/context can detect a stale or missing index
CREATE TABLE index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- rows: schema_version, built_at, source_max_mtime, source_file_count
```

### Index freshness

```ts
export type IndexStatus =
  | { state: "missing" }
  | { state: "stale"; reason: "mtime" | "count" | "schema" }
  | { state: "fresh" };

export function getIndexStatus(cwd: string): Promise<IndexStatus>;
```

`search` and `context` call `getIndexStatus` first and auto-(re)build on
`missing`/`stale` unless `--no-auto-index` is set, so a freshly cloned repo "just
works" on the first query.

### Ranking (MVP)

```txt
1. Apply hard file/tag filters.
2. Query FTS5; take BM25 score s.
3. Multiplicative boosts:
   - files_touched overlaps queried files:            × 1.5
   - recency: × (1 + 0.15 * recencyDecay(updated_at))   # decays to ~0 over ~180 days
   - work_type == architecture_decision:               recency boost is HALVED
       (durable decisions should not be demoted just for being old)
4. Status penalties (multiplicative):
   - status == superseded:   × 0.15
   - status == deprecated:   × 0.10
   - status == draft:        × 0.50
5. superseded/deprecated are demoted but still returned by `search`;
   `context` and `--exclude-superseded` drop them entirely.
```

### APIs

```ts
buildIndex(cwd: string, options?: BuildIndexOptions): Promise<void>;
getIndexStatus(cwd: string): Promise<IndexStatus>;
search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
getRelatedToFile(filePath: string, options?: SearchOptions): Promise<SearchResult[]>;
```

### Future search

Later versions can add embeddings, a local vector index, a remote embedding
provider, hybrid keyword + semantic search, and repo-aware reranking. Do not
implement vector search in MVP.

---

## 12. Security and Privacy

Substrata files are committed to the repo, so security defaults must be
conservative — a leaked secret enters permanent history.

### Never store by default

API keys, access/refresh tokens, cookies, private keys, passwords, production
customer data, sensitive personal data, raw database dumps, and private
Slack/email content unless explicitly approved by the team.

### Key-based redaction

Recursive redaction for common keys, replacing values with `[REDACTED]`:

```ts
const DEFAULT_REDACTION_KEYS = [
  "token", "apiKey", "api_key", "authorization", "password", "secret",
  "cookie", "set-cookie", "privateKey", "accessToken", "refreshToken",
];
```

### Content (pattern) scanning

Key-based redaction misses secrets embedded in prose/command output, so a content
scanner runs over the rendered footprint body:

```ts
export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "aws_access_key_id",   re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github_pat",          re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: "github_fine_grained", re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: "gitlab_pat",          re: /\bglpat-[A-Za-z0-9_-]{20}\b/ },
  { name: "slack_token",         re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "google_api_key",      re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "openai_key",          re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "anthropic_key",       re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "jwt",                 re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "private_key_block",   re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "bearer_header",       re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
  { name: "url_basic_auth",      re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i },
];

export function scanForSecrets(text: string): Array<{ name: string; line: number }>;
```

An optional high-entropy heuristic (off by default to limit false positives) can
flag long standalone tokens.

### Behavior on detection

`add` (CLI and MCP) scans before writing. If matches remain after automatic
redaction and `block_on_secret` is true, the write is **refused** with offending
line numbers and pattern names (never the secret value):

```txt
✖ Refusing to write footprint: 2 potential secrets detected
  - github_pat at body line 14
  - jwt at body line 27
  Redact these or pass --allow-secret to override (NOT recommended — footprints are committed).
```

### Defense in depth

`substrata hook install` adds a pre-commit hook running the same scan over
staged files, since the CLI scan can be bypassed by hand-editing files. The CLI
scan is best-effort, not a guarantee — `docs/security.md` states this plainly.

### CLI warning

When adding a footprint, print:

```txt
Reminder: Substrata files are intended to be committed.
Do not include secrets, credentials, or sensitive user data.
```

---

## 13. Configuration

`.substrata/config.yml`

```yaml
schema_version: 1
project:
  name: substrata-demo

storage:
  footprints_dir: .substrata/footprints
  memory_dir: .substrata/memory
  index_path: .substrata/index/footprint.sqlite

search:
  default_limit: 8
  max_context_tokens: 1600        # estimated via chars/3.5, not a real tokenizer

security:
  redact: true
  scan_content: true              # pattern scan on body
  entropy_scan: false             # high-entropy heuristic (off by default)
  entropy_min_length: 32
  block_on_secret: true           # refuse to write if a secret remains after redaction
  redaction_keys:
    - token
    - apiKey
    - api_key
    - authorization
    - password
    - secret
    - cookie
    - privateKey
    - accessToken
    - refreshToken

agent:
  default_actor: unknown-agent
  default_model: ~                # optional
  require_footprint_after_non_trivial_work: true
```

---

## 14. Package Architecture

Use a TypeScript monorepo.

```txt
substrata/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
  LICENSE
  .gitignore
  .github/
    workflows/
      ci.yml

  packages/
    core/
      src/
        index.ts
        types.ts
        config.ts
        paths.ts
        ids.ts            # includes short random-suffix id generation
        redaction.ts      # key-based + content/pattern scan
        markdown.ts
        footprint.ts
        memory.ts
        supersede.ts
        errors.ts
        setup/            # pure, dry-runnable setup writers (used by the init wizard)
          gitignore.ts
          shellrc.ts
          agents-md.ts
          hook.ts
          plan.ts
      test/

    search/
      src/
        index.ts
        sqlite.ts
        schema.ts
        indexer.ts
        query.ts
        ranking.ts
        freshness.ts      # getIndexStatus
      test/

    cli/
      src/
        index.ts
        commands/
          init.ts
          add.ts
          search.ts
          context.ts
          index.ts
          list.ts
          show.ts
          doctor.ts
          supersede.ts
          memory-update.ts
          hook.ts
          mcp.ts
        wizard/
          init-wizard.ts  # orchestrates steps, plan/apply, TTY detection
          prompts.ts      # wrapper over @clack/prompts (or prompts)
        mcp-clients/
          registry.ts     # table of supported clients
          claude-code.ts
          cursor.ts
          windsurf.ts
        render/
          table.ts
          context.ts
      test/

    mcp-server/
      src/
        index.ts
        server.ts
        tools/
          search.ts
          context.ts
          add.ts
          related-to-file.ts
          list-recent.ts
      test/

  examples/
    basic-repo/
    claude-code/

  docs/
    architecture.md
    footprint-format.md
    memory-format.md
    mcp.md
    security.md
    roadmap.md
```

### Packages

#### `@substrata/core`

Responsible for: config loading, path handling, footprint/memory parsing and
writing, markdown/frontmatter utilities, redaction (key-based + content scan), ID
generation (with random suffix), supersede frontmatter edits, and the
**setup writers** under `setup/`. Each setup writer is a pure function with a
dry-run mode that returns its intended change, so the `init` wizard can show a
plan and so they are unit-testable without spawning a shell.

```ts
ensureGitignore(cwd: string, dry?: boolean): ChangeResult;
writeShellEnv(rc: string, vars: AttributionEnv, dry?: boolean): ChangeResult;
upsertAgentsMd(cwd: string, dry?: boolean): ChangeResult;
installSecretHook(cwd: string, dry?: boolean): ChangeResult;
```

#### `@substrata/search`

Responsible for: SQLite index, FTS schema, indexing, querying, ranking, and index
freshness (`getIndexStatus`).

#### `@substrata/cli`

Responsible for: the CLI binary, user-facing commands, the `init` wizard, the MCP
client registry, and output rendering. The MCP client registry is a small table
so new clients can be added without touching the wizard flow:

```ts
export type McpClient = {
  name: string;                                   // "claude" | "cursor" | "windsurf"
  detect(): Promise<boolean>;
  register(server: McpServerSpec, dry?: boolean): Promise<ChangeResult>;
  unregister(name: string): Promise<void>;
};
```

#### `@substrata/mcp-server`

Responsible for: the MCP server and tool definitions, calling core/search
functions. Tool names use underscores (§9).

---

## 15. Implementation Phases

## Phase 1: Repository bootstrap

### Goal

Create the TypeScript monorepo foundation.

### Tasks

- Set up pnpm workspace, TypeScript config, tsup builds, vitest, eslint, prettier,
  GitHub Actions CI, MIT license, changesets.
- **Pre-release name check:** verify `substrata` and the `@substrata/*`
  scope are free on npm (`npm view substrata` → expect 404) before any code
  references the name; pick a fallback if taken. Do not register a short alias bin.

### Acceptance criteria

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

---

## Phase 2: Core file model

### Goal

Implement parsing and writing of footprint and memory files.

### Tasks

Implement `packages/core`: `types.ts`, `config.ts`, `paths.ts`, `ids.ts`
(with random suffix), `redaction.ts` (key-based + content scan), `markdown.ts`,
`footprint.ts`, `memory.ts`, `supersede.ts`, `errors.ts`, `index.ts`.

### Core APIs

```ts
loadConfig(cwd: string): Promise<AgentFootprintConfig>;
initProject(cwd: string, options: InitOptions): Promise<void>;
parseFootprintFile(path: string): Promise<Footprint>;
writeFootprint(input: WriteFootprintInput): Promise<Footprint>;
listFootprints(cwd: string): Promise<Footprint[]>;
parseMemoryFile(path: string): Promise<MemoryDocument>;
listMemoryDocuments(cwd: string): Promise<MemoryDocument[]>;
redactDeep(value: unknown, options?: RedactionOptions): unknown;
scanForSecrets(text: string): Array<{ name: string; line: number }>;
supersedeFootprint(cwd: string, oldId: string, newId: string): Promise<void>;
```

### Acceptance criteria

- Can initialize `.substrata`, write/parse footprints and memory, parse
  frontmatter, validate required metadata.
- IDs/filenames include a random suffix; no same-day collisions.
- Redaction covers key-based and content/pattern cases.
- Unit tests cover happy paths, invalid files, and secret detection.

---

## Phase 3: CLI core commands + `init` wizard

### Goal

Build the first usable CLI, with `init` as a one-command setup wizard. (This phase
absorbs AGENTS.md integration, which is now a wizard step.)

### Commands

```bash
substrata init        # interactive setup wizard
substrata add
substrata list
substrata show <id>
substrata doctor
substrata supersede <old-id> --by <new-id>
```

### Tasks

- Use `commander` or `cac` for commands; `@clack/prompts` (or `prompts`) for
  prompts with defaults, multi-select, and a non-TTY guard.
- Implement the `init` wizard (steps 0–6 of §8.1) using core setup writers and the
  MCP client registry, with plan-then-apply and update-mode idempotency.
- Implement `add` (interactive + non-interactive, `--from-git`, actor/env
  precedence, secret-scan gate), `list`, `show <id>` (`--json`), `doctor`,
  `supersede`.
- Implement the MCP client registry with at least Claude Code; Cursor/Windsurf as
  config-file writers with snippet fallback.

### Acceptance criteria

```bash
npx substrata init --yes
substrata init            # Enter-through yields a working setup
substrata init            # re-run = update mode, no duplication
substrata add --title "Test" --purpose "Test purpose" --actor "claude-code"
substrata list
substrata show <id>
substrata doctor
```

- Wizard writes nothing before final confirmation; abort leaves the repo unchanged.
- Non-TTY invocation behaves as `--yes`.
- No duplicate `.gitignore` lines, env blocks, AGENTS.md sections, or MCP
  registrations on re-run.
- Setup writers are unit-tested in `core` without spawning a shell.

---

## Phase 4: SQLite FTS index

### Goal

Implement the local searchable index with freshness tracking.

### Tasks

Implement `packages/search`: `sqlite.ts`, `schema.ts` (incl. `index_meta`),
`indexer.ts`, `query.ts`, `ranking.ts` (status penalties + architecture_decision
recency exemption), `freshness.ts`, `index.ts`. Use SQLite with FTS5
(`better-sqlite3` preferred for simple sync operations).

### APIs

```ts
buildIndex(cwd: string, options?: BuildIndexOptions): Promise<void>;
getIndexStatus(cwd: string): Promise<IndexStatus>;
search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
getRelatedToFile(filePath: string, options?: SearchOptions): Promise<SearchResult[]>;
```

### Acceptance criteria

- Indexes footprints and memory; search returns relevant results.
- Supports file and tag filters; supports `--exclude-superseded`.
- Index rebuilds from scratch; `getIndexStatus` correctly reports
  missing/stale/fresh.
- Superseded/deprecated docs are demoted in ranking.

> **better-sqlite3 note:** it is a native module and can be hard to install in
> some environments (Node version, ARM, corporate proxy). Document troubleshooting
> in the README; consider a pure-JS fallback (e.g. `sql.js`) as a future option.

---

## Phase 5: CLI search/context/index

### Goal

Expose search and agent-oriented context generation, with lazy index rebuild.

### Commands

```bash
substrata index
substrata search "query"
substrata context "task description"
```

### Context output rules

Concise, source-linked memory for agents: prefer durable memory files; include
footprint sources and file paths; avoid excessive prose; fit a configurable token
budget (`chars/3.5` estimate); exclude superseded by default; return JSON with
`--json`.

### Acceptance criteria

```bash
substrata index --rebuild
substrata search "Redis learner search"
substrata context "Improve learner search"
```

return useful results, and `search`/`context` auto-build a missing/stale index.

---

## Phase 6: MCP server

### Goal

Allow AI agents to query and write footprints through MCP tools.

### Command

```bash
substrata mcp
```

### Tools

`substrata_search`, `substrata_context`, `substrata_add`
(secret-scan gated), `substrata_related_to_file`, `substrata_list_recent`.

### Acceptance criteria

A local MCP client can call `substrata_context({ task: "Improve learner
search" })` and receive relevant memory.

---

## Phase 7: Memory update helper

### Goal

Help maintain curated memory from accumulated footprints.

### Command

```bash
substrata memory update
```

### MVP behavior

Scan recent footprints, extract `Memory learned` sections, append suggested
entries before the `substrata:entries:end` marker, ask for confirmation before writing
(unless `--yes`). Do not implement full autonomous summarization; if an LLM is
used later, make it optional.

### Acceptance criteria

The command suggests memory updates and can write them to
`.substrata/memory/` without rewriting existing entries.

---

## Phase 8: Quality polish

### Tasks

- Better error messages; snapshot tests for generated markdown; cross-platform
  path handling; README quickstart; example repo; security documentation;
  release preparation.
- Optional pre-commit secret hook (`hook install`).

### Acceptance criteria

- New user can initialize and use the tool in under 5 minutes via one `init`.
- Claude Code can read the plan and follow the repo instructions.
- All tests pass.

---

## 16. Claude Code Task Prompts

Use these tasks sequentially with Claude Code.

### Task 1: Bootstrap repo

```txt
Create a TypeScript pnpm monorepo for a project named substrata.

Packages: packages/core, packages/search, packages/cli, packages/mcp-server.
Use: TypeScript, pnpm workspaces, tsup, vitest, eslint, prettier, changesets.
Add root scripts: build, test, lint, typecheck, format.
Verify the npm name `substrata` and `@substrata/*` scope are free
before committing to the name. Do not register a short alias bin.
Do not implement product logic yet. Only scaffold the repository.
```

### Task 2: Implement core file model

```txt
Implement packages/core for Substrata.

Create: types.ts, config.ts, paths.ts, ids.ts, redaction.ts, markdown.ts,
footprint.ts, memory.ts, supersede.ts, errors.ts, index.ts.

Support: initProject, loadConfig, parseFootprintFile, writeFootprint,
listFootprints, parseMemoryFile, listMemoryDocuments, recursive redaction,
content/pattern secret scanning (scanForSecrets), random-suffix id generation,
and supersedeFootprint.

Use Markdown with YAML frontmatter. Do NOT include a `confidence` field.
Add vitest tests for parsing, writing, config loading, redaction, and secret detection.
```

### Task 3: Implement CLI core commands + init wizard

```txt
Implement packages/cli with commands:
- substrata init   (interactive setup wizard)
- substrata add
- substrata list
- substrata show <id>
- substrata doctor
- substrata supersede <old-id> --by <new-id>

The `init` wizard must:
- Run ordered steps: preflight, project basics, agent attribution (env vars),
  security defaults, AGENTS.md, MCP registration.
- Give every prompt a default; Enter-through yields a working setup. Support --yes.
- Collect answers, show a change plan, and apply only after one final confirm.
  Write nothing before confirmation.
- Be idempotent: re-running enters update mode and never duplicates .gitignore
  lines, the shell-rc env block, the AGENTS.md section, or MCP registrations.
- Detect non-TTY (piped/CI) input and behave as --yes.

Use commander or cac and @clack/prompts (or prompts). Put side-effecting setup
writers (gitignore, shell-rc, AGENTS.md, hook) in @substrata/core as pure
functions with a dry-run mode, unit-tested without spawning a shell. Implement an
MCP client registry (Claude Code via `claude mcp add --scope project`;
Cursor/Windsurf via config-file writers with a printed-snippet fallback).

The add command supports interactive and non-interactive usage, --from-git, and
the actor/env precedence; it runs the secret scan before writing and refuses on
detection unless --allow-secret. show supports --json.
```

### Task 4: Implement SQLite search index

```txt
Implement packages/search using SQLite FTS5.

Create: sqlite.ts, schema.ts (incl. index_meta), indexer.ts, query.ts,
ranking.ts, freshness.ts, index.ts.

Support: buildIndex(cwd, options), getIndexStatus(cwd), search(query, options),
getRelatedToFile(filePath, options).

Index both footprints and memory documents. Search supports file and tag filters
and --exclude-superseded. Ranking applies status penalties (superseded/deprecated
demoted) and halves the recency boost for architecture_decision. The SQLite DB is
generated under .substrata/index/footprint.sqlite.
```

### Task 5: Add search/context/index CLI

```txt
Add CLI commands:
- substrata index
- substrata search "query"
- substrata context "task description"

search and context must auto-(re)build a missing or stale index (via
getIndexStatus) unless --no-auto-index is passed. context outputs concise
LLM-friendly context with source file paths, excludes superseded by default, and
fits a token budget estimated as ceil(chars/3.5) (no tokenizer dependency).
Support --json, --limit, --files, --max-tokens, --exclude-superseded where appropriate.
```

### Task 6: Implement MCP server

```txt
Implement packages/mcp-server and CLI command substrata mcp.

Expose MCP tools (underscore names):
- substrata_search
- substrata_context
- substrata_add
- substrata_related_to_file
- substrata_list_recent

Each tool calls existing core/search APIs. substrata_add runs the secret
scan and returns a structured error on detection. Add basic tests for handlers.
```

### Task 7: Implement memory update helper

```txt
Implement substrata memory update.

Scan recent footprints, extract Memory learned sections, and append suggested
entries before the substrata:entries:end marker in curated memory files without
rewriting existing entries. In MVP, ask for confirmation before writing unless
--yes is passed. Do not require an LLM provider.
```

### Task 8: Documentation and examples

```txt
Write documentation: README.md, docs/architecture.md, docs/footprint-format.md,
docs/memory-format.md, docs/mcp.md, docs/security.md, docs/roadmap.md.

docs/security.md must state that the CLI secret scan is best-effort and recommend
the pre-commit hook. Create examples/basic-repo with realistic footprints and
memory files, and a smoke-test script that runs init → add → index → context.
```

### Task 9: Release readiness

```txt
Prepare the project for first public release.

Ensure: package exports are correct; CLI bin works; README quickstart works;
GitHub Actions CI passes; pnpm build/test/lint/typecheck pass; MIT license exists
and "license": "MIT" is set in every published package (root + 4 packages);
changesets config exists; MCP tool names are underscore-only; npm name/scope are
confirmed available.
```

---

## 17. MVP Scope

### Must have

- Repo-local `.substrata` directory
- Markdown/frontmatter footprint files (random-suffix ids, supersede support)
- Curated memory files (marker-delimited entries)
- CLI `init` setup wizard (interactive, default-driven, idempotent)
- CLI add/list/show/doctor/supersede
- MCP client auto-registration (Claude Code) during init
- SQLite FTS index with freshness/lazy rebuild
- CLI search/context/index
- AGENTS.md integration (via init)
- MCP server with search/context/add tools (underscore names)
- Security: key-based redaction + content scan + block-on-secret defaults
- Documentation

### Should have

- `add --from-git`
- file/tag filters, `--exclude-superseded`
- JSON output
- memory update suggestions
- init MCP registration for Cursor / Windsurf
- pre-commit secret hook (`--with-hook`)

### Not in MVP

- hosted service, cloud sync, vector search, LLM summarization, VSCode extension,
  GitHub app, PR bot, automatic session recording, multi-repo organization memory

---

## 18. Future Roadmap

### v0.1

- Local repo memory, CLI with init wizard, SQLite search, MCP server, AGENTS.md rules

### v0.2

- Better `add --from-git`, better memory update flow, Git hook integration,
  PR template integration, search ranking improvements

### v0.3

- Optional semantic search, optional local embeddings, agent session import,
  Claude Code transcript import if available

### v0.4

- VSCode extension, web UI for browsing footprints, footprint graph by file/tag/decision

### v1.0

- Stable footprint schema, stable MCP tools, team adoption guide, migration tools

---

## 19. Success Criteria

A developer should be able to run:

```bash
npx substrata init           # one-command wizard: scaffold, env, AGENTS.md, MCP, index
source ~/.zshrc                    # load attribution env vars (wizard names the file)
substrata context "I need to modify learner search"   # index builds on first query
substrata mcp
```

and reach a working, agent-integrated setup in under 5 minutes, with shared memory
that future agents can retrieve.

Project success means:

- Engineers stop repeating the same repo explanations to agents.
- Agents avoid reversing past decisions (superseded ones are demoted/hidden).
- PR reviewers see fewer repeated convention violations.
- Important implementation context survives beyond one agent session.
- Footprints are easy enough that agents create them without human friction.

---

## 20. Product Principle

Substrata must stay lightweight.

If it feels like writing a formal ADR every time, it will fail.

The product should feel like:

```txt
The agent leaves useful tracks behind as it works.
```

Not like:

```txt
The engineer has to fill out another documentation form.
```

The ideal workflow:

1. Agent checks context before work.
2. Agent makes the change.
3. Agent leaves a concise footprint.
4. The footprint becomes shared team memory.
5. Future agents retrieve it automatically.

That is the core loop.
