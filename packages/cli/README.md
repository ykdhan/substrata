# substrata-cli

The Substrata CLI — shared project memory for AI engineering agents. Installs the `substrata` binary.

```bash
npx substrata-cli init   # one-command setup wizard
substrata context "what I'm about to work on"
substrata add --title "..." --purpose "..."
```

> The npm name `substrata` belongs to an unrelated package — the published package is `substrata-cli`; the installed binary is still named `substrata`.

This package ships self-contained: the internal `@substrata/core`, `@substrata/search`, and `@substrata/mcp-server` workspace packages are bundled in at build time.

See the [repository root](https://github.com/ykdhan/substrata) for full documentation.
