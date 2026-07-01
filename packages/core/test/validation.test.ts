import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ParseError, writeFootprint } from '../src/index';
import { makeInitedProject, removeDir } from './helpers';

describe('writeFootprint input validation', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeInitedProject();
  });
  afterEach(async () => {
    await removeDir(cwd);
  });

  const base = { title: 'Test', purpose: 'Test purpose.', actor: 'claude-code' };

  it('rejects absolute filesTouched paths', async () => {
    await expect(writeFootprint({ cwd, ...base, filesTouched: ['/etc/passwd'] })).rejects.toThrow(
      ParseError,
    );
    await expect(
      writeFootprint({ cwd, ...base, filesTouched: ['C:\\Windows\\system32'] }),
    ).rejects.toThrow(ParseError);
  });

  it('rejects filesTouched paths with .. traversal segments', async () => {
    await expect(
      writeFootprint({ cwd, ...base, filesTouched: ['../outside/secrets.env'] }),
    ).rejects.toThrow(/'\.\.' segments/);
  });

  it('normalizes backslashes in filesTouched to posix', async () => {
    const fp = await writeFootprint({ cwd, ...base, filesTouched: ['api\\learners.ts'] });
    expect(fp.frontmatter.files_touched).toEqual(['api/learners.ts']);
  });

  it('rejects non-http(s) related urls', async () => {
    await expect(
      writeFootprint({ cwd, ...base, related: { urls: ['javascript:alert(1)'] } }),
    ).rejects.toThrow(/http\(s\)/);
    await expect(
      writeFootprint({ cwd, ...base, related: { urls: ['not a url'] } }),
    ).rejects.toThrow(/not a valid URL/);
  });

  it('accepts http(s) related urls', async () => {
    const fp = await writeFootprint({
      cwd,
      ...base,
      related: { urls: ['https://example.com/issue/1'] },
    });
    expect(fp.frontmatter.related?.urls).toEqual(['https://example.com/issue/1']);
  });
});
