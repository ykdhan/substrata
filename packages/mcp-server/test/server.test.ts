import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { initProject, parseFootprintFile, writeFootprint } from '@substrata/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSubstrataMcpServer } from '../src/index';

let tmpRepo: string;

/** Connect a fresh in-memory client/server pair against the tmp repo. */
async function connectClient(cwd: string): Promise<Client> {
  const server = createSubstrataMcpServer({ cwd });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Extract the JSON payload returned in a tool result's text content. */
function parsePayload(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  const text = content.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

beforeEach(async () => {
  tmpRepo = await mkdtemp(path.join(tmpdir(), 'substrata-mcp-'));
  await initProject(tmpRepo, { projectName: 'mcp-test' });

  await writeFootprint({
    cwd: tmpRepo,
    title: 'Improve learner search performance',
    purpose: 'Reduce latency for large organizations using cursor pagination.',
    actor: 'claude-code',
    workType: 'implementation_decision',
    decisions: ['Use cursor pagination instead of offset pagination.'],
    rejectedOptions: [
      { option: 'Redis cache', reason: 'Consistency risk and operational overhead.' },
    ],
    memoryLearned: ['Learner DB access should go through LearnerQueryService.'],
    filesTouched: ['api/learners.ts', 'services/LearnerQueryService.ts'],
    tags: ['learner-search', 'performance'],
  });

  await writeFootprint({
    cwd: tmpRepo,
    title: 'Add payment retry logic',
    purpose: 'Retry failed payment captures with exponential backoff.',
    actor: 'claude-code',
    workType: 'implementation',
    filesTouched: ['services/PaymentService.ts'],
    tags: ['payments'],
  });
});

afterEach(async () => {
  await rm(tmpRepo, { recursive: true, force: true });
});

describe('createSubstrataMcpServer', () => {
  it('lists the five core tools plus the four graph tools', async () => {
    const client = await connectClient(tmpRepo);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'substrata_add',
        'substrata_context',
        'substrata_graph_context',
        'substrata_graph_explain',
        'substrata_graph_related',
        'substrata_graph_stats',
        'substrata_list_recent',
        'substrata_related_to_file',
        'substrata_search',
      ].sort(),
    );
    await client.close();
  });

  it('substrata_search returns relevant results', async () => {
    const client = await connectClient(tmpRepo);
    const result = await client.callTool({
      name: 'substrata_search',
      arguments: { query: 'learner search pagination' },
    });
    const payload = parsePayload(result);
    const results = payload.results as Array<{ title: string }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toContain('learner search');
    await client.close();
  });

  it('substrata_context returns relevant context for a task', async () => {
    const client = await connectClient(tmpRepo);
    const result = await client.callTool({
      name: 'substrata_context',
      arguments: { task: 'I need to improve learner search performance' },
    });
    const payload = parsePayload(result);
    expect(typeof payload.context).toBe('string');
    // FTS snippets wrap matched terms in [brackets]; strip them before matching.
    const plainContext = (payload.context as string).replace(/[[\]]/g, '');
    expect(plainContext).toMatch(/learner search/i);
    expect(plainContext).toContain('Source: .substrata/footprints');
    const sources = payload.sources as Array<{ filePath: string }>;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]?.filePath).toContain('.substrata/footprints');
    await client.close();
  });

  it('substrata_add creates a parseable footprint and returns id/filePath', async () => {
    const client = await connectClient(tmpRepo);
    const result = await client.callTool({
      name: 'substrata_add',
      arguments: {
        title: 'Switch to argon2 for password hashing',
        purpose: 'bcrypt cost was too low for current hardware.',
        actor: 'claude-code',
        decisions: ['Use argon2id.'],
        tags: ['security', 'auth'],
      },
    });
    const payload = parsePayload(result);
    expect(typeof payload.id).toBe('string');
    expect(typeof payload.filePath).toBe('string');

    const absPath = path.join(tmpRepo, payload.filePath as string);
    const parsed = await parseFootprintFile(absPath);
    expect(parsed.title).toBe('Switch to argon2 for password hashing');
    expect(parsed.frontmatter.id).toBe(payload.id);
    await client.close();
  });

  it('substrata_add refuses a secret and does not create a file', async () => {
    const client = await connectClient(tmpRepo);
    const fakeSecret = `ghp_${'a'.repeat(36)}`;
    const result = await client.callTool({
      name: 'substrata_add',
      arguments: {
        title: 'Document deploy token',
        purpose: `Our token is ${fakeSecret} for the deploy bot.`,
        actor: 'claude-code',
      },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const text = content.map((c) => c.text).join('\n');
    expect(text).toContain('github_pat');
    expect(text).not.toContain(fakeSecret);

    // Structured details carry pattern name + line, never the value.
    const structured = (result as { structuredContent?: { secrets?: Array<{ name: string }> } })
      .structuredContent;
    expect(structured?.secrets?.[0]?.name).toBe('github_pat');

    // No footprint file was written for this secret-bearing footprint.
    const footprintsRoot = path.join(tmpRepo, '.substrata', 'footprints');
    const all = await collectMarkdown(footprintsRoot);
    for (const file of all) {
      const body = await readFile(file, 'utf8');
      expect(body).not.toContain(fakeSecret);
    }
    await client.close();
  });

  it('substrata_related_to_file returns docs referencing the file', async () => {
    const client = await connectClient(tmpRepo);
    const result = await client.callTool({
      name: 'substrata_related_to_file',
      arguments: { filePath: 'api/learners.ts' },
    });
    const payload = parsePayload(result);
    const results = payload.results as Array<{ filesTouched: string[] }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.filesTouched.includes('api/learners.ts'))).toBe(true);
    await client.close();
  });

  it('substrata_list_recent returns footprint summaries', async () => {
    const client = await connectClient(tmpRepo);
    const result = await client.callTool({
      name: 'substrata_list_recent',
      arguments: { limit: 10 },
    });
    const payload = parsePayload(result);
    const results = payload.results as Array<{ id: string; title: string }>;
    expect(results.length).toBe(2);
    expect(results.map((r) => r.title)).toContain('Improve learner search performance');
    await client.close();
  });

  it('substrata_list_recent filters by tag', async () => {
    const client = await connectClient(tmpRepo);
    const result = await client.callTool({
      name: 'substrata_list_recent',
      arguments: { tags: ['payments'] },
    });
    const payload = parsePayload(result);
    const results = payload.results as Array<{ title: string }>;
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe('Add payment retry logic');
    await client.close();
  });

  it('substrata_graph_context returns enriched, graph-aware context', async () => {
    const client = await connectClient(tmpRepo);
    const result = await client.callTool({
      name: 'substrata_graph_context',
      arguments: { task: 'improve learner search performance' },
    });
    const payload = parsePayload(result);
    expect(typeof payload.context).toBe('string');
    expect(payload.context as string).toContain('Relevant Substrata context (graph-aware):');
    expect(payload.context as string).toContain('Why selected:');
    expect(Array.isArray(payload.sources)).toBe(true);
    await client.close();
  });

  it('substrata_graph_related relates docs touching a file', async () => {
    const client = await connectClient(tmpRepo);
    const result = await client.callTool({
      name: 'substrata_graph_related',
      arguments: { target: 'api/learners.ts' },
    });
    const payload = parsePayload(result);
    const results = payload.results as Array<{ ref: string; bridges: unknown[] }>;
    expect(results.length).toBeGreaterThan(0);
    expect(Array.isArray(results[0]?.bridges)).toBe(true);
    await client.close();
  });

  it('substrata_graph_stats returns node/edge counts', async () => {
    const client = await connectClient(tmpRepo);
    const result = await client.callTool({ name: 'substrata_graph_stats', arguments: {} });
    const payload = parsePayload(result);
    expect((payload.totalNodes as number) > 0).toBe(true);
    const nodesByKind = payload.nodesByKind as Record<string, number>;
    expect(nodesByKind.footprint).toBeGreaterThanOrEqual(2);
    await client.close();
  });

  it('substrata_graph_explain returns a path between two footprints', async () => {
    // Both seeded footprints differ; add two that share a file for a clean path.
    await writeFootprint({
      cwd: tmpRepo,
      title: 'Cache layer A',
      actor: 'bot-a',
      decisions: ['Use an in-memory LRU.'],
      filesTouched: ['cache/shared.ts'],
    });
    await writeFootprint({
      cwd: tmpRepo,
      title: 'Cache layer B',
      actor: 'bot-b',
      decisions: ['Add TTL eviction.'],
      filesTouched: ['cache/shared.ts'],
    });
    const { listFootprints } = await import('@substrata/core');
    const fps = await listFootprints(tmpRepo);
    const a = fps.find((f) => f.title === 'Cache layer A')!;
    const b = fps.find((f) => f.title === 'Cache layer B')!;

    const client = await connectClient(tmpRepo);
    const result = await client.callTool({
      name: 'substrata_graph_explain',
      arguments: { from: a.frontmatter.id, to: b.frontmatter.id },
    });
    const payload = parsePayload(result);
    const pathResult = payload.path as { found: boolean; path: Array<{ node: { kind: string } }> };
    expect(pathResult.found).toBe(true);
    expect(pathResult.path.some((hop) => hop.node.kind === 'file')).toBe(true);
    await client.close();
  });
});

/** Recursively collect .md files under a directory (test helper). */
async function collectMarkdown(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdown(full)));
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}
