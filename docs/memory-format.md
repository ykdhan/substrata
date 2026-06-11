# Curated Memory File Format

Memory files are durable, timeless summaries of repo knowledge that agents should read often. Unlike footprints (tied to one session), memory files accumulate learnings across many sessions.

## Purpose

Memory files capture:

- Repo conventions (patterns agents should follow)
- Architectural decisions (why things are designed as they are)
- Domain-specific guidance (rules for particular areas of code)
- Technology choices (why certain tools were adopted)
- Known gotchas (pitfalls agents should avoid)

## File Location

```
.substrata/memory/
  conventions.md                # repo-wide conventions
  architecture.md               # high-level design decisions
  domain/
    learner-search.md          # domain-specific knowledge
    payments.md
```

Memory files are **committed to the repo** alongside footprints.

## Structure and Markers

Memory files use Markdown with marker-delimited entry blocks so multiple agents can append concurrently without rewriting existing entries.

```markdown
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

## Entry Markers

The markers delimit a section where `substrata memory update` appends new entries:

```html
<!-- substrata:entries:start -->
<!-- substrata:entry id=fp_<id> -->
- entry text
<!-- /substrata:entry -->
<!-- substrata:entries:end -->
```

**Important:** `memory update` appends **before** the `entries:end` marker. It never rewrites existing entries. This allows two agents to append different learnings without conflict (they only collide on the trailing marker line, which is trivially resolvable in Git).

## Frontmatter Fields

| Field            | Type   | Required | Description                                                   |
| ---------------- | ------ | -------- | ------------------------------------------------------------- |
| `schema_version` | number | yes      | Always `1` for MVP                                            |
| `id`             | string | yes      | Unique identifier (e.g., `mem_repo_conventions`)              |
| `updated_at`     | string | no       | ISO 8601 timestamp of last update                             |
| `type`           | string | no       | Category (e.g., `repo_conventions`, `architecture`, `domain`) |
| `tags`           | array  | no       | Topic tags                                                    |

Other frontmatter fields are allowed and preserved.

## Append Semantics

The `substrata memory update` command:

1. Scans recent footprints for `## Memory learned` sections
2. Extracts bullet points as suggested entries
3. For each suggestion, appends a new block before the `entries:end` marker:
   ```html
   <!-- substrata:entry id=fp_<footprint-id> -->
   - suggested text
   <!-- /substrata:entry -->
   ```
4. Asks for confirmation before writing (unless `--yes`)

Example workflow:

```bash
substrata memory update                # suggest updates from last week's footprints
# (review suggestions, edit if needed)
substrata memory update --yes          # auto-apply without prompting
substrata memory update --since 2026-06-01  # only from footprints after this date
```

## Guidelines

### What to Store

- Repo conventions and patterns that agents should follow
- Architectural decisions and their rationale
- Known gotchas and how to avoid them
- File/module organization and responsibilities
- Technology choices and constraints
- Testing patterns and expectations
- Deployment procedures and safety checks

### What NOT to Store

- Secrets, credentials, API keys, tokens
- Sensitive user data or privacy information
- Temporary or exploratory notes (use footprints instead)
- Detailed code listings (link to source instead)

### Style

- Concise and scannable (bullet points, short paragraphs)
- Written for agents (direct, actionable)
- Durable (avoid references to specific people, dates, versions unless necessary)
- Evergreen (update when repo practices change)

## Example: Domain-Specific Memory

`.substrata/memory/domain/learner-search.md`:

````markdown
---
schema_version: 1
id: mem_learner_search
type: domain
tags:
  - learner-search
  - performance
---

# Learner search

## Data model

Learners are stored in the `learners` table with columns:

- `id` (PK)
- `name`
- `email`
- `created_at`
- `cursor` (for pagination)

Learner profiles may be in a separate `learner_profiles` table.

## Query patterns

All learner queries go through `LearnerQueryService`. Do not query `learners` table directly.

```ts
// Good
const learners = await LearnerQueryService.search({ query, limit, afterCursor });

// Bad
const learners = await db.query('SELECT * FROM learners WHERE ...');
```
````

## Pagination

Use cursor pagination, not offset pagination. Reason: offset pagination becomes O(n) slow for large organizations.

```ts
const results = await LearnerQueryService.search({
  query: 'alice',
  limit: 20,
  afterCursor: lastCursor, // null on first request
});
```

## Performance considerations

- The cursor index is essential; do not drop it without updating this memory.
- Avoid client-side filtering for organization-level data.
- Large organizations (>10k learners) will see significant slowdown without the cursor index.

<!-- substrata:entries:start -->
<!-- /substrata:entries:end -->

```

## Manual Editing

Memory files can be edited by hand. The entry markers are just conventions; the parser does not enforce them. Use them to prevent conflicts when `memory update` is used, but feel free to:

- Reorganize sections
- Rewrite entries for clarity
- Delete outdated entries
- Add new sections (with or without entry markers)

Always commit memory changes alongside footprints for audit trail.
```
