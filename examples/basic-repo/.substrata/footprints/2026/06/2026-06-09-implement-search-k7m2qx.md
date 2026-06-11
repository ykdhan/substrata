---
schema_version: 1
id: fp_20260609_implement_search_k7m2qx
created_at: 2026-06-09T10:30:00+09:00
updated_at: 2026-06-09T10:45:00+09:00
actor: example-agent
requester: user@example.com
agent_model: example-model
work_type: implementation_decision
status: completed

repo:
  name: basic-repo
  branch: feature/search

related:
  commits:
    - abc123def456
  prs:
    - 42
  issues:
    - ISSUE-123

files_touched:
  - src/search.ts
  - src/index.ts

tags:
  - search
  - performance
  - implementation
---

# Implement full-text search

## Purpose

Users needed a way to search through large datasets without loading everything into memory. Implemented a keyword search with ranking.

## Decisions

- Use SQLite FTS5 for indexing and ranking
- Index title, content, and tags
- Apply BM25 ranking with recency boost
- Rebuild index lazily on missing or stale

## Rejected options

### Full vector search

Rejected because it requires external embeddings provider and adds complexity. SQLite FTS5 is sufficient for keyword search.

### Redis-backed index

Rejected because it adds operational overhead and Redis would need to be rebuilt from scratch after deployment.

## Implementation notes

- Created `src/search.ts` with index and query functions
- Used `better-sqlite3` for synchronous operations
- Index metadata tracks freshness (mtime, file count, schema version)
- Search results include snippet extraction from body

## Commands run

```bash
pnpm build
pnpm test search
pnpm typecheck
```

## Memory learned

- SQLite FTS5 is fast enough for typical repos without embeddings
- Index freshness detection must be cheap (stat walk, not file parsing)
- BM25 ranking works well with status penalties for superseded docs

## Future agent guidance

Before modifying search:

1. Check if the change affects ranking or freshness detection
2. Ensure index rebuild is always possible from source files
3. Add tests for edge cases (empty index, special characters, large result sets)
4. Profile search performance on repos with 100+ footprints
