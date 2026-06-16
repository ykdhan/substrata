/**
 * Core data model for Substrata. See plan §7.
 *
 * NOTE: there is intentionally NO `confidence` field anywhere in this model.
 */

export type WorkType =
  | 'implementation'
  | 'implementation_decision'
  | 'bug_fix'
  | 'refactor'
  | 'investigation'
  | 'architecture_decision'
  | 'test_update'
  | 'documentation';

export type FootprintStatus = 'draft' | 'completed' | 'superseded' | 'deprecated';

export type FootprintRepo = {
  name?: string;
  branch?: string;
};

export type FootprintRelated = {
  commits?: string[];
  prs?: Array<string | number>;
  issues?: Array<string | number>;
  urls?: string[];
  /** ids this footprint replaces */
  supersedes?: string[];
  /** ids that replace this one (tool-maintained) */
  superseded_by?: string[];
};

export type FootprintFrontmatter = {
  schema_version: 1;
  id: string;
  created_at: string;
  updated_at?: string;

  actor: string;
  requester?: string;
  agent_model?: string;

  work_type: WorkType;
  status: FootprintStatus;

  repo?: FootprintRepo;
  related?: FootprintRelated;

  files_touched?: string[];
  tags?: string[];
};

export type RejectedOption = {
  option: string;
  reason: string;
};

export type FootprintSections = {
  purpose?: string;
  decisions?: string[];
  rejectedOptions?: RejectedOption[];
  implementationNotes?: string;
  commandsRun?: string[];
  memoryLearned?: string[];
  futureAgentGuidance?: string;
};

export type Footprint = {
  frontmatter: FootprintFrontmatter;
  title: string;
  body: string;
  sections: FootprintSections;
  filePath: string;
  raw: string;
};

export type MemoryFrontmatter = {
  schema_version: 1;
  id: string;
  updated_at?: string;
  type?: string;
  tags?: string[];
  [key: string]: unknown;
};

export type MemoryDocument = {
  frontmatter: MemoryFrontmatter;
  title: string;
  body: string;
  filePath: string;
  raw: string;
};

export type SearchResult = {
  id: string;
  title: string;
  filePath: string;
  score: number;
  snippet: string;
  tags: string[];
  createdAt?: string;
  filesTouched: string[];
  status: FootprintStatus;
};

/** Input for writing a new footprint. Combined with `{ cwd }` at call time. */
export type WriteFootprintInput = {
  title: string;
  purpose?: string;
  actor: string;
  requester?: string;
  agentModel?: string;
  workType?: WorkType;
  status?: FootprintStatus;
  decisions?: string[];
  rejectedOptions?: RejectedOption[];
  implementationNotes?: string;
  commandsRun?: string[];
  memoryLearned?: string[];
  futureAgentGuidance?: string;
  filesTouched?: string[];
  tags?: string[];
  repo?: FootprintRepo;
  related?: FootprintRelated;
  /** Explicit creation timestamp; defaults to now (ISO). */
  createdAt?: string;
  /** ids this footprint supersedes (merged into related.supersedes). */
  supersedes?: string[];
  /** Bypass the block_on_secret gate even if findings remain. */
  allowSecret?: boolean;
};

export type SubstrataConfig = {
  schema_version: 1;
  project: {
    name: string;
  };
  storage: {
    footprints_dir: string;
    memory_dir: string;
    index_path: string;
  };
  search: {
    default_limit: number;
    max_context_tokens: number;
  };
  security: {
    redact: boolean;
    scan_content: boolean;
    entropy_scan: boolean;
    entropy_min_length: number;
    block_on_secret: boolean;
    redaction_keys: string[];
  };
  agent: {
    default_actor: string;
    default_model?: string;
    require_footprint_after_non_trivial_work: boolean;
  };
  hooks: {
    /** Master switch for the Claude Code lifecycle hooks. */
    enabled: boolean;
    /** Inject relevant context on SessionStart / UserPromptSubmit. */
    inject_context: boolean;
    /**
     * Token budget for hook-injected context. When omitted, falls back to
     * `search.max_context_tokens` so existing tuning carries over.
     */
    max_context_tokens?: number;
    /**
     * Minimum (normalized) relevance score a result must clear to be injected.
     * 0 lets everything the search returns through; raise it to suppress noise.
     */
    min_score: number;
    /** On Stop / SubagentStop, remind the agent to leave a footprint. */
    remind_on_stop: boolean;
    /** Changed-file count at/above which work counts as "non-trivial". */
    non_trivial_threshold: number;
  };
};

export type InitOptions = {
  /** Project name; defaults to the directory basename when omitted. */
  projectName?: string;
};

export type ChangeAction = 'create' | 'update' | 'skip';

export type ChangeResult = {
  path: string;
  action: ChangeAction;
  description: string;
  /** Intended file contents (present for create/update, including dry runs). */
  contents?: string;
};

export type IndexStatus =
  | { state: 'missing' }
  | { state: 'stale'; reason: 'mtime' | 'count' | 'schema' }
  | { state: 'fresh' };

export type SecretFinding = {
  name: string;
  line: number;
};

export type RedactionOptions = {
  /** Keys whose values are replaced with [REDACTED] (case-insensitive). */
  keys?: string[];
  /** Replacement string for matched values. */
  replacement?: string;
};

export type AttributionEnv = {
  actor?: string;
  model?: string;
  requester?: string;
};
