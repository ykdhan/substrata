import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Create a fresh temp dir under the OS temp root. */
export async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'substrata-hooks-test-'));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
