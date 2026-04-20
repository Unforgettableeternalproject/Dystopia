// ── Condition Types ───────────────────────────────────────────────
import type { PrimaryStats } from './player';

/**
 * 週期性效果模板（靜態定義，不含 runtime 狀態）。
 * 例：每 5 回合扣 1 體力，最多 3 次 = 輕微流血。
 */
export interface ConditionTickTemplate {
  /** 每幾回合觸發一次 */
  everyNTurns: number;
  /**
   * 觸發時的數值變化。
   * key 為 dot-path，對應 PlayerState 的 stat 路徑。
   * 例：{ "statusStats.stamina": -1 }
   */
  statChanges: Partial<Record<string, number>>;
  /** 最多觸發幾次（達到後條件自動移除） */
  maxTicks: number;
}

/**
 * 異常狀態定義節點（靜態資料，儲存於 lore/world/conditions.json）。
 * 玩家身上的狀態實例以 PlayerCondition 記錄，並指向此定義。
 */
export interface ConditionDefinition {
  id: string;
  /** 玩家可見的簡短標籤（UI 顯示用） */
  label: string;
  /** DM 面向的效果說明（不直接顯示給玩家） */
  description: string;
  /** true = 玩家不知道自己有此狀態（如被操控），UI 不顯示 */
  isHidden?: boolean;
  /**
   * 靜態主要數值加減（加成型 debuff，如力量降低）。
   * 持續生效直到狀態解除。
   */
  statModifiers?: Partial<PrimaryStats>;
  /**
   * 週期性效果（如輕微流血每 N 回合扣體力）。
   * 觸發次數達 maxTicks 後條件自動移除。
   */
  tickEffect?: ConditionTickTemplate;
  /**
   * 行動時間乘數。
   * 1.05 = 所有行動花費時間 +5%（如扭傷）。
   * 省略 = 無效果。
   * 多個條件的乘數相乘疊加。
   */
  actionTimeCostMultiplier?: number;
  /** DM 面向：玩家應如何解除此狀態的說明 */
  removeCondition?: string;
  /** 使用這些物品後可解除此狀態（由 ItemEngine / GameController 處理） */
  curedByItemIds?: string[];
  /** 這些旗標被設置時自動解除此狀態 */
  curedByFlags?: string[];
}

// ── Runtime State ─────────────────────────────────────────────────

/**
 * 週期性效果的 runtime 狀態。
 * 儲存在 PlayerCondition 中，與定義分離。
 */
export interface ConditionTickState {
  /** 已觸發次數 */
  ticksApplied: number;
  /** 下次觸發的回合數（由 addCondition 依 everyNTurns 初始化） */
  nextTickTurn: number;
}

/**
 * 玩家身上的狀態條件 runtime 實例。
 * 靜態定義（效果、標籤、說明等）由 ConditionDefinition 提供；
 * 此型別只記錄個別實例的生命週期與 tick 進度。
 */
export interface PlayerCondition {
  /** 對應 ConditionDefinition.id */
  id: string;
  /**
   * 到此回合自動移除。
   * undefined = 永久直到主動清除（由事件、物品、旗標）。
   */
  expiresOnTurn?: number;
  /**
   * tick 效果的 runtime 狀態。
   * 僅在對應 ConditionDefinition 有 tickEffect 時填入；
   * 由 StateManager.addCondition 根據定義自動初始化。
   */
  tickState?: ConditionTickState;
}
