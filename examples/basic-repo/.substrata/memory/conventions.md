---
schema_version: 1
id: mem_repo_conventions
updated_at: 2026-06-10T09:30:00+09:00
type: repo_conventions
tags:
  - conventions
  - patterns
---

# Repository Conventions

## Code Organization

- Keep business logic in `src/` directory
- Database migrations in `src/db/migrations/`
- Tests alongside source: `src/module.ts` and `src/module.test.ts`
- Use TypeScript strict mode

## Performance Patterns

- Always consider scalability: what works for 100 records might fail at 1M
- Profile before optimizing; use database indexes strategically
- Pagination must handle large datasets efficiently

## Pagination

Use cursor-based pagination for any API returning multiple records. Offset pagination becomes O(n) slow for large datasets and should be avoided.

Example:

```ts
// Good: cursor pagination
const results = await paginate({ afterCursor, limit: 20 });

// Avoid: offset pagination
const results = await paginate({ offset: 100, limit: 20 });
```

## Database

- Always create migrations for schema changes
- Index cursor fields for pagination
- Use prepared statements to prevent SQL injection

## Testing

- Write tests alongside implementation
- Test happy path and error cases
- Test with realistic data sizes

<!-- substrata:entries:start -->
<!-- substrata:entry id=fp_20260609_implement_search_k7m2qx -->
- SQLite FTS5 is sufficient for keyword search without embeddings provider
- Index freshness detection must be cheap (stat walk, not parsing every file)
<!-- /substrata:entry -->
<!-- substrata:entry id=fp_20260610_cursor_pagination_def456 -->
- Cursor-based pagination scales better than offset; always use for large datasets
- Cursor field must be indexed for good performance
<!-- /substrata:entry -->
<!-- /substrata:entries:end -->
