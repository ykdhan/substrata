import { writeFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigError, configPath, defaultConfig, loadConfig, renderConfig } from '../src/index';
import { makeInitedProject, removeDir } from './helpers';

describe('loadConfig', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeInitedProject('my-project');
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  it('returns defaults with the project name from config.yml', async () => {
    const config = await loadConfig(cwd);
    expect(config.schema_version).toBe(1);
    expect(config.project.name).toBe('my-project');
    expect(config.search.default_limit).toBe(defaultConfig.search.default_limit);
    expect(config.security.block_on_secret).toBe(true);
  });

  it('deep-merges user overrides over defaults', async () => {
    await writeFile(
      configPath(cwd),
      [
        'schema_version: 1',
        'project:',
        '  name: overridden',
        'search:',
        '  default_limit: 25',
        'security:',
        '  block_on_secret: false',
      ].join('\n'),
      'utf8',
    );
    const config = await loadConfig(cwd);
    expect(config.project.name).toBe('overridden');
    expect(config.search.default_limit).toBe(25);
    // untouched nested default survives the merge
    expect(config.search.max_context_tokens).toBe(defaultConfig.search.max_context_tokens);
    expect(config.security.block_on_secret).toBe(false);
    expect(config.security.redact).toBe(true);
  });

  it('throws ConfigError when schema_version != 1', async () => {
    await writeFile(configPath(cwd), 'schema_version: 2\nproject:\n  name: x\n', 'utf8');
    await expect(loadConfig(cwd)).rejects.toBeInstanceOf(ConfigError);
  });

  it('throws ConfigError when config is missing', async () => {
    await removeDir(cwd);
    await expect(loadConfig(cwd)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('renderConfig', () => {
  it('renders valid YAML with the given project name', () => {
    const yaml = renderConfig('demo');
    expect(yaml).toContain('schema_version: 1');
    expect(yaml).toContain('name: demo');
    expect(yaml).toContain('block_on_secret: true');
  });
});
