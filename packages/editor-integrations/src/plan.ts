import type { ChangeResult } from '@substrata/core';

/**
 * Aggregate ChangeResults into a printable setup plan. Pure (no I/O).
 */

const ACTION_LABEL: Record<ChangeResult['action'], string> = {
  create: 'CREATE',
  update: 'UPDATE',
  skip: 'SKIP  ',
};

/** Render a list of changes as aligned, human-readable plan lines. */
export function renderPlan(changes: ChangeResult[]): string {
  if (changes.length === 0) return 'No changes.';
  return changes
    .map((c) => `${ACTION_LABEL[c.action]}  ${c.path}${c.description ? ` — ${c.description}` : ''}`)
    .join('\n');
}

/** True if any change actually writes (create/update). */
export function hasEffectiveChanges(changes: ChangeResult[]): boolean {
  return changes.some((c) => c.action !== 'skip');
}

/** Summary counts by action, e.g. for a plan footer. */
export function summarizePlan(changes: ChangeResult[]): {
  create: number;
  update: number;
  skip: number;
} {
  const summary = { create: 0, update: 0, skip: 0 };
  for (const c of changes) summary[c.action] += 1;
  return summary;
}
