import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { initProject } from '../src/index';

/** Create a fresh temp dir under the OS temp root. */
export async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'substrata-test-'));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Create a temp dir and initialize a .substrata project inside it. */
export async function makeInitedProject(projectName = 'test-project'): Promise<string> {
  const dir = await makeTempDir();
  await initProject(dir, { projectName });
  return dir;
}
