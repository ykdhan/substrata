import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { ConfigError } from './errors';
import { configPath } from './paths';
import type { SubstrataConfig } from './types';

/**
 * Default redaction keys (plan §12). The redactor also matches kebab/snake
 * variants case-insensitively, so only the canonical forms are listed.
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

/** Default config shape (plan §13). projectName is filled by loadConfig/init. */
export const defaultConfig: SubstrataConfig = {
  schema_version: 1,
  project: {
    name: 'substrata-demo',
  },
  storage: {
    footprints_dir: '.substrata/footprints',
    memory_dir: '.substrata/memory',
    index_path: '.substrata/index/footprint.sqlite',
  },
  search: {
    default_limit: 8,
    max_context_tokens: 1600,
  },
  security: {
    redact: true,
    scan_content: true,
    entropy_scan: false,
    entropy_min_length: 32,
    block_on_secret: true,
    redaction_keys: [
      'token',
      'apiKey',
      'api_key',
      'authorization',
      'password',
      'secret',
      'cookie',
      'privateKey',
      'accessToken',
      'refreshToken',
    ],
  },
  agent: {
    default_actor: 'unknown-agent',
    require_footprint_after_non_trivial_work: true,
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge `override` onto `base`. Arrays and scalars from override win wholesale. */
function deepMerge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) {
    return override === undefined ? base : (override as T);
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    if (isObject(baseValue) && isObject(value)) {
      result[key] = deepMerge(baseValue, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Load `.substrata/config.yml`, deep-merging user values over defaults.
 * Throws ConfigError if the file is missing/malformed or schema_version !== 1.
 * The default project name falls back to the cwd basename.
 */
export async function loadConfig(cwd: string): Promise<SubstrataConfig> {
  const file = configPath(cwd);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new ConfigError(`Config not found at ${file}. Run \`substrata init\`.`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ConfigError(`Failed to parse ${file}: ${(err as Error).message}`);
  }

  if (!isObject(parsed)) {
    throw new ConfigError(`Config at ${file} must be a YAML mapping.`);
  }

  if (parsed.schema_version !== 1) {
    throw new ConfigError(
      `Unsupported config schema_version: ${String(parsed.schema_version)} (expected 1).`,
    );
  }

  const base: SubstrataConfig = {
    ...defaultConfig,
    project: { name: path.basename(cwd) },
  };
  return deepMerge(base, parsed);
}

/** Render a config.yml file for `init`, overriding the project name. */
export function renderConfig(projectName: string): string {
  const config: SubstrataConfig = {
    ...defaultConfig,
    project: { name: projectName },
  };
  return stringifyYaml(config, { lineWidth: 0 });
}
