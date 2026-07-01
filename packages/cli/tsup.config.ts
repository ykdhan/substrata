import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  target: 'node20',
  // The internal workspace packages are bundled into the published artifact so
  // substrata-cli ships as a single self-contained npm package.
  noExternal: [
    '@substrata/core',
    '@substrata/editor-integrations',
    '@substrata/hooks',
    '@substrata/index',
    '@substrata/mcp-server',
  ],
  external: ['better-sqlite3'],
});
