// Public API for @substrata/hooks — Claude Code lifecycle hook primitives.
//
// This package owns the two reusable, dependency-light pieces of the Claude Code
// hook integration:
//   - the stdin/stdout protocol adapter (`protocol.ts`)
//   - the `.claude/settings.json` lifecycle-hook installer (`install.ts`)
//
// The higher-level context-building orchestration (which wires these to the
// search/graph index + renderer + telemetry) lives in the CLI, since it is
// application wiring rather than a reusable hook primitive.

export { emitContext, emitStopDecision, readHookPayload, readStdin, runHook } from './protocol';
export type { HookEventName, HookPayload } from './protocol';

export { claudeHooksInstalled, installClaudeHooks } from './install';
