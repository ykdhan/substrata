# @substrata/mcp-server

MCP server for [Substrata](https://github.com/ykdhan/substrata) — exposes shared agent memory as MCP tools: `substrata_search`, `substrata_context`, `substrata_add`, `substrata_related_to_file`, `substrata_list_recent`.

Usually launched via the CLI (`substrata mcp`) and registered by `substrata init`.

**Internal workspace package** — not published to npm. It is bundled into the published [`substrata-cli`](https://www.npmjs.com/package/substrata-cli) package at build time.
