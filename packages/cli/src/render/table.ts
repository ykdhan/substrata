import type { SearchResult } from '@substrata/core';
import pc from 'picocolors';

/**
 * Human-readable rendering of search results and footprint lists. Output is
 * informative, not noisy: one block per result with id, title, status, tags,
 * path, and a snippet.
 */

function statusLabel(status: SearchResult['status']): string {
  switch (status) {
    case 'superseded':
      return pc.yellow('[superseded]');
    case 'deprecated':
      return pc.red('[deprecated]');
    case 'draft':
      return pc.dim('[draft]');
    default:
      return '';
  }
}

/** Render a list of search results for the terminal. */
export function renderSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return pc.dim('No matching footprints or memory found.');
  }
  const blocks = results.map((r, i) => {
    const n = pc.dim(`${i + 1}.`);
    const status = statusLabel(r.status);
    const header = `${n} ${pc.bold(r.title || r.id)}${status ? ` ${status}` : ''}`;
    const lines = [header, `   ${pc.dim('id:')} ${r.id}`, `   ${pc.dim('path:')} ${r.filePath}`];
    if (r.tags.length > 0) lines.push(`   ${pc.dim('tags:')} ${r.tags.join(', ')}`);
    if (r.snippet.trim().length > 0) {
      lines.push(`   ${pc.dim(r.snippet.replace(/\s+/g, ' ').trim())}`);
    }
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

/** Render footprints (from `list`) as compact rows. */
export function renderFootprintList(
  rows: Array<{
    id: string;
    title: string;
    status: SearchResult['status'];
    createdAt?: string;
    tags: string[];
  }>,
): string {
  if (rows.length === 0) {
    return pc.dim('No footprints found.');
  }
  return rows
    .map((r) => {
      const date = r.createdAt ? r.createdAt.slice(0, 10) : '----------';
      const status = statusLabel(r.status);
      const tags = r.tags.length > 0 ? pc.dim(` (${r.tags.join(', ')})`) : '';
      return `${pc.dim(date)}  ${pc.bold(r.title || r.id)}${status ? ` ${status}` : ''}\n  ${pc.dim(r.id)}${tags}`;
    })
    .join('\n');
}
