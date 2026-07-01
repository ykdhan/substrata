import { describe, expect, it } from 'vitest';

import { accessLogPath, graphPath, indexPath, localDir, toPosix } from '../src/index';

describe('storage paths', () => {
  const cwd = '/tmp/proj';

  it('keeps the FTS + graph index under the shareable index/ dir', () => {
    expect(toPosix(indexPath(cwd))).toBe('/tmp/proj/.substrata/index/footprint.sqlite');
    expect(toPosix(graphPath(cwd))).toBe('/tmp/proj/.substrata/index/graph.sqlite');
  });

  it('keeps the telemetry access log under the always-local local/ dir (never index/)', () => {
    expect(toPosix(localDir(cwd))).toBe('/tmp/proj/.substrata/local');
    expect(toPosix(accessLogPath(cwd))).toBe('/tmp/proj/.substrata/local/access.sqlite');
    expect(toPosix(accessLogPath(cwd))).not.toContain('/index/');
  });
});
