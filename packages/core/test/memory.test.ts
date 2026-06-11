import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendMemoryEntries,
  existingEntryIds,
  listMemoryDocuments,
  memoryDir,
  parseMemoryFile,
} from '../src/index';
import { makeInitedProject, removeDir } from './helpers';

const BASE_MEMORY = `---
schema_version: 1
id: mem_repo_conventions
type: repo_conventions
tags:
  - conventions
---

# Repo conventions

## Service layer

- Prefer domain services.

<!-- substrata:entries:start -->
<!-- substrata:entries:end -->
`;

describe('memory append', () => {
  let cwd: string;
  let file: string;
  beforeEach(async () => {
    cwd = await makeInitedProject();
    file = path.join(memoryDir(cwd), 'conventions.md');
    await writeFile(file, BASE_MEMORY, 'utf8');
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('parses memory files and lists them', async () => {
    const doc = await parseMemoryFile(file);
    expect(doc.frontmatter.id).toBe('mem_repo_conventions');
    expect(doc.title).toBe('Repo conventions');
    const docs = await listMemoryDocuments(cwd);
    expect(docs.map((d) => d.frontmatter.id)).toContain('mem_repo_conventions');
  });

  it('appends an entry before the end marker, wrapping in entry markers', async () => {
    const changed = await appendMemoryEntries(file, [
      { sourceId: 'fp_1', lines: ['- Learner DB access via LearnerQueryService.'] },
    ]);
    expect(changed).toBe(true);
    const content = await readFile(file, 'utf8');
    expect(content).toContain('<!-- substrata:entry id=fp_1 -->');
    expect(content).toContain('- Learner DB access via LearnerQueryService.');
    expect(content).toContain('<!-- /substrata:entry -->');
    // entry must appear before the end marker
    expect(content.indexOf('id=fp_1')).toBeLessThan(content.indexOf('substrata:entries:end'));
    // existing content preserved
    expect(content).toContain('- Prefer domain services.');
  });

  it('is idempotent: re-appending the same sourceId does nothing', async () => {
    await appendMemoryEntries(file, [{ sourceId: 'fp_1', lines: ['- a'] }]);
    const first = await readFile(file, 'utf8');
    const changed = await appendMemoryEntries(file, [{ sourceId: 'fp_1', lines: ['- a'] }]);
    expect(changed).toBe(false);
    const second = await readFile(file, 'utf8');
    expect(second).toBe(first);
    // only one occurrence of the entry id
    expect(second.split('id=fp_1').length - 1).toBe(1);
  });

  it('creates a marker block when absent', async () => {
    const noMarker = path.join(memoryDir(cwd), 'no-marker.md');
    await writeFile(noMarker, '---\nschema_version: 1\nid: mem_x\n---\n\n# X\n\nbody\n', 'utf8');
    const changed = await appendMemoryEntries(noMarker, [{ sourceId: 'fp_2', lines: ['- b'] }]);
    expect(changed).toBe(true);
    const content = await readFile(noMarker, 'utf8');
    expect(content).toContain('<!-- substrata:entries:start -->');
    expect(content).toContain('<!-- substrata:entries:end -->');
    expect(content).toContain('id=fp_2');
    expect(content).toContain('body');
  });

  it('existingEntryIds extracts present ids', () => {
    const ids = existingEntryIds(
      '<!-- substrata:entry id=fp_a -->\n<!-- substrata:entry id=fp_b -->',
    );
    expect(ids.has('fp_a')).toBe(true);
    expect(ids.has('fp_b')).toBe(true);
  });
});
