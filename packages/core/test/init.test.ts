import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configPath, footprintsDir, initProject, memoryDir, templatesDir } from '../src/index';
import { makeTempDir, removeDir } from './helpers';

describe('initProject', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeTempDir();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('scaffolds the .substrata directory tree', async () => {
    const changes = await initProject(cwd, { projectName: 'demo' });
    await stat(footprintsDir(cwd));
    await stat(memoryDir(cwd));
    await stat(templatesDir(cwd));
    await stat(path.join(templatesDir(cwd), 'footprint.md'));
    await stat(path.join(templatesDir(cwd), 'memory.md'));

    const config = await readFile(configPath(cwd), 'utf8');
    expect(config).toContain('name: demo');
    expect(changes.every((c) => c.action === 'create')).toBe(true);
  });

  it('defaults project name to the directory basename', async () => {
    await initProject(cwd);
    const config = await readFile(configPath(cwd), 'utf8');
    expect(config).toContain(`name: ${path.basename(cwd)}`);
  });

  it('is idempotent: never overwrites existing files', async () => {
    await initProject(cwd, { projectName: 'demo' });
    // mutate config to detect overwrites
    await writeFile(configPath(cwd), 'schema_version: 1\nproject:\n  name: custom\n', 'utf8');
    const changes = await initProject(cwd, { projectName: 'demo' });
    expect(changes.every((c) => c.action === 'skip')).toBe(true);
    const config = await readFile(configPath(cwd), 'utf8');
    expect(config).toContain('name: custom');
  });
});
