// RestResolver — deterministic rest result calculator.
//
// 設計原則：
//   - DM 不決定休息結果，只負責敘述已確定的結果
//   - 結果由玩家數值（體力、壓力）與休息情境（full/scuffed）共同決定
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

import type { RestContext } from '../types/prop';

// ── Types ─────────────────────────────────────────────────────

export type RestQuality = '成功休息' | '不完整休息' | '喪失時間觀';

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
  /** 壓力變化（負值代表減輕壓力） */
  stressDelta: number;
  /** 語意標記，供 DM 敘述與 UI 顯示 */
  resultTags: string[];
}

// ── RestResolver ──────────────────────────────────────────────

export class RestResolver {
  // 最大噪音（分鐘），加入可控的隨機性
  private static readonly NOISE_RANGE = 30;

  /**
   * 計算休息結果。純函式，不修改任何狀態。
   */
  static resolve(input: RestInput): RestResult {
    const { plannedMinutes, restCtx, stamina, staminaMax, stress, stressMax } = input;

    // ── 1. 計算偏移傾向 ──────────────────────────────────────
    // stress ratio: 0 = 無壓力, 1 = 壓力全滿
    const stressRatio  = stressMax > 0 ? Math.min(stress / stressMax, 1) : 0;
    // stamina deficit ratio: 0 = 體力全滿, 1 = 體力歸零
    const staminaDeficitRatio = staminaMax > 0 ? Math.max(1 - stamina / staminaMax, 0) : 0;

    // Stress → 睡不夠（負偏移最多 -180 分鐘）
    // 低體力 → 睡過頭（正偏移最多 +180 分鐘）
    const biasMins = staminaDeficitRatio * 180 - stressRatio * 180;

    // 加入 ±NOISE_RANGE 分鐘的隨機性
    const noise = (Math.random() * 2 - 1) * RestResolver.NOISE_RANGE;
    let deviationMinutes = Math.round(biasMins + noise);

    // ── 2. 計算實際時長 ──────────────────────────────────────
    let actualMinutes = plannedMinutes + deviationMinutes;

    // Scuffed 模式：實際時長不超過 maxTimeMinutes
    if (restCtx.mode === 'scuffed') {
      const cap = restCtx.maxTimeMinutes;
      if (actualMinutes > cap) {
        actualMinutes    = cap;
        deviationMinutes = cap - plannedMinutes;
      }
      // scuffed 睡不夠 → 最少給 10 分鐘，不能是負數時間
      if (actualMinutes < 10) {
        actualMinutes    = 10;
        deviationMinutes = 10 - plannedMinutes;
      }
    } else {
      // full_available 模式：至少給 10 分鐘
      if (actualMinutes < 10) {
        actualMinutes    = 10;
        deviationMinutes = 10 - plannedMinutes;
      }
    }

    // ── 3. 品質分級 ───────────────────────────────────────────
    const absDeviation = Math.abs(deviationMinutes);
    const quality: RestQuality =
      absDeviation <= 60  ? '成功休息' :
      absDeviation <= 180 ? '不完整休息' :
                            '喪失時間觀';

    // ── 4. 回復量計算 ─────────────────────────────────────────
    // 基準：8 小時（480 分鐘）= 100% 回復
    const baseRecoveryRatio = Math.min(actualMinutes / 480, 1);

    // 品質倍率
    const qualityScale =
      quality === '成功休息'   ? 1.0 :
      quality === '不完整休息' ? 0.5 : 0.25;

    // 情境倍率（scuffed = 0.3，full = 1.0）
    const contextScale = restCtx.statusEffectScale;

    const effectScale = qualityScale * contextScale;

    // 體力回復（不超過 staminaMax - stamina）
    const staminaDelta = Math.round(
      Math.min(
        baseRecoveryRatio * staminaMax * effectScale,
        staminaMax - stamina,
      )
    );

    // 壓力回復（降低壓力，不低於 0）
    const stressDelta = -Math.round(
      Math.min(
        baseRecoveryRatio * stressMax * effectScale * 0.6,
        stress,
      )
    );

    // ── 5. 語意標記 ───────────────────────────────────────────
    const resultTags: string[] = [quality];

    if (restCtx.mode === 'scuffed')    resultTags.push('scuffed');
    if (deviationMinutes > 60)         resultTags.push('oversleep');
    if (deviationMinutes < -60)        resultTags.push('undersleep');
    if (stressRatio > 0.7)             resultTags.push('high_stress');
    if (staminaDeficitRatio > 0.7)     resultTags.push('low_stamina');

    return {
      actualMinutes,
      deviationMinutes,
      quality,
      staminaDelta,
      stressDelta,
      resultTags,
    };
  }
}
