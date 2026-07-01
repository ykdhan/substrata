# @substrata/index

SQLite FTS5 search index for [Substrata](https://github.com/ykdhan/substrata) — shared project memory for AI engineering agents.

Provides `buildIndex`, `getIndexStatus`, `search`, and `getRelatedToFile` over footprints and curated memory. The index is a generated local artifact; Markdown files remain the source of truth.

**Internal workspace package** — not published to npm. It is bundled into the published [`substrata-cli`](https://www.npmjs.com/package/substrata-cli) package at build time. Most users want `npx substrata-cli init`.
