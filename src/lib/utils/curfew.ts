// 門禁（宵禁）計算 — 純函式，供 StateManager（旗標同步）、EventEngine（覆寫設定）
// 與 GameController（DM 時間資訊）共用，確保所有門禁判斷都讀同一個來源。
//
// 來源優先序：GameState.curfewOverride（未過期）> RegionSchedule.curfew 預設值。

import type { CurfewConfig } from '../types/world';
import type { CurfewOverride } from '../types/game';

const DAY = 1440;

export interface CurfewWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  /** true = 使用中的是臨時覆寫（例如廣播提前門禁） */
  overridden: boolean;
}

/** 覆寫是否仍有效 */
export function isOverrideActive(override: CurfewOverride | undefined, nowTotalMinutes: number): boolean {
  return !!override && nowTotalMinutes < override.expiresAtTotalMinutes;
}

/** 取得目前有效的門禁時間窗；cfg 未定義回傳 null（此區域無門禁）。 */
export function getEffectiveCurfew(
  cfg: CurfewConfig | undefined,
  override: CurfewOverride | undefined,
  nowTotalMinutes: number,
): CurfewWindow | null {
  if (!cfg) return null;
  const useOverride = isOverrideActive(override, nowTotalMinutes);
  return {
    startHour:   useOverride ? override!.startHour   : cfg.startHour,
    startMinute: useOverride ? override!.startMinute : cfg.startMinute,
    endHour:     cfg.endHour,
    endMinute:   cfg.endMinute,
    overridden:  useOverride,
  };
}

/** 時刻是否落在門禁時間窗內（[start, end)，支援跨午夜）。 */
export function isInCurfewWindow(window: CurfewWindow, time: { hour: number; minute: number }): boolean {
  const now   = time.hour * 60 + time.minute;
  const start = window.startHour * 60 + window.startMinute;
  const end   = window.endHour * 60 + window.endMinute;
  if (start === end) return false;
  return start < end ? (now >= start && now < end) : (now >= start || now < end);
}

/** 目前是否處於門禁中 */
export function isCurfewActive(
  cfg: CurfewConfig | undefined,
  override: CurfewOverride | undefined,
  time: { hour: number; minute: number; totalMinutes: number },
): boolean {
  const w = getEffectiveCurfew(cfg, override, time.totalMinutes);
  return !!w && isInCurfewWindow(w, time);
}

/**
 * 計算「當晚」門禁覆寫的失效時刻（totalMinutes）= 下一次門禁結束時刻。
 * 若現在處於凌晨（00:00 至門禁結束之間，屬於前一晚的門禁），「本日」指的是即將到來的這一晚，
 * 因此往後延一天，避免覆寫在幾分鐘內就失效。
 */
export function computeOverrideExpiry(
  cfg: CurfewConfig,
  time: { hour: number; minute: number; totalMinutes: number },
): number {
  const now = time.hour * 60 + time.minute;
  const end = cfg.endHour * 60 + cfg.endMinute;
  let diff = (end - now + DAY) % DAY;
  if (diff === 0) diff = DAY;
  const preDawn = now < end;
  return time.totalMinutes + diff + (preDawn ? DAY : 0);
}

/** 從候選時刻中隨機挑一個，建立覆寫；options 為空回傳 null。 */
export function rollCurfewOverride(
  cfg: CurfewConfig,
  options: { hour: number; minute: number }[],
  time: { hour: number; minute: number; totalMinutes: number },
  random: () => number = Math.random,
): CurfewOverride | null {
  if (!options.length) return null;
  const pick = options[Math.min(options.length - 1, Math.floor(random() * options.length))];
  return {
    startHour:   pick.hour,
    startMinute: pick.minute,
    expiresAtTotalMinutes: computeOverrideExpiry(cfg, time),
  };
}

export function formatClock(hour: number, minute: number): string {
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

/** 敘述插值：把 {curfewStart} 替換成實際門禁開始時刻（HH:MM）。 */
export function interpolateCurfew(text: string, window: CurfewWindow | null): string {
  if (!window || !text.includes('{curfewStart}')) return text;
  return text.split('{curfewStart}').join(formatClock(window.startHour, window.startMinute));
}
