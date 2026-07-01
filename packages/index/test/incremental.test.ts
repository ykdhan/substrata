import { mkdtemp, rm, writeFile, readFile, unlink } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { graphPath, indexPath, initProject, writeFootprint } from '@substrata/core';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGraphStatus } from '../src/graph/freshness';
import { buildGraph } from '../src/graph/indexer';
import { openGraphDb, closeGraphDb } from '../src/graph/sqlite';
import { getIndexStatus } from '../src/freshness';
import { buildIndex } from '../src/indexer';
import { closeDb, openIndexDb } from '../src/sqlite';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'substrata-incr-'));
  await initProject(cwd);
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/** Structural snapshot of both indexes for equivalence comparison. */
function snapshot(dir: string): {
  docs: unknown[];
  nodes: Array<{ id: string; kind: string; ref: string | null; data_json: string | null }>;
  edges: unknown[];
} {
  const idb = openIndexDb(dir, { readonly: true });
  const docs = idb
    .prepare(
      'SELECT id,type,title,file_path,status,created_at,updated_at,tags_json,files_json,raw_text,work_type FROM documents ORDER BY id',
    )
    .all();
  closeDb(idb);
  const gdb = openGraphDb(dir, { readonly: true });
  const nodes = gdb.prepare('SELECT id,kind,ref,data_json FROM nodes ORDER BY id').all() as Array<{
    id: string;
    kind: string;
    ref: string | null;
    data_json: string | null;
  }>;
  const edges = gdb.prepare('SELECT src,dst,rel,weight FROM edges ORDER BY src,dst,rel').all();
  closeGraphDb(gdb);
  return { docs, nodes, edges };
}

/**
 * Assert the current (incrementally-built) index equals a from-scratch full
 * rebuild of the SAME corpus. This is the core correctness invariant for
 * incremental indexing.
 */
async function expectIncrementalMatchesFull(dir: string): Promise<void> {
  const incremental = snapshot(dir);
  await buildIndex(dir, { rebuild: true });
  await buildGraph(dir, { rebuild: true });
  const full = snapshot(dir);

  // FTS rows + graph edges must be byte-for-byte identical.
  expect(incremental.docs).toEqual(full.docs);
  expect(incremental.edges).toEqual(full.edges);

  // Node identity (id/kind/ref) must match exactly; footprint/memory node data
  // (ranking inputs) must match. Bridge-node display labels may legitimately
  // differ by writer order and are not compared.
  const key = (n: { id: string; kind: string; ref: string | null }) => `${n.id}|${n.kind}|${n.ref}`;
  expect(incremental.nodes.map(key).sort()).toEqual(full.nodes.map(key).sort());

  const docData = (ns: typeof incremental.nodes) =>
    ns
      .filter((n) => n.kind === 'footprint' || n.kind === 'memory')
      .map((n) => `${n.id}=${n.data_json}`)
      .sort();
  expect(docData(incremental.nodes)).toEqual(docData(full.nodes));
}

async function buildBoth(dir: string): Promise<void> {
  await buildIndex(dir);
  await buildGraph(dir);
}

/** Deterministic PRNG so a failing fuzz run is reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

async function addFp(
  dir: string,
  n: number,
  opts: { supersedes?: string[] } = {},
): Promise<{ id: string; filePath: string }> {
  const fp = await writeFootprint({
    cwd: dir,
    title: `Item ${n} on module ${n % 7}`,
    actor: `agent-${n % 3}`,
    purpose: `Purpose ${n}`,
    decisions: [`Use approach ${n % 5}`, `Prefer strategy ${n % 4}`],
    rejectedOptions: [{ option: `Redis ${n % 3}`, reason: 'cost' }],
    filesTouched: [`src/mod${n % 7}.ts`, `test/mod${n % 7}.test.ts`],
    tags: [`tag${n % 6}`, `area${n % 3}`],
    workType: 'implementation',
    supersedes: opts.supersedes,
  });
  return { id: fp.frontmatter.id, filePath: fp.filePath };
}

/** Append a decision bullet to a footprint file (a real content edit, same id). */
async function editFp(filePath: string, marker: number): Promise<void> {
  const raw = await readFile(filePath, 'utf8');
  const next = raw.replace('## Decisions\n', `## Decisions\n\n- Edited decision ${marker}\n`);
  await writeFile(filePath, next === raw ? `${raw}\n- Edited decision ${marker}\n` : next, 'utf8');
}

describe('v1 → v2 schema migration (0.2.0 in-place upgrade)', () => {
  /** Construct a real 0.2.0-format graph.sqlite: edges WITHOUT `owner`, no
   * source_files manifest, schema_version = 1. */
  function writeV1GraphDb(dir: string): void {
    mkdirSync(path.dirname(graphPath(dir)), { recursive: true });
    const db = new Database(graphPath(dir));
    db.exec(
      `CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, label TEXT, ref TEXT, data_json TEXT);`,
    );
    db.exec(
      `CREATE TABLE edges (src TEXT, dst TEXT, rel TEXT, weight REAL, PRIMARY KEY (src,dst,rel));`,
    );
    db.exec(`CREATE TABLE graph_meta (key TEXT PRIMARY KEY, value TEXT);`);
    db.prepare(`INSERT INTO graph_meta (key,value) VALUES ('schema_version','1')`).run();
    db.close();
  }

  /** Construct a real 0.2.0-format footprint.sqlite: no source_files, schema 1. */
  function writeV1IndexDb(dir: string): void {
    mkdirSync(path.dirname(indexPath(dir)), { recursive: true });
    const db = new Database(indexPath(dir));
    db.exec(
      `CREATE TABLE documents (id TEXT PRIMARY KEY, type TEXT, title TEXT, file_path TEXT, status TEXT, created_at TEXT, updated_at TEXT, tags_json TEXT, files_json TEXT, raw_text TEXT, work_type TEXT);`,
    );
    db.exec(
      `CREATE VIRTUAL TABLE documents_fts USING fts5(id UNINDEXED, title, tags, files, content);`,
    );
    db.exec(`CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT);`);
    db.prepare(`INSERT INTO index_meta (key,value) VALUES ('schema_version','1')`).run();
    db.close();
  }

  it('migrates a v1 graph DB without crashing on the missing `owner` column', async () => {
    for (let i = 0; i < 3; i += 1) {
      await writeFootprint({
        cwd,
        title: `t${i}`,
        actor: 'a',
        decisions: [`d${i}`],
        tags: [`x${i}`],
        filesTouched: [`f${i}.ts`],
      });
    }
    writeV1GraphDb(cwd);
    writeV1IndexDb(cwd);

    // Both indexes must report stale (schema) before the rebuild.
    expect((await getGraphStatus(cwd)).state).toBe('stale');
    expect((await getIndexStatus(cwd)).state).toBe('stale');

    // The migration must not throw `no such column: owner` — it drops the old
    // schema on open, then rebuilds to v2.
    await expect(buildGraph(cwd)).resolves.toBeUndefined();
    await expect(buildIndex(cwd)).resolves.toBeUndefined();

    expect((await getGraphStatus(cwd)).state).toBe('fresh');
    expect((await getIndexStatus(cwd)).state).toBe('fresh');

    // The migrated graph is populated and structurally equals a full rebuild.
    await expectIncrementalMatchesFull(cwd);
  });
});

describe('incremental indexing == full rebuild', () => {
  it('add: incremental build after adding a footprint matches a full rebuild', async () => {
    await addFp(cwd, 1);
    await buildBoth(cwd);
    await addFp(cwd, 2);
    await buildBoth(cwd); // incremental
    await expectIncrementalMatchesFull(cwd);
  });

  it('edit: changing a footprint content matches a full rebuild', async () => {
    const a = await addFp(cwd, 1);
    await addFp(cwd, 2);
    await buildBoth(cwd);
    await editFp(a.filePath, 99);
    await buildBoth(cwd);
    await expectIncrementalMatchesFull(cwd);
  });

  it('remove: deleting a footprint file matches a full rebuild (orphan cleanup)', async () => {
    const a = await addFp(cwd, 1);
    await addFp(cwd, 2);
    await buildBoth(cwd);
    await unlink(a.filePath);
    await buildBoth(cwd);
    await expectIncrementalMatchesFull(cwd);
  });

  it('supersede: adding a superseding footprint matches a full rebuild', async () => {
    const a = await addFp(cwd, 1);
    await buildBoth(cwd);
    await addFp(cwd, 2, { supersedes: [a.id] });
    await buildBoth(cwd);
    await expectIncrementalMatchesFull(cwd);
  });

  it('remove a superseded footprint (cross-doc SUPERSEDES coupling) matches a full rebuild', async () => {
    const a = await addFp(cwd, 1);
    const b = await addFp(cwd, 2, { supersedes: [a.id] });
    await buildBoth(cwd);
    // Remove A, which B supersedes — B is an unaffected supersede-neighbor.
    await unlink(a.filePath);
    await buildBoth(cwd);
    await expectIncrementalMatchesFull(cwd);
    expect(b.id).toBeTruthy();
  });

  it.each([1337, 42, 2024])(
    'fuzz(seed=%i): a long sequence of add/edit/remove/supersede stays equivalent to a full rebuild',
    async (seed) => {
      const rng = makeRng(seed);
      const live: Array<{ id: string; filePath: string }> = [];
      let counter = 0;

      await addFp(cwd, counter++);
      await buildBoth(cwd);

      for (let step = 0; step < 50; step += 1) {
        const roll = rng();
        if (roll < 0.4 || live.length === 0) {
          const supersede = live.length > 2 && rng() < 0.3;
          const target = supersede ? [live[Math.floor(rng() * live.length)]!.id] : undefined;
          live.push(await addFp(cwd, counter++, { supersedes: target }));
        } else if (roll < 0.7) {
          const victim = live[Math.floor(rng() * live.length)]!;
          await editFp(victim.filePath, counter++);
        } else {
          const idx = Math.floor(rng() * live.length);
          const victim = live[idx]!;
          await unlink(victim.filePath).catch(() => {});
          live.splice(idx, 1);
        }
        await buildBoth(cwd); // incremental
      }

      await expectIncrementalMatchesFull(cwd);
    },
  );

  it('perf: reindexing one added footprint is much cheaper than a full rebuild', async () => {
    // Seed a corpus large enough for the O(N) vs O(changed) gap to show.
    for (let i = 0; i < 150; i += 1) await addFp(cwd, i);
    await buildIndex(cwd, { rebuild: true });
    await buildGraph(cwd, { rebuild: true });

    // Full rebuild cost over the whole corpus.
    let t = performance.now();
    await buildIndex(cwd, { rebuild: true });
    await buildGraph(cwd, { rebuild: true });
    const fullMs = performance.now() - t;

    // Add one footprint, then an INCREMENTAL build.
    await addFp(cwd, 999);
    t = performance.now();
    await buildIndex(cwd);
    await buildGraph(cwd);
    const incrMs = performance.now() - t;

    // Incremental should be a fraction of a full rebuild (assert < half; in
    // practice it is far smaller). Correctness is still checked separately.
    expect(incrMs).toBeLessThan(fullMs * 0.5);
  });
});
