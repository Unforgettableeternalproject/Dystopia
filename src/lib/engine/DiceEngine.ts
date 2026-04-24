// DiceEngine — 通用骰點引擎。
//
// 設計原則：
//   - 純函式，不依賴任何遊戲狀態
//   - DiceSpec 是可擴充的骰型規格（1d20、2d6、等等）
//   - 統計修正公式：floor((stat - 8) / 3)，對齊 DnD 風格但縮放為本遊戲數值範圍
//   - 優勢/劣勢：各擲兩次取較高/較低值
//
// Phase 2 會讓 EncounterEngine.resolveNode 呼叫 DiceEngine.roll()；
// 目前 Phase 1 只建立引擎，EncounterEngine 的實際對接在 Phase 2 完成。

import type { DiceSpec, RollModifier } from '../types/encounter';

// ── Context & Result ──────────────────────────────────────────

export interface RollContext {
  /** 骰型規格（如 { count: 1, sides: 20 }） */
  dice: DiceSpec;
  /**
   * 玩家相關數值（dot-path 解析後的實際數值，已由呼叫端解析）。
   * 統計修正公式：floor((baseStat - 8) / 3)。
   */
  baseStat: number;
  /** 外部補正列表（如裝備、地形、buff） */
  modifiers: RollModifier[];
  /** 優勢：擲兩次取較高值（不能與 disadvantage 同時為 true） */
  advantage?: boolean;
  /** 劣勢：擲兩次取較低值（不能與 advantage 同時為 true） */
  disadvantage?: boolean;
}

export interface RollResult {
  /** 所有原始骰值（優勢/劣勢時為 2 個，否則為 1 個） */
  rolls: number[];
  /** 實際採用的骰值（優勢取高、劣勢取低，普通只有一個） */
  chosenRoll: number;
  /** 統計修正值 = floor((baseStat - 8) / 3) */
  statModifier: number;
  /** 所有外部補正加總 */
  externalModifier: number;
  /** 最終合計 = chosenRoll + statModifier + externalModifier */
  total: number;
}

// ── Engine ────────────────────────────────────────────────────

export class DiceEngine {
  /**
   * 計算統計修正值。
   * 公式：floor((stat - 8) / 3)
   * 範例：stat=20 → +4；stat=8 → 0；stat=5 → -1
   */
  static statModifier(stat: number): number {
    return Math.floor((stat - 8) / 3);
  }

  /**
   * 擲單顆骰子（1 到 sides 均等機率）。
   */
  static rollDie(sides: number): number {
    return Math.floor(Math.random() * sides) + 1;
  }

  /**
   * 依 DiceSpec 擲骰（count 顆 sides 面骰）並加總。
   */
  static rollDice(spec: DiceSpec): number {
    let total = 0;
    for (let i = 0; i < spec.count; i++) {
      total += DiceEngine.rollDie(spec.sides);
    }
    return total;
  }

  /**
   * 完整骰點流程。
   * 回傳結構化結果，供 StatCheckOverlay 顯示細節。
   */
  static roll(ctx: RollContext): RollResult {
    const { dice, baseStat, modifiers, advantage, disadvantage } = ctx;

    // Roll dice (advantage/disadvantage = roll twice, pick high/low)
    let rolls: number[];
    if (advantage || disadvantage) {
      rolls = [DiceEngine.rollDice(dice), DiceEngine.rollDice(dice)];
    } else {
      rolls = [DiceEngine.rollDice(dice)];
    }

    const chosenRoll = advantage
      ? Math.max(...rolls)
      : disadvantage
        ? Math.min(...rolls)
        : rolls[0];

    const statModifier     = DiceEngine.statModifier(baseStat);
    const externalModifier = modifiers.reduce((sum, m) => sum + m.value, 0);
    const total            = chosenRoll + statModifier + externalModifier;

    return { rolls, chosenRoll, statModifier, externalModifier, total };
  }

  /**
   * 判斷骰點結果是否達標。
   */
  static passes(result: RollResult, dc: number): boolean {
    return result.total >= dc;
  }
}
