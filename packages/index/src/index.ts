// Public API for @substrata/index. See plan §11 + §15 Phase 4.

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

export { runBenchmark } from './bench';
export type { BenchQueryResult, BenchmarkOptions, BenchmarkResult } from './bench';

export { evaluateMetaFreshness, sourceStats } from './freshness';

// Graph Memory / Graph RAG (graph-rag-implementation.md). Auxiliary SQLite
// graph index built alongside the FTS index; never replaces FTS.
export { GRAPH_SCHEMA_VERSION, applyGraphSchema, dropGraphSchema } from './graph/schema';
export { closeGraphDb, graphDbExists, openGraphDb } from './graph/sqlite';
export type { OpenGraphDbOptions } from './graph/sqlite';
export {
  EDGE_WEIGHTS,
  extractConcepts,
  extractGraph,
  footprintNodeId,
  hashString,
  nodeId,
} from './graph/extract';
export type {
  GraphData,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
  GraphRelation,
} from './graph/extract';
export { buildGraph, ensureGraphFresh } from './graph/indexer';
export { getGraphStatus } from './graph/freshness';
export {
  GRAPH_BRIDGE_WEIGHTS,
  GRAPH_DISTANCE_DECAY,
  expandSeeds,
  explainGraphPath,
  explainPath,
  graphRelatedToFile,
  graphRelatedToIds,
  graphStats,
  scoreGraphCandidate,
} from './graph/query';
export type {
  BridgeKind,
  ExpandOptions,
  ExplainHop,
  ExplainResult,
  GraphBridge,
  GraphCandidate,
  GraphRelatedOptions,
  GraphRelatedResult,
  GraphStats,
} from './graph/query';
export { hybridSearch } from './graph/hybrid';
export type { HybridOrigin, HybridRanked, HybridResult, HybridSearchOptions } from './graph/hybrid';
export { estimateTokens, renderGraphContext } from './graph/render';
export type { GraphContextResult, GraphContextSource } from './graph/render';
