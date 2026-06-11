import type { Dirent } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ParseError } from './errors';
import { extractTitle, parseFrontmatter } from './markdown';
import { memoryDir } from './paths';
import type { MemoryDocument, MemoryFrontmatter } from './types';

/**
 * Curated memory parsing + append-friendly entry insertion. See plan §6.
 *
 * Entries live between stable markers:
 *   <!-- substrata:entries:start -->
 *   ... entries ...
 *   <!-- substrata:entries:end -->
 *
 * Each entry is wrapped in:
 *   <!-- substrata:entry id=<sourceId> -->
 *   <lines>
 *   <!-- /substrata:entry -->
 */

const ENTRIES_START = '<!-- substrata:entries:start -->';
const ENTRIES_END = '<!-- substrata:entries:end -->';

function entryOpen(id: string): string {
  return `<!-- substrata:entry id=${id} -->`;
}
const ENTRY_CLOSE = '<!-- /substrata:entry -->';

function validateMemoryFrontmatter(
  fm: Record<string, unknown>,
  filePath: string,
): MemoryFrontmatter {
  if (fm.schema_version !== 1) {
    throw new ParseError(
      `Memory file has unsupported schema_version: ${String(fm.schema_version)} (expected 1)`,
      filePath,
    );
  }
  if (typeof fm.id !== 'string' || fm.id.length === 0) {
    throw new ParseError('Memory "id" must be a non-empty string', filePath);
  }
  return fm as MemoryFrontmatter;
}

/** Parse raw markdown into a MemoryDocument. */
export function parseMemory(raw: string, filePath: string): MemoryDocument {
  const { frontmatter, body } = parseFrontmatter(raw);
  const fm = validateMemoryFrontmatter(frontmatter, filePath);
  return { frontmatter: fm, title: extractTitle(body), body, filePath, raw };
}

/** Read and parse a memory file from disk. */
export async function parseMemoryFile(filePath: string): Promise<MemoryDocument> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new ParseError('Memory file could not be read', filePath);
  }
  return parseMemory(raw, filePath);
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

/** List all memory documents under the memory dir, sorted by file path. */
export async function listMemoryDocuments(cwd: string): Promise<MemoryDocument[]> {
  const files = await walkMarkdown(memoryDir(cwd));
  files.sort();
  return Promise.all(files.map((f) => parseMemoryFile(f)));
}

export type MemoryEntry = {
  sourceId: string;
  lines: string[];
};

/** Extract the set of sourceIds already present in a memory file body. */
export function existingEntryIds(content: string): Set<string> {
  const ids = new Set<string>();
  const re = /<!--\s*substrata:entry\s+id=([^\s]+)\s*-->/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    ids.add(match[1]!);
  }
  return ids;
}

function renderEntry(entry: MemoryEntry): string {
  return [entryOpen(entry.sourceId), ...entry.lines, ENTRY_CLOSE].join('\n');
}

/**
 * Append entries to a memory file before the entries:end marker, creating the
 * marker block if absent. Existing content is preserved byte-for-byte; entries
 * whose sourceId already appears in the file are skipped (idempotent).
 * Returns true if the file was changed.
 */
export async function appendMemoryEntries(
  filePath: string,
  entries: MemoryEntry[],
): Promise<boolean> {
  const original = await readFile(filePath, 'utf8');
  const existing = existingEntryIds(original);
  const toAdd = entries.filter((e) => !existing.has(e.sourceId));
  if (toAdd.length === 0) return false;

  const rendered = toAdd.map(renderEntry).join('\n');

  let next: string;
  const endIdx = original.indexOf(ENTRIES_END);
  if (endIdx !== -1) {
    // Insert before the existing end marker, preserving everything around it.
    const before = original.slice(0, endIdx);
    const after = original.slice(endIdx);
    const sep = before.endsWith('\n') ? '' : '\n';
    next = `${before}${sep}${rendered}\n${after}`;
  } else {
    // No marker block: create one at the end of the file.
    const base = original.endsWith('\n') ? original : `${original}\n`;
    next = `${base}\n${ENTRIES_START}\n${rendered}\n${ENTRIES_END}\n`;
  }

  await writeFile(filePath, next, 'utf8');
  return true;
}
