// Public API for @substrata/search. See plan §11 + §15 Phase 4.

export { buildIndex } from './indexer';
export type { BuildIndexOptions } from './indexer';

export { getIndexStatus } from './freshness';

export { search, getRelatedToFile, buildMatchQuery } from './query';
export type { SearchOptions } from './query';

export {
  score,
  normalizeBm25,
  recencyDecay,
  recencyBoost,
  filesOverlap,
  statusPenalty,
  RECENCY_DECAY_DAYS,
  RECENCY_BOOST_WEIGHT,
  FILES_OVERLAP_BOOST,
  STATUS_PENALTIES,
} from './ranking';
export type { RankInput } from './ranking';

export { SCHEMA_VERSION, applySchema } from './schema';
export { openIndexDb, closeDb, indexDbExists } from './sqlite';
export type { OpenIndexDbOptions } from './sqlite';

export { logAccess, readStats } from './telemetry';
export type { AccessEntry, AccessOp, AccessSource, AccessStats } from './telemetry';
