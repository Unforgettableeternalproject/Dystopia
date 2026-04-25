// RestResolver — deterministic rest result calculator.
//
// 設計原則：
//   - DM 不決定休息結果，只負責敘述已確定的結果
//   - 結果由玩家數值（體力、壓力、疲勞）與休息情境（full/scuffed）共同決定
//   - 計算帶有可控的隨機性（±noise），但品質分級是確定性的
//
// 偏移傾向：
//   - stress 高 → 難以入睡，傾向睡不夠（負偏移）
//   - stamina 低 → 過度疲勞，傾向睡過頭（正偏移）
//
// 品質分級：
//   - |偏移| <= 60 min → 成功休息
//   - 60 < |偏移| <= 180 min → 不完整休息
//   - |偏移| > 180 min → 喪失時間觀
//
// 不完整休息點 (scuffed)：
//   - 僅提供短/中/長三檔（30/60/120 min）
//   - 噪音 ±10 分鐘，最少 5 分鐘
//   - 不降壓力，僅少量回復體力
//
// 疲勞 (fatigue) 影響：
//   - 完整休息：一定將疲勞降至 ≤2
//   - 若實際睡眠 >8 小時且品質差（不完整/喪失時間觀），疲勞反而 +1

import type { RestContext } from '../types/prop';

// ── Types ─────────────────────────────────────────────────────

export type RestQuality = 'full' | 'partial' | 'disoriented';

export const QUALITY_LABEL: Record<RestQuality, string> = {
  full:        '成功休息',
  partial:     '不完整休息',
  disoriented: '喪失時間觀',
};

export interface RestInput {
  /** 玩家預計休息分鐘數 */
  plannedMinutes: number;
  /** 休息情境（full_available / scuffed） */
  restCtx: RestContext;
  /** 目前體力值 */
  stamina: number;
  /** 體力上限 */
  staminaMax: number;
  /** 目前壓力值 */
  stress: number;
  /** 壓力上限 */
  stressMax: number;
  /** 目前疲勞值（0–5），省略時視為 0 */
  fatigue?: number;
  /** 預留：未來身體狀態 conditions 影響 */
  conditions?: string[];
}

export interface RestResult {
  /** 實際休息分鐘數（已套用 scuffed cap） */
  actualMinutes: number;
  /** 偏移分鐘數（正 = 睡過頭，負 = 睡不夠） */
  deviationMinutes: number;
  /** 品質分級 */
  quality: RestQuality;
  /** 體力變化（正值） */
  staminaDelta: number;
  /** 壓力變化（負值代表減輕壓力；scuffed 模式固定為 0） */
  stressDelta: number;
  /** 疲勞變化（負值代表降低疲勞；僅完整休息有效） */
  fatigueDelta: number;
  /** 語意標記，供 DM 敘述與 UI 顯示 */
  resultTags: string[];
}

// ── RestResolver ──────────────────────────────────────────────

export class RestResolver {
  /** 完整休息的偏移噪音（分鐘） */
  private static readonly FULL_NOISE_RANGE  = 30;
  /** 不完整休息的偏移噪音（分鐘），更小但更穩定 */
  private static readonly SCUFFED_NOISE_RANGE = 10;
  /** 任何模式下的實際休息最短時間（分鐘） */
  private static readonly MIN_ACTUAL_MINUTES = 5;

  /**
   * 計算休息結果。純函式，不修改任何狀態。
   */
  static resolve(input: RestInput): RestResult {
    const { plannedMinutes, restCtx, stamina, staminaMax, stress, stressMax } = input;
    const fatigue   = input.fatigue ?? 0;
    const isScuffed = restCtx.mode === 'scuffed';
    const noiseRange = isScuffed ? RestResolver.SCUFFED_NOISE_RANGE : RestResolver.FULL_NOISE_RANGE;

    // ── 1. 計算偏移傾向 ──────────────────────────────────────
    const stressRatio         = stressMax > 0 ? Math.min(stress / stressMax, 1) : 0;
    const staminaDeficitRatio = staminaMax > 0 ? Math.max(1 - stamina / staminaMax, 0) : 0;

    // Stress → 睡不夠（負偏移最多 -180 分）；低體力 → 睡過頭（正偏移最多 +180 分）
    const biasMins = staminaDeficitRatio * 180 - stressRatio * 180;
    const noise    = (Math.random() * 2 - 1) * noiseRange;
    let deviationMinutes = Math.round(biasMins + noise);

    // ── 2. 計算實際時長 ──────────────────────────────────────
    let actualMinutes = plannedMinutes + deviationMinutes;

    if (isScuffed) {
      // Scuffed cap
      const cap = restCtx.maxTimeMinutes;
      if (actualMinutes > cap) {
        actualMinutes    = cap;
        deviationMinutes = cap - plannedMinutes;
      }
    }

    // 任何模式：最少 MIN_ACTUAL_MINUTES
    if (actualMinutes < RestResolver.MIN_ACTUAL_MINUTES) {
      actualMinutes    = RestResolver.MIN_ACTUAL_MINUTES;
      deviationMinutes = RestResolver.MIN_ACTUAL_MINUTES - plannedMinutes;
    }

    // ── 3. 品質分級 ───────────────────────────────────────────
    const absDeviation = Math.abs(deviationMinutes);
    const rawQuality: RestQuality =
      absDeviation <= 60  ? 'full' :
      absDeviation <= 180 ? 'partial' :
                            'disoriented';
    // Scuffed 環境不可能達成「成功休息」—— 不完整休息為上限
    const quality: RestQuality = (isScuffed && rawQuality === 'full') ? 'partial' : rawQuality;

    // ── 4. 回復量計算 ─────────────────────────────────────────
    const baseRecoveryRatio = Math.min(actualMinutes / 480, 1);

    const qualityScale =
      quality === 'full'    ? 1.0 :
      quality === 'partial' ? 0.5 : 0.25;

    const contextScale = restCtx.statusEffectScale;
    const effectScale  = qualityScale * contextScale;

    const staminaDelta = Math.round(
      Math.min(baseRecoveryRatio * staminaMax * effectScale, staminaMax - stamina)
    );

    // Scuffed 不降壓力；完整休息依品質與時長計算
    const stressDelta = isScuffed ? 0 : -Math.round(
      Math.min(baseRecoveryRatio * stressMax * effectScale * 0.6, stress)
    );

    // ── 5. 疲勞計算（僅完整休息） ─────────────────────────────
    let fatigueDelta = 0;
    if (!isScuffed) {
      // 睡眠一定將疲勞降至 ≤2
      const postSleepFatigue = Math.min(fatigue, 2);
      fatigueDelta = postSleepFatigue - fatigue; // 通常為負值

      // 長時間睡眠（>8h）但品質差 → 疲勞 +1
      if (actualMinutes > 480 && (quality === 'partial' || quality === 'disoriented')) {
        const adjusted = Math.min(5, postSleepFatigue + 1);
        fatigueDelta = adjusted - fatigue;
      }
    }

    // ── 6. 語意標記 ───────────────────────────────────────────
    const resultTags: string[] = [quality];

    if (isScuffed)              resultTags.push('scuffed');
    if (deviationMinutes > 60)  resultTags.push('oversleep');
    if (deviationMinutes < -60) resultTags.push('undersleep');
    if (stressRatio > 0.7)      resultTags.push('high_stress');
    if (staminaDeficitRatio > 0.7) resultTags.push('low_stamina');

    return {
      actualMinutes,
      deviationMinutes,
      quality,
      staminaDelta,
      stressDelta,
      fatigueDelta,
      resultTags,
    };
  }
}
