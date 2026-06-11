import type { RedactionOptions, SecretFinding } from './types';

/**
 * Redaction (key-based) + content/pattern secret scanning. See plan §12.
 */

export const DEFAULT_REDACTION_KEYS: string[] = [
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'password',
  'secret',
  'cookie',
  'set-cookie',
  'privateKey',
  'accessToken',
  'refreshToken',
];

const REDACTED = '[REDACTED]';

/** Normalize a key for matching: lowercase, strip `-`/`_` separators. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/**
 * Recursively replace values whose key matches a redaction key (case-insensitive,
 * ignoring kebab/snake separators) with `[REDACTED]`. Returns a new structure;
 * the input is not mutated.
 */
export function redactDeep(value: unknown, options: RedactionOptions = {}): unknown {
  const keys = options.keys ?? DEFAULT_REDACTION_KEYS;
  const replacement = options.replacement ?? REDACTED;
  const normalizedKeys = new Set(keys.map(normalizeKey));

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (normalizedKeys.has(normalizeKey(k))) {
          out[k] = replacement;
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  };

  return walk(value);
}

/** Content secret patterns (plan §12). */
export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'aws_access_key_id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github_pat', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'github_fine_grained', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'gitlab_pat', re: /\bglpat-[A-Za-z0-9_-]{20}\b/ },
  { name: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'openai_key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  {
    name: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'private_key_block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  },
  { name: 'bearer_header', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
  { name: 'url_basic_auth', re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i },
];

/**
 * Scan text for secrets, returning findings with 1-based line numbers.
 * Each pattern may match multiple times across lines.
 */
export function scanForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { name, re } of SECRET_PATTERNS) {
      // Use a fresh non-global regex test per line to avoid lastIndex state.
      if (re.test(line)) {
        findings.push({ name, line: i + 1 });
      }
    }
  }
  return findings;
}

/**
 * Replace secret-pattern matches in text with `[REDACTED:<name>]`.
 * Returns the redacted text; does not detect entropy-based secrets.
 */
export function redactText(text: string): string {
  let out = text;
  for (const { name, re } of SECRET_PATTERNS) {
    const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    out = out.replace(globalRe, `[REDACTED:${name}]`);
  }
  return out;
}

/**
 * Optional high-entropy heuristic, off by default. Flags long standalone tokens
 * whose Shannon entropy exceeds a threshold. Gated by `options.enabled`.
 */
export function scanForHighEntropy(
  text: string,
  options: { enabled?: boolean; minLength?: number; minEntropy?: number } = {},
): SecretFinding[] {
  if (!options.enabled) return [];
  const minLength = options.minLength ?? 32;
  const minEntropy = options.minEntropy ?? 4.0;
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i]!.split(/[\s"'`(),;]+/);
    for (const token of tokens) {
      if (token.length >= minLength && shannonEntropy(token) >= minEntropy) {
        findings.push({ name: 'high_entropy', line: i + 1 });
        break;
      }
    }
  }
  return findings;
}

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
