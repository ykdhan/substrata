import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from './config';
import { ParseError, SecretDetectedError } from './errors';
import { buildFootprintFilename, generateFootprintId, randomSuffix, slugify } from './ids';
import {
  extractTitle,
  parseFootprintBody,
  parseFrontmatter,
  renderFootprintBody,
  serializeFrontmatter,
} from './markdown';
import { footprintsDir, relativeToCwd } from './paths';
import { redactDeep, scanForSecrets } from './redaction';
import type {
  Footprint,
  FootprintFrontmatter,
  FootprintRelated,
  FootprintStatus,
  SecretFinding,
  WorkType,
  WriteFootprintInput,
} from './types';

const REQUIRED_KEYS = [
  'schema_version',
  'id',
  'created_at',
  'actor',
  'work_type',
  'status',
] as const;

const VALID_WORK_TYPES: ReadonlySet<string> = new Set<WorkType>([
  'implementation',
  'implementation_decision',
  'bug_fix',
  'refactor',
  'investigation',
  'architecture_decision',
  'test_update',
  'documentation',
]);

const VALID_STATUSES: ReadonlySet<string> = new Set<FootprintStatus>([
  'draft',
  'completed',
  'superseded',
  'deprecated',
]);

function validateFrontmatter(fm: Record<string, unknown>, filePath?: string): FootprintFrontmatter {
  for (const key of REQUIRED_KEYS) {
    if (fm[key] === undefined || fm[key] === null) {
      throw new ParseError(`Footprint missing required frontmatter field "${key}"`, filePath);
    }
  }
  if (fm.schema_version !== 1) {
    throw new ParseError(
      `Footprint has unsupported schema_version: ${String(fm.schema_version)} (expected 1)`,
      filePath,
    );
  }
  if (typeof fm.id !== 'string' || fm.id.length === 0) {
    throw new ParseError('Footprint "id" must be a non-empty string', filePath);
  }
  if (typeof fm.actor !== 'string' || fm.actor.length === 0) {
    throw new ParseError('Footprint "actor" must be a non-empty string', filePath);
  }
  if (typeof fm.created_at !== 'string' || fm.created_at.length === 0) {
    throw new ParseError('Footprint "created_at" must be a non-empty string', filePath);
  }
  if (typeof fm.work_type !== 'string' || !VALID_WORK_TYPES.has(fm.work_type)) {
    throw new ParseError(`Footprint has invalid work_type: ${String(fm.work_type)}`, filePath);
  }
  if (typeof fm.status !== 'string' || !VALID_STATUSES.has(fm.status)) {
    throw new ParseError(`Footprint has invalid status: ${String(fm.status)}`, filePath);
  }
  return fm as FootprintFrontmatter;
}

/** Parse raw markdown into a Footprint, validating required frontmatter. */
export function parseFootprint(raw: string, filePath: string): Footprint {
  const { frontmatter, body } = parseFrontmatter(raw);
  const fm = validateFrontmatter(frontmatter, filePath);
  const title = extractTitle(body);
  const sections = parseFootprintBody(body);
  return { frontmatter: fm, title, body, sections, filePath, raw };
}

/** Read and parse a footprint file from disk. */
export async function parseFootprintFile(filePath: string): Promise<Footprint> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new ParseError('Footprint file could not be read', filePath);
  }
  return parseFootprint(raw, filePath);
}

function mergeSupersedes(
  related: FootprintRelated | undefined,
  supersedes: string[] | undefined,
): FootprintRelated | undefined {
  if (!related && (!supersedes || supersedes.length === 0)) return undefined;
  const merged: FootprintRelated = { ...(related ?? {}) };
  if (supersedes && supersedes.length > 0) {
    const existing = merged.supersedes ?? [];
    merged.supersedes = Array.from(new Set([...existing, ...supersedes]));
  }
  return merged;
}

/** Drop undefined/empty fields so YAML frontmatter stays clean. */
function cleanFrontmatter(fm: FootprintFrontmatter): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schema_version: fm.schema_version,
    id: fm.id,
    created_at: fm.created_at,
  };
  if (fm.updated_at) out.updated_at = fm.updated_at;
  out.actor = fm.actor;
  if (fm.requester) out.requester = fm.requester;
  if (fm.agent_model) out.agent_model = fm.agent_model;
  out.work_type = fm.work_type;
  out.status = fm.status;
  if (fm.repo && (fm.repo.name || fm.repo.branch)) out.repo = fm.repo;
  if (fm.related && Object.keys(fm.related).length > 0) out.related = fm.related;
  if (fm.files_touched && fm.files_touched.length > 0) out.files_touched = fm.files_touched;
  if (fm.tags && fm.tags.length > 0) out.tags = fm.tags;
  return out;
}

/**
 * `files_touched` entries land in committed frontmatter and are matched against
 * repo paths by search — only plain repo-relative paths are meaningful, and
 * absolute or `..`-traversing entries are likely mistakes (or mischief).
 */
function validateFilesTouched(files: string[] | undefined): string[] | undefined {
  if (!files || files.length === 0) return undefined;
  return files.map((entry) => {
    // Normalize separators explicitly (not via toPosix): entries are plain
    // strings that may carry Windows separators regardless of host platform.
    const f = entry.trim().replace(/\\/g, '/');
    if (f === '') {
      throw new ParseError('files_touched entries must be non-empty repo-relative paths');
    }
    if (f.startsWith('/') || /^[A-Za-z]:\//.test(f)) {
      throw new ParseError(`files_touched must be repo-relative, got absolute path: ${f}`);
    }
    if (f.split('/').includes('..')) {
      throw new ParseError(`files_touched must not contain '..' segments: ${f}`);
    }
    return f;
  });
}

function validateRelatedUrls(related: FootprintRelated | undefined): void {
  for (const u of related?.urls ?? []) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new ParseError(`related.urls entry is not a valid URL: ${u}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ParseError(`related.urls only allows http(s) URLs, got: ${u}`);
    }
  }
}

/**
 * Write a new footprint: resolve config, generate id/filename, render markdown,
 * run redaction + secret scan, write the file, and return the parsed Footprint.
 * Throws SecretDetectedError when secrets remain and block_on_secret is set
 * (unless `allowSecret` is true).
 */
export async function writeFootprint(
  input: WriteFootprintInput & { cwd: string },
): Promise<Footprint> {
  const { cwd } = input;
  const config = await loadConfig(cwd);

  const createdAt = input.createdAt ?? new Date().toISOString();
  const date = new Date(createdAt);
  const slug = slugify(input.title);
  const suffix = randomSuffix();
  const id = generateFootprintId(date, slug, suffix);
  const relPath = buildFootprintFilename(date, slug, suffix);
  const absPath = path.join(footprintsDir(cwd), ...relPath.split('/'));

  const workType: WorkType = input.workType ?? 'implementation';
  const status: FootprintStatus = input.status ?? 'completed';

  const filesTouched = validateFilesTouched(input.filesTouched);

  // Key-based redaction (plan §12) applies to structured frontmatter values
  // (e.g. nested objects under repo/related). It does not touch prose.
  const related = mergeSupersedes(input.related, input.supersedes);
  validateRelatedUrls(related);
  const frontmatter: FootprintFrontmatter = {
    schema_version: 1,
    id,
    created_at: createdAt,
    actor: input.actor,
    requester: input.requester,
    agent_model: input.agentModel,
    work_type: workType,
    status,
    repo: input.repo
      ? (redactDeep(input.repo, { keys: config.security.redaction_keys }) as typeof input.repo)
      : undefined,
    related: related
      ? (redactDeep(related, { keys: config.security.redaction_keys }) as typeof related)
      : undefined,
    files_touched: filesTouched,
    tags: input.tags,
  };

  // Render the body from structured sections.
  const body = renderFootprintBody(input.title, {
    purpose: input.purpose,
    decisions: input.decisions,
    rejectedOptions: input.rejectedOptions,
    implementationNotes: input.implementationNotes,
    commandsRun: input.commandsRun,
    memoryLearned: input.memoryLearned,
    futureAgentGuidance: input.futureAgentGuidance,
  });

  // Content (pattern) scan over the rendered body. Key-based redaction does not
  // mask prose secrets, so any remaining match blocks the write (plan §12).
  if (config.security.scan_content) {
    const findings: SecretFinding[] = scanForSecrets(body);
    if (findings.length > 0 && config.security.block_on_secret && !input.allowSecret) {
      throw new SecretDetectedError(findings);
    }
  }

  const raw = serializeFrontmatter(cleanFrontmatter(frontmatter), body);

  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, raw, 'utf8');

  return parseFootprint(raw, absPath);
}

async function walkMarkdown(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(full)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

/** List all footprints under the footprints dir, sorted by created_at desc. */
export async function listFootprints(cwd: string): Promise<Footprint[]> {
  const dir = footprintsDir(cwd);
  const files = await walkMarkdown(dir);
  const footprints = await Promise.all(files.map((f) => parseFootprintFile(f)));
  footprints.sort((a, b) => {
    const at = a.frontmatter.created_at;
    const bt = b.frontmatter.created_at;
    return at < bt ? 1 : at > bt ? -1 : 0;
  });
  return footprints;
}

/** Find a footprint by id; returns null if not present. */
export async function findFootprintById(cwd: string, id: string): Promise<Footprint | null> {
  const files = await walkMarkdown(footprintsDir(cwd));
  for (const file of files) {
    const fp = await parseFootprintFile(file);
    if (fp.frontmatter.id === id) return fp;
  }
  return null;
}

/** Compute the repo-relative (forward-slash) path of a footprint. */
export function footprintRepoPath(cwd: string, fp: Footprint): string {
  return relativeToCwd(cwd, fp.filePath);
}
