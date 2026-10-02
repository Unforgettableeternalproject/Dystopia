// timeContext — 為 LLM 組出時間資訊（時刻表、門禁、接下來的時間點）。
// 只使用區域時間表與門禁設定這類公開的時刻資料，不列舉事件，避免洩漏隱藏事件。

import type { GameTime } from '../types/game';
import type { RegionSchedule } from '../types/world';
import { formatClock, isInCurfewWindow, type CurfewWindow } from './curfew';

/** 等待／行動時長上限（分鐘），與 DM/Judge 的 timeMinutes 夾限一致 */
export const MAX_ACTION_MINUTES = 12 * 60;

export interface TimeContextInput {
  time: GameTime;
  schedule?: RegionSchedule | null;
  /** 目前有效的門禁時間窗（含當晚覆寫）；null = 無門禁 */
  curfew?: CurfewWindow | null;
  /** 預設門禁開始時刻（用於標示覆寫前的時間） */
  curfewDefaultStart?: { hour: number; minute: number };
}

interface TimePoint { minutesFromNow: number; clock: string; label: string }

/** 距離下一次 hh:mm 的分鐘數（> 0；剛好等於現在時視為 24 小時後）。 */
function minutesUntil(now: { hour: number; minute: number }, hour: number, minute: number): number {
  let d = (hour * 60 + minute) - (now.hour * 60 + now.minute);
  if (d <= 0) d += 1440;
  return d;
}

/** 接下來 24 小時內的公開時間點（時段開始、門禁起訖），依先後排序。 */
export function upcomingTimePoints(input: TimeContextInput): TimePoint[] {
  const pts: TimePoint[] = [];
  for (const p of input.schedule?.periods ?? []) {
    pts.push({
      minutesFromNow: minutesUntil(input.time, p.startHour, p.startMinute),
      clock: formatClock(p.startHour, p.startMinute),
      label: p.label + '開始',
    });
  }
  if (input.curfew) {
    const c = input.curfew;
    // 門禁中不列下一次開始：當晚覆寫到明天可能已回到預設時間
    if (!isInCurfewWindow(c, input.time)) {
      pts.push({
        minutesFromNow: minutesUntil(input.time, c.startHour, c.startMinute),
        clock: formatClock(c.startHour, c.startMinute),
        label: '門禁開始',
      });
    }
    pts.push({
      minutesFromNow: minutesUntil(input.time, c.endHour, c.endMinute),
      clock: formatClock(c.endHour, c.endMinute),
      label: '門禁結束',
    });
  }
  return pts.sort((a, b) => a.minutesFromNow - b.minutesFromNow);
}

/** 門禁說明行；無門禁回傳 null。 */
export function curfewLine(input: TimeContextInput): string | null {
  const c = input.curfew;
  if (!c) return null;
  const range = formatClock(c.startHour, c.startMinute) + '–' + formatClock(c.endHour, c.endMinute);
  const def = input.curfewDefaultStart;
  const note = c.overridden && def
    ? `（今晚臨時調整，預設 ${formatClock(def.hour, def.minute)} 開始）`
    : '';
  const state = isInCurfewWindow(c, input.time) ? 'ACTIVE（門禁中：宿舍不能進出）' : 'inactive';
  return `Curfew (門禁): ${range}${note} | now: ${state}`;
}

/** 接下來時間點的說明行，例如「06:00 作業時段開始 (+120 min)」。 */
export function upcomingLine(input: TimeContextInput): string | null {
  const pts = upcomingTimePoints(input);
  if (!pts.length) return null;
  return 'Upcoming: ' + pts.map(p => `${p.clock} ${p.label} (+${p.minutesFromNow} min)`).join(' | ');
}

/** 時段表說明行，例如「作業時段 06:00–18:00 | 休息時段 18:00–06:00」。 */
export function scheduleLine(schedule?: RegionSchedule | null): string | null {
  if (!schedule?.periods.length) return null;
  return 'Schedule: ' + schedule.periods
    .map(p => `${p.label} ${formatClock(p.startHour, p.startMinute)}–${formatClock(p.endHour, p.endMinute)}`)
    .join(' | ');
}

/** 精簡的時間資訊區塊（目前時刻、時段表、門禁、接下來的時間點），供 Regulator 等非場景 prompt 使用。 */
export function buildClockBlock(input: TimeContextInput): string {
  return [
    'Time: ' + formatClock(input.time.hour, input.time.minute),
    scheduleLine(input.schedule),
    curfewLine(input),
    upcomingLine(input),
  ].filter(Boolean).join('\n');
}
