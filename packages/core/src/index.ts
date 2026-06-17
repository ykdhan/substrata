// Public API for @substrata/core. See plan §15 Phase 2 "Core APIs".

export type {
  AttributionEnv,
  ChangeAction,
  ChangeResult,
  Footprint,
  FootprintFrontmatter,
  FootprintRelated,
  FootprintRepo,
  FootprintSections,
  FootprintStatus,
  IndexStatus,
  InitOptions,
  MemoryDocument,
  MemoryFrontmatter,
  RedactionOptions,
  RejectedOption,
  SearchResult,
  SecretFinding,
  SubstrataConfig,
  WorkType,
  WriteFootprintInput,
} from './types';

export {
  ConfigError,
  NotFoundError,
  ParseError,
  SecretDetectedError,
  SubstrataError,
} from './errors';

export {
  SUBSTRATA_DIRNAME,
  accessLogPath,
  configPath,
  footprintFilePath,
  footprintRelativePath,
  footprintsDir,
  indexPath,
  memoryDir,
  relativeToCwd,
  substrataDir,
  templatesDir,
  toPosix,
} from './paths';

export { buildFootprintFilename, generateFootprintId, randomSuffix, slugify } from './ids';

export {
  extractTitle,
  parseFootprintBody,
  parseFrontmatter,
  renderFootprintBody,
  serializeFrontmatter,
} from './markdown';
export type { ParsedFrontmatter } from './markdown';

export { DEFAULT_REDACTION_KEYS, defaultConfig, loadConfig, renderConfig } from './config';

export {
  SECRET_PATTERNS,
  redactDeep,
  redactText,
  scanForHighEntropy,
  scanForSecrets,
} from './redaction';

export {
  findFootprintById,
  footprintRepoPath,
  listFootprints,
  parseFootprint,
  parseFootprintFile,
  writeFootprint,
} from './footprint';

export {
  appendMemoryEntries,
  existingEntryIds,
  listMemoryDocuments,
  parseMemory,
  parseMemoryFile,
} from './memory';
export type { MemoryEntry } from './memory';

export { supersedeFootprint } from './supersede';

export { initProject } from './init';

export { GITIGNORE_LINES, ensureGitignore } from './setup/gitignore';
export { writeShellEnv } from './setup/shellrc';
export { AGENTS_MD_SECTION, upsertAgentsMd } from './setup/agents-md';
export { installSecretHook } from './setup/hook';
export { installClaudeHooks, claudeHooksInstalled } from './setup/claude-hooks';
export { hasEffectiveChanges, renderPlan, summarizePlan } from './setup/plan';
