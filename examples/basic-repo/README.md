# Basic Repo Example

This directory is a minimal but realistic example of a Substrata-enabled repository. It includes:

- A `.substrata/` directory with sample config, footprints, and memory files
- Realistic footprint examples with full frontmatter
- A curated memory file with entry markers
- A smoke test script that validates the setup

## Contents

```
.substrata/
  config.yml                    # project configuration
  footprints/
    2026/06/
      2026-06-09-implement-search-k7m2qx.md
      2026-06-09-fix-pagination-abc123.md     # superseded by next footprint
      2026-06-10-cursor-pagination-def456.md  # supersedes previous
  memory/
    conventions.md              # curated repo knowledge with entry markers
```

## Footprint Examples

### Basic Implementation

`2026-06-09-implement-search-k7m2qx.md` — a typical implementation footprint with decisions, rejected options, commands run, and memory learned.

### Supersede Relationship

Two footprints demonstrate the supersede pattern:

- `2026-06-09-fix-pagination-abc123.md` (status: superseded) — the original approach
- `2026-06-10-cursor-pagination-def456.md` (status: completed) — the replacement with links

The old footprint's `status` is set to `superseded` and `related.superseded_by` contains the new id. The new footprint's `related.supersedes` contains the old id.

## Memory File

`conventions.md` is a curated memory file with:

- Stable repo knowledge
- Marker-delimited entry blocks that `substrata memory update` can append to
- An entry manually added from a footprint's "Memory learned" section

## Running the Smoke Test

```bash
chmod +x smoke.sh
./smoke.sh
```

The script:

1. Creates a temporary copy of this directory
2. Initializes Substrata (if not already present)
3. Adds a new footprint
4. Builds the search index
5. Queries via `search` and `context` commands
6. Validates output format and content

All commands use the **local build** from `../../packages/cli/dist/bin.js` to test the current codebase.

## What to Observe

### Before Running Smoke Test

- `pnpm build` builds the CLI from source
- Verify `node ../../packages/cli/dist/bin.js --help` works

### During Smoke Test

- `init` creates `.substrata/` structure if missing
- `add` creates a new footprint with a unique ID and random suffix
- `index` builds the SQLite FTS index (can take a few seconds)
- `search` returns ranked results with snippets
- `context` returns concise, numbered context for an agent

### Expected Output

```
✓ Init successful
✓ Added footprint: fp_<date>_example_footprint_<random>
✓ Index built: .substrata/index/footprint.sqlite
✓ Search found 3 results
✓ Context generated 2 relevant sources
```

## Customizing the Example

To add more footprints:

1. Create a new `.md` file in `.substrata/footprints/2026/06/`
2. Follow the format of existing footprints (see `docs/footprint-format.md`)
3. Include realistic metadata (actor, tags, files_touched)

To test more search queries, edit `smoke.sh` to query different keywords:

```bash
substrata search "pagination" --limit 5
substrata context "I need to improve performance"
```

## For Documentation

This example serves as a reference for:

- Footprint file structure and frontmatter
- Memory file format with entry markers
- Realistic agent-generated content
- Working configuration
- Complete CLI workflow from init → add → index → search/context

See `docs/footprint-format.md` and `docs/memory-format.md` for full format specifications.
