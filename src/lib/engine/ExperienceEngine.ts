// ── ExperienceEngine ──────────────────────────────────────────────────────
// Pure functions for skill XP calculation, inclination, and level-up resolution.
// No side effects — all state mutations are done in StateManager.

import type { PrimaryStatKey, InclinationTracker, DailyGrantTracker } from '../types/player';

// ── XP Thresholds ─────────────────────────────────────────────────────────

/**
 * XP cost to advance from level n to n+1.
 * Key = current level (1–19). Level 20 is the maximum.
 *
 * Tier boundaries (significant cost jumps):
 *   外行人     1–5    → 有所見識  5→6   jump ×2.5
 *   有所見識   6–8    → 相當理解  8→9   jump ×2.1
 *   相當理解   9–11   → 已掌握   11→12  jump ×1.9
 *   已掌握    12–15   → 精熟    15→16   jump ×1.7
 *   精熟      16–19   → 近乎完美 19→20  jump ×2.3
 */
const SKILL_XP_THRESHOLDS: Readonly<Record<number, number>> = {
  1:  30,
  2:  38,
  3:  47,
  4:  59,
  5:  150,   // ★ 跨階：外行人 → 有所見識
  6:  188,
  7:  235,
  8:  500,   // ★ 跨階：有所見識 → 相當理解
  9:  625,
  10: 781,
  11: 1500,  // ★ 跨階：相當理解 → 已掌握
  12: 1875,
  13: 2344,
  14: 2930,
  15: 5000,  // ★ 跨階：已掌握 → 精熟
  16: 6000,
  17: 7200,
  18: 8640,
  19: 20000, // ★ 跨階：精熟 → 近乎完美（傳奇等級）
} as const;

export const STAT_MAX_LEVEL = 20;

/** 取得從 currentLevel 升到下一點所需的 XP。若已達上限回傳 Infinity。 */
export function getRequiredExpForLevel(currentLevel: number): number {
  if (currentLevel >= STAT_MAX_LEVEL) return Infinity;
  return SKILL_XP_THRESHOLDS[currentLevel] ?? Infinity;
}

// ── Character Experience Tiers ────────────────────────────────────────────

interface CharExpTier {
  minExp: number;
  flatBonus: number;  // 每次獲得技能 XP 時額外加的固定量
  multiplier: number; // 套用在 (base + flat) 上的倍率
  dailyCap: number;   // 每日 GRANT 上限
}

/**
 * 角色經驗（全局）分五個梯度。
 * 倍率設計與 docs/hidden/status_values.md 對齊：
 *   0–99:    無加成
 *   100–499: +10%
 *   500–999: +20%
 *   1000–1999: +30%
 *   2000+:   +50%
 */
const CHAR_EXP_TIERS: ReadonlyArray<CharExpTier> = [
  { minExp: 0,    flatBonus: 0,  multiplier: 1.0, dailyCap: 50  },
  { minExp: 100,  flatBonus: 2,  multiplier: 1.1, dailyCap: 80  },
  { minExp: 500,  flatBonus: 5,  multiplier: 1.2, dailyCap: 120 },
  { minExp: 1000, flatBonus: 8,  multiplier: 1.3, dailyCap: 180 },
  { minExp: 2000, flatBonus: 12, multiplier: 1.5, dailyCap: 250 },
];

function getCharExpTier(charExp: number): CharExpTier {
  let tier = CHAR_EXP_TIERS[0];
  for (const t of CHAR_EXP_TIERS) {
    if (charExp >= t.minExp) tier = t;
  }
  return tier;
}

export function getCharExpBonuses(charExp: number): {
  flatBonus: number;
  multiplier: number;
  dailyCap: number;
} {
  const { flatBonus, multiplier, dailyCap } = getCharExpTier(charExp);
  return { flatBonus, multiplier, dailyCap };
}

// ── Inclination ───────────────────────────────────────────────────────────

const PRIMARY_INCLINATION_MULT   = 1.15;
const SECONDARY_INCLINATION_MULT = 1.07;

/**
 * 依 InclinationTracker 計算主傾向與副傾向。
 * 次數最高 = 主，第二高 = 副。
 * 只有次數 > 0 的技能才算傾向（防止全 0 的初始狀態誤判）。
 */
export function computeInclination(tracker: InclinationTracker): {
  primary: PrimaryStatKey | null;
  secondary: PrimaryStatKey | null;
} {
  const entries = (Object.entries(tracker) as [PrimaryStatKey, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return {
    primary:   entries[0]?.[0] ?? null,
    secondary: entries[1]?.[0] ?? null,
  };
}

export function getInclinationMultiplier(
  statKey: PrimaryStatKey,
  primary: PrimaryStatKey | null,
  secondary: PrimaryStatKey | null,
): number {
  if (statKey === primary)   return PRIMARY_INCLINATION_MULT;
  if (statKey === secondary) return SECONDARY_INCLINATION_MULT;
  return 1.0;
}

// ── Final XP Calculation ──────────────────────────────────────────────────

/**
 * 計算最終發放給指定技能的 XP。
 * finalXP = (baseAmount + flatBonus) × charMultiplier × inclinationMultiplier
 * 結果四捨五入為整數，最小為 1（只要 baseAmount > 0）。
 */
export function computeFinalSkillXP(
  baseAmount: number,
  charExp: number,
  statKey: PrimaryStatKey,
  tracker: InclinationTracker,
): number {
  if (baseAmount <= 0) return 0;
  const { flatBonus, multiplier } = getCharExpBonuses(charExp);
  const { primary, secondary } = computeInclination(tracker);
  const inclinationMult = getInclinationMultiplier(statKey, primary, secondary);
  return Math.max(1, Math.round((baseAmount + flatBonus) * multiplier * inclinationMult));
}

// ── Level-up Resolution ───────────────────────────────────────────────────

/**
 * 給定技能的當前等級與累積 XP，解算所有可能的升級。
 * 超出門檻的 XP carry over 到下一點（不重置）。
 */
export function resolveLevelUps(
  currentLevel: number,
  currentExp: number,
): { newLevel: number; newExp: number; levelUps: number } {
  let level   = currentLevel;
  let exp     = currentExp;
  let levelUps = 0;

  while (level < STAT_MAX_LEVEL) {
    const required = getRequiredExpForLevel(level);
    if (exp < required) break;
    exp -= required;
    level++;
    levelUps++;
  }

  return { newLevel: level, newExp: exp, levelUps };
}

// ── Daily Grant Cap ───────────────────────────────────────────────────────

/**
 * 計算 GRANT 來源在每日上限下，本次最多能實際發放多少 XP（已計算加成後的量）。
 * 回傳值 <= requestedFinalAmount。
 */
export function clampGrantExp(
  requestedFinalAmount: number,
  statKey: PrimaryStatKey,
  charExp: number,
  tracker: DailyGrantTracker,
): number {
  const { dailyCap } = getCharExpBonuses(charExp);
  const alreadyGranted = tracker.grantedExp[statKey] ?? 0;
  const remaining = Math.max(0, dailyCap - alreadyGranted);
  return Math.min(requestedFinalAmount, remaining);
}

/** 產生每日 GRANT 追蹤用的日期 key */
export function makeDateKey(year: number, month: number, day: number): string {
  return `${year}-${month}-${day}`;
}
