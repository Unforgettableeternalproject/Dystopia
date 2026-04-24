// Shared evaluation logic for GameDateTimeCondition and GameTimeRange.
// Used by EventEngine, DialogueManager, EncounterEngine, and LoreVault.

import type { GameDateTimeCondition, GameDatePoint, GameTimeRange } from '../types';

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

/**
 * Returns true if the current time falls within any of the given ranges (OR).
 * Supports overnight wrap (e.g. 22:00–06:00).
 * An empty or undefined array always returns true.
 */
export function checkTimeRanges(
  ranges: GameTimeRange[] | undefined,
  time: { hour: number; minute: number } | undefined,
): boolean {
  if (!ranges?.length) return true;
  if (!time) return false;
  const cur = time.hour * 60 + time.minute;
  return ranges.some(r => {
    const start = r.startHour * 60 + r.startMinute;
    const end   = r.endHour   * 60 + r.endMinute;
    return start <= end
      ? cur >= start && cur <= end   // same-day range: 06:00–18:00
      : cur >= start || cur <= end;  // overnight range: 22:00–06:00
  });
}
