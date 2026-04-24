// Shared evaluation logic for GameDateTimeCondition.
// Used by EventEngine, DialogueManager, EncounterEngine, and LoreVault.

import type { GameDateTimeCondition, GameDatePoint } from '../types';

/** Converts a GameDatePoint (or any object with year/month/day/hour/minute) to a comparable integer. */
export function datepointToMinutes(p: GameDatePoint): number {
  return (p.year   ?? 0) * 527040
       + (p.month  ?? 0) * 44640
       + (p.day    ?? 0) * 1440
       + (p.hour   ?? 0) * 60
       + (p.minute ?? 0);
}

/**
 * Returns true if the given time satisfies the condition.
 * The time argument only needs year/month/day/hour/minute fields.
 */
export function checkDateTimeCondition(
  cond: GameDateTimeCondition,
  time: { year: number; month: number; day: number; hour: number; minute: number },
): boolean {
  const cur  = datepointToMinutes(time);
  const from = datepointToMinutes(cond.from);
  if (cond.relation === 'before') return cur < from;
  if (cond.relation === 'after')  return cur > from;
  if (cond.relation === 'between' && cond.to) {
    return cur >= from && cur <= datepointToMinutes(cond.to);
  }
  return false;
}

/**
 * Returns true if the given time satisfies ALL conditions in the array (AND).
 * An empty or undefined array always returns true.
 */
export function checkDateTimeConditions(
  conds: GameDateTimeCondition[] | undefined,
  time: { year: number; month: number; day: number; hour: number; minute: number } | undefined,
): boolean {
  if (!conds?.length) return true;
  if (!time) return false;
  return conds.some(c => checkDateTimeCondition(c, time));
}
