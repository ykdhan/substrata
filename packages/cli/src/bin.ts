#!/usr/bin/env node
import { runCli } from './index';

/**
 * CLI entry point. The shebang must remain the first line; tsup/esbuild preserves
 * it. Runs the program and sets the process exit code from `runCli`.
 */
runCli(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`Unexpected error: ${(err as Error)?.message ?? String(err)}\n`);
    process.exitCode = 2;
  });
