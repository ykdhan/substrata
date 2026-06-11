import { describe, expect, it } from 'vitest';

import { redactDeep, redactText, scanForSecrets } from '../src/index';

describe('redactDeep', () => {
  it('redacts exact-key matches', () => {
    const out = redactDeep({ token: 'abc', name: 'ok' });
    expect(out).toEqual({ token: '[REDACTED]', name: 'ok' });
  });

  it('matches keys case-insensitively and across kebab/snake variants', () => {
    const out = redactDeep({
      Token: 'a',
      API_KEY: 'b',
      'api-key': 'c',
      accessToken: 'd',
      'access-token': 'e',
    });
    expect(out).toEqual({
      Token: '[REDACTED]',
      API_KEY: '[REDACTED]',
      'api-key': '[REDACTED]',
      accessToken: '[REDACTED]',
      'access-token': '[REDACTED]',
    });
  });

  it('recurses into nested objects and arrays', () => {
    const out = redactDeep({
      level1: { password: 'p', items: [{ secret: 's' }, { keep: 'k' }] },
    });
    expect(out).toEqual({
      level1: { password: '[REDACTED]', items: [{ secret: '[REDACTED]' }, { keep: 'k' }] },
    });
  });

  it('leaves non-matching values untouched and does not mutate input', () => {
    const input = { foo: 'bar', n: 42, nested: { ok: true } };
    const out = redactDeep(input);
    expect(out).toEqual(input);
    expect(input.foo).toBe('bar');
  });

  it('honors a custom keys list and replacement', () => {
    const out = redactDeep({ custom: 'x', token: 'y' }, { keys: ['custom'], replacement: 'XX' });
    expect(out).toEqual({ custom: 'XX', token: 'y' });
  });
});

describe('scanForSecrets', () => {
  // FAKE example secrets only.
  const cases: Array<{ name: string; sample: string }> = [
    { name: 'aws_access_key_id', sample: `AKIA${'A'.repeat(16)}` },
    { name: 'github_pat', sample: `ghp_${'a'.repeat(36)}` },
    { name: 'github_fine_grained', sample: `github_pat_${'a'.repeat(70)}` },
    { name: 'gitlab_pat', sample: `glpat-${'a'.repeat(20)}` },
    { name: 'slack_token', sample: `xoxb-${'a'.repeat(20)}` },
    { name: 'google_api_key', sample: `AIza${'a'.repeat(35)}` },
    { name: 'openai_key', sample: `sk-${'a'.repeat(24)}` },
    { name: 'anthropic_key', sample: `sk-ant-${'a'.repeat(24)}` },
    { name: 'jwt', sample: `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}` },
    { name: 'private_key_block', sample: '-----BEGIN RSA PRIVATE KEY-----' },
    { name: 'bearer_header', sample: `Bearer ${'a'.repeat(24)}` },
    { name: 'url_basic_auth', sample: 'https://user:pass@example.com' },
  ];

  for (const { name, sample } of cases) {
    it(`detects ${name}`, () => {
      const findings = scanForSecrets(`prefix\n${sample}\n`);
      expect(findings.some((f) => f.name === name)).toBe(true);
    });
  }

  it('reports 1-based line numbers', () => {
    const text = `line1\nline2 ghp_${'a'.repeat(36)}\nline3`;
    const findings = scanForSecrets(text);
    const ghp = findings.find((f) => f.name === 'github_pat');
    expect(ghp?.line).toBe(2);
  });

  it('returns no findings for clean text', () => {
    expect(scanForSecrets('nothing secret here\njust prose')).toEqual([]);
  });
});

describe('redactText', () => {
  it('replaces matches with [REDACTED:<name>]', () => {
    const token = `ghp_${'a'.repeat(36)}`;
    const out = redactText(`here ${token} end`);
    expect(out).toContain('[REDACTED:github_pat]');
    expect(out).not.toContain(token);
  });
});
