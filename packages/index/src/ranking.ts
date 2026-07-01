import type { FootprintStatus, WorkType } from '@substrata/core';

/**
 * Ranking helpers. See plan §11 ("Ranking (MVP)").
 *
 * All helpers are pure so they can be unit-tested in isolation. `score` applies
 * the full pipeline: BM25 → normalize → multiplicative boosts → status penalty.
 */

/** Days over which the recency boost decays linearly from 1 to 0. */
export const RECENCY_DECAY_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Maximum fractional recency boost (plan: × (1 + 0.15 * decay)). */
export const RECENCY_BOOST_WEIGHT = 0.15;

/** Multiplier when the doc's files overlap the queried files. */
export const FILES_OVERLAP_BOOST = 1.5;

/** Multiplicative status penalties (plan §11 step 4). */
export const STATUS_PENALTIES: Record<FootprintStatus, number> = {
  draft: 0.5,
  completed: 1,
  superseded: 0.15,
  deprecated: 0.1,
};

/**
 * better-sqlite3's fts5 `bm25()` returns a score where *more negative is more
 * relevant*. Normalize to a positive relevance value so boosts/penalties read
 * naturally (higher = better).
 */
export function normalizeBm25(bm25: number): number {
  return -bm25;
}

/**
 * Linear recency decay in [0, 1]: 1 for "now", decaying to 0 at
 * RECENCY_DECAY_DAYS old and clamped at 0 beyond that. A missing/invalid date
 * yields 0 (no recency contribution).
 */
export function recencyDecay(timestamp: string | undefined, now: number = Date.now()): number {
  if (!timestamp) return 0;
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return 0;
  const ageDays = (now - t) / MS_PER_DAY;
  if (ageDays <= 0) return 1;
  if (ageDays >= RECENCY_DECAY_DAYS) return 0;
  return 1 - ageDays / RECENCY_DECAY_DAYS;
}

/**
 * Recency boost multiplier: × (1 + weight * decay). For
 * `architecture_decision`, the boost contribution is halved so durable
 * decisions are not demoted merely for being old.
 */
export function recencyBoost(
  timestamp: string | undefined,
  workType: WorkType | null | undefined,
  now: number = Date.now(),
): number {
  let contribution = RECENCY_BOOST_WEIGHT * recencyDecay(timestamp, now);
  if (workType === 'architecture_decision') {
    contribution /= 2;
  }
  return 1 + contribution;
}

/** True when any of the doc's files matches any queried file (case-insensitive). */
export function filesOverlap(docFiles: string[], queryFiles: string[]): boolean {
  if (queryFiles.length === 0 || docFiles.length === 0) return false;
  const want = new Set(queryFiles.map((f) => f.toLowerCase()));
  return docFiles.some((f) => want.has(f.toLowerCase()));
}

/** Multiplicative status penalty; unknown/undefined status is treated as neutral. */
export function statusPenalty(status: FootprintStatus | null | undefined): number {
  if (!status) return 1;
  return STATUS_PENALTIES[status] ?? 1;
}

export type RankInput = {
  bm25: number;
  status?: FootprintStatus | null;
  workType?: WorkType | null;
  /** updated_at ?? created_at, used for recency. */
  updatedAt?: string | null;
  createdAt?: string | null;
  docFiles: string[];
  queryFiles: string[];
};

/**
 * Full ranking score: normalized BM25 with multiplicative file-overlap,
 * recency, and status modifiers applied per plan §11.
 */
export function score(input: RankInput, now: number = Date.now()): number {
  let s = normalizeBm25(input.bm25);

  if (filesOverlap(input.docFiles, input.queryFiles)) {
    s *= FILES_OVERLAP_BOOST;
  }

  const recencyTimestamp = input.updatedAt ?? input.createdAt ?? undefined;
  s *= recencyBoost(recencyTimestamp, input.workType ?? null, now);

  s *= statusPenalty(input.status ?? null);

  return s;
}
