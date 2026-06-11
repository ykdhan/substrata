# Footprint File Format

A footprint is a Markdown file with YAML frontmatter that records a meaningful agent-assisted engineering task.

## File Location and Naming

```
.substrata/footprints/2026/06/2026-06-09-learner-search-performance-k7m2qx.md
```

Filename pattern: `YYYY/MM/YYYY-MM-DD-<slug>-<base32-6>.md`

The 6-character random suffix ensures that two agents creating same-day footprints with the same slug never collide.

## ID Format

```
id: fp_20260609_learner_search_performance_k7m2qx
```

Pattern: `fp_<YYYYMMDD>_<slug>_<base32-6>`

Example: `fp_20260609_learner_search_performance_k7m2qx`

## Full Example

````markdown
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
````

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

````

## Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema_version` | number | yes | Always `1` for MVP |
| `id` | string | yes | Unique identifier (`fp_YYYYMMDD_slug_random`) |
| `created_at` | string | yes | ISO 8601 timestamp of creation |
| `updated_at` | string | no | ISO 8601 timestamp of last edit |
| `actor` | string | yes | Agent or person who performed the work (e.g., `claude-code`, `user@example.com`) |
| `requester` | string | no | Who requested the work (e.g., `david.han`, email, GitHub handle) |
| `agent_model` | string | no | Agent model identifier (e.g., `claude-sonnet-4`, `gpt-4o`) |
| `work_type` | enum | yes | One of: `implementation`, `implementation_decision`, `bug_fix`, `refactor`, `investigation`, `architecture_decision`, `test_update`, `documentation` |
| `status` | enum | yes | One of: `draft`, `completed`, `superseded`, `deprecated` |
| `repo` | object | no | Optional repo metadata (`name`, `branch`) |
| `related` | object | no | Links to related commits, PRs, issues, URLs; also contains `supersedes` and `superseded_by` ids |
| `files_touched` | array | no | List of file paths modified |
| `tags` | array | no | List of topic tags (e.g., `learner-search`, `performance`) |

**Note on `confidence`:** The original design included a `confidence: 0.82` field. It is **intentionally omitted** from MVP because it had no defined author, scale, or consumer. An agent emitting arbitrary numbers adds noise without clear value. If reintroduced in v0.3+, it must be precisely defined, surfaced as advisory-only in `show`/`context` output, and **never used in search ranking**.

## Body Sections

The Markdown body below the frontmatter can contain any structure, but the standard sections are:

| Section | Purpose | Parsing |
|---------|---------|---------|
| `## Purpose` | Why this work was done | Extracted as-is |
| `## Decisions` | Bullet list of decisions made | Parsed as array of strings |
| `## Rejected options` | Subsections with names and reasons | Each subsection becomes `{ option, reason }` |
| `## Implementation notes` | Details of how it was done | Extracted as-is |
| `## Commands run` | Shell commands that were executed | Parsed as code block lines |
| `## Memory learned` | Durable facts the agent discovered | Parsed as bullet list |
| `## Future agent guidance` | What future agents should know | Extracted as-is |

Other sections are ignored by the parser but can appear in the raw body (e.g., markdown notes, links, diagrams).

## Supersede Relationships

When a later footprint replaces an earlier one:

1. The old footprint's `status` is set to `superseded`
2. The old footprint's `related.superseded_by` is appended with the new id
3. The new footprint's `related.supersedes` is appended with the old id

This is done by the `substrata supersede <old-id> --by <new-id>` command:

```bash
substrata supersede fp_20260609_old_id --by fp_20260610_new_id
````

Or, when creating the replacement in one step:

```bash
substrata add --supersedes fp_20260609_old_id --title "..." --purpose "..."
```

The supersede links are **frontmatter-only edits**; the body is never rewritten. This keeps Git diffs clean and makes manual conflict resolution trivial.

## Search and Ranking

Footprints are indexed by:

- title
- tags
- files_touched
- body (all sections)

Search results are ranked by BM25 score, with boosts for:

- Recency (recent decisions are more relevant)
- File overlap (docs touching the query files are boosted)
- Architecture decisions (halved recency decay to stay durable)

Status penalties demote:

- `superseded`: × 0.15
- `deprecated`: × 0.10
- `draft`: × 0.50

The `search` command includes superseded footprints (demoted) so humans can trace history. The `context` command excludes them by default (agents should see only current decisions).
