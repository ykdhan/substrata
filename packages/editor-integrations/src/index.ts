// Public API for @substrata/editor-integrations.
//
// This package owns the writers that integrate Substrata into the surrounding
// project / editor environment — everything that creates or updates files
// OUTSIDE Substrata's own `.substrata/` data dir:
//   - editor rule blocks (CLAUDE.md, GEMINI.md, AGENTS.md, Cursor rules)
//   - .gitignore lines + shell-rc attribution env
//   - the pre-commit secret-scan git hook
//   - the marker-section upsert primitive + the change-plan renderer
//
// `@substrata/core` stays pure domain (footprints, memory, config, redaction);
// the Claude Code lifecycle hooks live in `@substrata/hooks`.

export { GITIGNORE_LINES, ensureGitignore, gitignoreLinesFor } from './gitignore';
export type { StorageSharing } from './gitignore';
export { ensureGitattributes } from './gitattributes';
export { ensureCliDependency } from './cli-dependency';
export { writeShellEnv } from './shellrc';
export { AGENTS_MD_SECTION, SUBSTRATA_RULES_MARKDOWN, upsertAgentsMd } from './agents-md';
export { upsertMarkerSection } from './markers';
export type { UpsertMarkerOptions } from './markers';
export {
  upsertClaudeMd,
  upsertCursorRule,
  upsertEditorRules,
  upsertGeminiMd,
} from './editor-rules';
export { installSecretHook } from './hook';
export { hasEffectiveChanges, renderPlan, summarizePlan } from './plan';
