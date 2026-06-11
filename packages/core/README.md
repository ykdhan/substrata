# @substrata/core

Core file model for [Substrata](https://github.com/ykdhan/substrata) — shared project memory for AI engineering agents.

Provides footprint/memory parsing and writing, config loading, ID generation, secret redaction and scanning, supersede edits, and the setup writers used by `substrata init`.

**Internal workspace package** — not published to npm. It is bundled into the published [`substrata-cli`](https://www.npmjs.com/package/substrata-cli) package at build time. Most users want `npx substrata-cli init`.
