// restDurationParser — 從玩家輸入抽取休息時長，供休息 Modal 預填。
//
// 支援：
//   - 時長：「五個小時」「睡 3 小時」「一個半小時」「兩小時半」「休息半小時」「40 分鐘」「一小時二十分鐘」
//   - 時刻：「睡到早上六點」「睡到 6 點半」「休息到下午三點十五分」（以遊戲當前時間換算）
// 數字支援阿拉伯數字與中文數字（零～九十九、兩）。
// 解析不到或不合理（≤ 0、> 24 小時）時回傳 null，呼叫端保留預設值。

const NUM = '(?:\\d+(?:\\.\\d+)?|[零〇一二兩三四五六七八九十]+)';

const DIGITS: Record<string, number> = {
  '零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};

/** 中文數字（0–99）或阿拉伯數字轉為數值；無法解析回傳 null。 */
export function parseNumberToken(token: string): number | null {
  const t = token.trim();
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  if (!/^[零〇一二兩三四五六七八九十]+$/.test(t)) return null;
  const tenIdx = t.indexOf('十');
  if (tenIdx === -1) {
    // 單一位數（不處理「一二」這類串接）
    return t.length === 1 ? DIGITS[t] : null;
  }
  if (t.indexOf('十', tenIdx + 1) !== -1) return null;
  const tensPart = t.slice(0, tenIdx);
  const onesPart = t.slice(tenIdx + 1);
  if (tensPart.length > 1 || onesPart.length > 1) return null;
  const tens = tensPart === '' ? 1 : DIGITS[tensPart];
  const ones = onesPart === '' ? 0 : DIGITS[onesPart];
  if (tens === undefined || ones === undefined) return null;
  return tens * 10 + ones;
}

const MAX_MINUTES = 24 * 60;

function sane(minutes: number): number | null {
  if (!Number.isFinite(minutes)) return null;
  const m = Math.round(minutes);
  return m > 0 && m <= MAX_MINUTES ? m : null;
}

/**
 * 「睡到 X 點」→ 距離目標時刻的分鐘數。
 * 回傳 undefined 表示輸入中沒有時刻描述；null 表示有但無效。
 */
function parseUntilClock(input: string, now: { hour: number; minute: number }): number | null | undefined {
  const re = new RegExp(
    '到\\s*(早上|上午|清晨|凌晨|中午|下午|傍晚|晚上|夜裡|半夜)?\\s*(' + NUM + ')\\s*(?:點|時)(?:\\s*(半|(' + NUM + ')\\s*分?))?',
  );
  const m = input.match(re);
  if (!m) return undefined;
  const period = m[1];
  const rawHour = parseNumberToken(m[2]);
  if (rawHour === null || !Number.isInteger(rawHour) || rawHour > 24) return null;
  let minute = 0;
  if (m[3] === '半') minute = 30;
  else if (m[4]) {
    const mm = parseNumberToken(m[4]);
    if (mm === null || !Number.isInteger(mm) || mm >= 60) return null;
    minute = mm;
  }

  const nowMin = now.hour * 60 + now.minute;
  const diffTo = (h: number) => {
    let d = ((h % 24) * 60 + minute - nowMin) % 1440;
    if (d <= 0) d += 1440;
    return d;
  };

  let hour = rawHour;
  if (period) {
    if (['下午', '傍晚', '晚上'].includes(period) && hour < 12) hour += 12;
    else if (period === '中午' && hour >= 1 && hour <= 2) hour += 12;
    else if (['早上', '上午', '清晨', '凌晨', '半夜'].includes(period) && hour === 12) hour = 0;
    else if (period === '夜裡' && hour >= 6 && hour < 12) hour += 12;
    return sane(diffTo(hour));
  }

  // 未指定時段：12 小時制下取最近的未來時刻
  if (hour < 12) return sane(Math.min(diffTo(hour), diffTo(hour + 12)));
  return sane(diffTo(hour));
}

/** 「N 小時」「N 分鐘」「半小時」等時長描述 → 分鐘數。 */
function parseDuration(input: string): number | null {
  let total = 0;
  let found = false;
  let rest = input;

  const hourRe = new RegExp('(' + NUM + ')\\s*(個)?\\s*(半)?\\s*(?:小時|鐘頭)(半)?');
  const hm = rest.match(hourRe);
  if (hm) {
    const h = parseNumberToken(hm[1]);
    if (h === null) return null;
    total += h * 60 + (hm[3] || hm[4] ? 30 : 0);
    found = true;
    rest = rest.slice(0, hm.index) + ' ' + rest.slice((hm.index ?? 0) + hm[0].length);
  } else {
    const halfRe = /半\s*個?\s*(?:小時|鐘頭)/;
    const half = rest.match(halfRe);
    if (half) {
      total += 30;
      found = true;
      rest = rest.slice(0, half.index) + ' ' + rest.slice((half.index ?? 0) + half[0].length);
    }
  }

  const minRe = new RegExp('(' + NUM + ')\\s*(?:分鐘|分(?![之鐘]))');
  const mm = rest.match(minRe);
  if (mm) {
    const m = parseNumberToken(mm[1]);
    if (m === null) return null;
    total += m;
    found = true;
  }

  return found ? sane(total) : null;
}

/**
 * 從玩家輸入抽取預計休息分鐘數。
 * @param now 遊戲當前時刻，用於「睡到 X 點」換算；省略時不解析時刻型描述。
 */
export function parseRestDurationMinutes(
  input: string,
  now?: { hour: number; minute: number },
): number | null {
  if (!input) return null;
  if (now) {
    const until = parseUntilClock(input, now);
    // 有明確時刻描述時，無論有效與否都不再以時長解析
    if (until !== undefined) return until;
  }
  return parseDuration(input);
}

/** 休息 Modal 的時長限制（與 RestModal.svelte 保持一致）。 */
export const REST_UI_LIMITS = {
  fullMinMinutes:  10,
  fullMaxMinutes:  12 * 60,
  fullStepMinutes: 10,
  scuffedOptions:  [30, 60, 120] as const,
};

/**
 * 將解析出的分鐘數轉為 Modal 可直接採用的預填值；超出 UI 範圍時回傳 null（保留預設）。
 * - 完整休息：四捨五入到 10 分鐘刻度，需介於 10 分鐘～12 小時。
 * - 短眠：需剛好等於固定選項之一，且不超過 scuffedMaxMinutes。
 */
export function resolveRestPreset(
  minutes: number | null,
  opts: { canFullRest: boolean; scuffedMaxMinutes: number },
): number | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (opts.canFullRest) {
    const step = REST_UI_LIMITS.fullStepMinutes;
    const rounded = Math.round(minutes / step) * step;
    if (rounded < REST_UI_LIMITS.fullMinMinutes || rounded > REST_UI_LIMITS.fullMaxMinutes) return null;
    return rounded;
  }
  const opt = REST_UI_LIMITS.scuffedOptions.find(o => o === minutes);
  if (opt === undefined || opt > opts.scuffedMaxMinutes) return null;
  return opt;
}
