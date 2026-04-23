// TimeManager — in-game time arithmetic, period resolution, and formatting.
//
// Game starts at AD 1498-06-12 21:23.
// All player actions advance time; special actions (rest, combat) advance more.
// Time periods (work/rest/special) are defined per region in schedule.json.

import type { GameTime } from '../types/game';
import type { RegionSchedule, TimePeriod } from '../types/world';
import type { ActionType } from '../types/game';

/** Minutes each action type costs in-game. */
export const ACTION_MINUTES: Record<ActionType, number> = {
  free:               10,
  move:               5,
  interact:           15,
  use:                10,
  'examine':          10,
  'check-inv':        10,
  'inspect':          5,
  rest:               60,   // special — significant time cost
  combat:             30,   // special — significant time cost
};

/** Days in each month (non-leap; index 0 unused). */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export class TimeManager {
  /** Advance time by the cost of a given action type. */
  advanceByAction(time: GameTime, actionType: ActionType): GameTime {
    return this.advance(time, ACTION_MINUTES[actionType] ?? 10);
  }

  /** Advance time by N minutes, rolling over hours/days/months/years. */
  advance(time: GameTime, minutes: number): GameTime {
    const totalMinutes = time.totalMinutes + minutes;

    let { year, month, day } = time;
    let hour   = time.hour;
    let minute = time.minute + minutes;

    hour   += Math.floor(minute / 60);
    minute  = minute % 60;
    day    += Math.floor(hour / 24);
    hour    = hour % 24;

    // Month rollover
    while (day > DAYS_IN_MONTH[month]) {
      day  -= DAYS_IN_MONTH[month];
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }

    return { year, month, day, hour, minute, totalMinutes };
  }

  /**
   * Resolve the current time period for a given region schedule.
   * Returns 'special' if the specialPeriodFlag is in the active flags set.
   * Returns the first matching period definition, or 'rest' as fallback.
   */
  getCurrentPeriod(time: GameTime, schedule: RegionSchedule, activeFlags?: Set<string>): TimePeriod {
    if (schedule.specialPeriodFlag && activeFlags?.has(schedule.specialPeriodFlag)) {
      return 'special';
    }

    const nowMinutes = time.hour * 60 + time.minute;

    for (const period of schedule.periods) {
      const start = period.startHour * 60 + period.startMinute;
      const end   = period.endHour   * 60 + period.endMinute;

      if (start < end) {
        // Intra-day range (e.g., 06:00–18:00)
        if (nowMinutes >= start && nowMinutes < end) return period.id;
      } else {
        // Overnight range (e.g., 18:00–06:00 next day)
        if (nowMinutes >= start || nowMinutes < end) return period.id;
      }
    }

    return 'rest';
  }

  /**
   * Jump time forward to a specific hour:minute on the same or next day.
   * Always moves forward (never backward).
   */
  jumpToHour(time: GameTime, targetHour: number, targetMinute = 0): GameTime {
    let minutesToAdd = (targetHour * 60 + targetMinute) - (time.hour * 60 + time.minute);
    if (minutesToAdd <= 0) minutesToAdd += 24 * 60;  // push to next day
    return this.advance(time, minutesToAdd);
  }

  /**
   * Jump to the start of the next period in the schedule.
   * Useful for "skip to work shift" or "skip to rest" mechanics.
   */
  jumpToNextPeriodStart(time: GameTime, schedule: RegionSchedule): GameTime {
    const currentPeriod = this.getCurrentPeriod(time, schedule);
    const currentIdx    = schedule.periods.findIndex(p => p.id === currentPeriod);
    const nextPeriod    = schedule.periods[(currentIdx + 1) % schedule.periods.length];
    return this.jumpToHour(time, nextPeriod.startHour, nextPeriod.startMinute);
  }

  /**
   * Return the list of hour boundaries (0–23) crossed when advancing from
   * `from` to `to`. Handles midnight wrap-around and multi-hour jumps.
   * Example: 5:55 → 6:05 returns [6]. 23:50 → 00:10 returns [0].
   * Returns all 24 hours when the advance spans a full day or more.
   */
  computeCrossedHours(from: GameTime, to: GameTime): number[] {
    const minutesDiff = to.totalMinutes - from.totalMinutes;
    if (minutesDiff <= 0) return [];
    if (minutesDiff >= 1440) return Array.from({ length: 24 }, (_, i) => i);

    const crossed: number[] = [];
    const fromMins = from.hour * 60 + from.minute;
    for (let h = 0; h < 24; h++) {
      // Offset from current position to h:00, always positive (i.e., in the future)
      let offset = h * 60 - fromMins;
      if (offset <= 0) offset += 1440;
      if (offset <= minutesDiff) crossed.push(h);
    }
    return crossed;
  }

  /** Format: "AD 1498-06-12 21:23" */
  formatTime(time: GameTime): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `AD ${time.year}-${pad(time.month)}-${pad(time.day)} ${pad(time.hour)}:${pad(time.minute)}`;
  }

  formatPeriod(period: TimePeriod): string {
    const labels: Record<TimePeriod, string> = {
      work:    '作業時段',
      rest:    '休息時段',
      special: '特殊時段',
    };
    return labels[period];
  }
}
