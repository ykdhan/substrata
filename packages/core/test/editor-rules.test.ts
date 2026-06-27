import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AGENTS_MD_SECTION,
  SUBSTRATA_RULES_MARKDOWN,
  upsertClaudeMd,
  upsertCursorRule,
  upsertEditorRules,
  upsertGeminiMd,
} from '../src/index';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'substrata-rules-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('shared rules body', () => {
  it('AGENTS_MD_SECTION wraps SUBSTRATA_RULES_MARKDOWN between markers', () => {
    expect(SUBSTRATA_RULES_MARKDOWN).toContain('## Substrata Rules');
    expect(SUBSTRATA_RULES_MARKDOWN).toContain('substrata_graph_context');
    expect(AGENTS_MD_SECTION).toBe(
      `<!-- substrata:start -->\n${SUBSTRATA_RULES_MARKDOWN}\n<!-- substrata:end -->`,
    );
  });
});

describe('upsertClaudeMd / upsertGeminiMd', () => {
  it('creates CLAUDE.md and GEMINI.md with the marker section', async () => {
    const claude = upsertClaudeMd(cwd);
    expect(claude.action).toBe('create');
    const gemini = upsertGeminiMd(cwd);
    expect(gemini.action).toBe('create');

    const claudeText = await readFile(path.join(cwd, 'CLAUDE.md'), 'utf8');
    expect(claudeText).toContain('<!-- substrata:start -->');
    expect(claudeText).toContain('## Substrata Rules');
    expect(claudeText).toContain('substrata_graph_context');
    expect(await readFile(path.join(cwd, 'GEMINI.md'), 'utf8')).toContain('## Substrata Rules');
  });

  it('is idempotent (second run skips) and preserves surrounding content', async () => {
    await writeFile(path.join(cwd, 'CLAUDE.md'), '# My project rules\n\nKeep this.\n', 'utf8');
    const first = upsertClaudeMd(cwd);
    expect(first.action).toBe('update');
    const second = upsertClaudeMd(cwd);
    expect(second.action).toBe('skip');

    const text = await readFile(path.join(cwd, 'CLAUDE.md'), 'utf8');
    expect(text).toContain('Keep this.');
    expect(text).toContain('## Substrata Rules');
  });

  it('refuses to write through a symlink', async () => {
    const { symlink } = await import('node:fs/promises');
    const target = path.join(cwd, 'real.md');
    await writeFile(target, 'x', 'utf8');
    await symlink(target, path.join(cwd, 'CLAUDE.md'));
    const result = upsertClaudeMd(cwd);
    expect(result.action).toBe('skip');
    expect(result.description).toContain('symlink');
  });
});

describe('upsertCursorRule', () => {
  it('writes .cursor/rules/substrata.mdc with MDC frontmatter (alwaysApply)', async () => {
    const result = upsertCursorRule(cwd);
    expect(result.action).toBe('create');
    const file = path.join(cwd, '.cursor', 'rules', 'substrata.mdc');
    const text = await readFile(file, 'utf8');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('alwaysApply: true');
    expect(text).toContain('## Substrata Rules');

    // Idempotent on exact-content match.
    expect(upsertCursorRule(cwd).action).toBe('skip');
  });

  it('dry run does not write', () => {
    const result = upsertCursorRule(cwd, true);
    expect(result.contents).toBeDefined();
    expect(existsSync(path.join(cwd, '.cursor', 'rules', 'substrata.mdc'))).toBe(false);
  });
});

describe('upsertEditorRules', () => {
  it('writes all three editor rule files', async () => {
    const results = upsertEditorRules(cwd);
    expect(results.map((r) => r.action)).toEqual(['create', 'create', 'create']);
    expect(existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(path.join(cwd, 'GEMINI.md'))).toBe(true);
    expect(existsSync(path.join(cwd, '.cursor', 'rules', 'substrata.mdc'))).toBe(true);
  });

  it('dry run writes nothing', async () => {
    await mkdir(path.join(cwd, '.cursor'), { recursive: true });
    const results = upsertEditorRules(cwd, true);
    expect(results.every((r) => r.contents !== undefined)).toBe(true);
    expect(existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(path.join(cwd, 'GEMINI.md'))).toBe(false);
  });
});
