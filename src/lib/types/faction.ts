// Faction Tree types — Epic / Checkpoint / QuestLine / Credit
// Design ref: PM note「陣營樹系統設計（核心架構決策 2026-06-10）」
// Credit ref: PM note「陣營樹 — 信用計算規則與數值設計（2026-06-10 確認）」

import type { Faction } from './world';

// ── Credit ───────────────────────────────────────────────────────

/**
 * 信用設定。每個陣營定義自己的正/負極限、中斷點、懲罰比率。
 *
 * Ditch 扣減公式：
 *   距離 = 當前信用 - 負值極限（取絕對值）
 *   扣減量 = 距離 × (ditchPenaltyPercent / 100)
 *   新信用 = 當前信用 - 扣減量
 *
 * 中斷點計算：
 *   中斷點信用值 = negativeLimit + (|negativeLimit| × breakpointPercent / 100)
 *   信用 ≤ 中斷點 → 主線鎖定，無法再接取該陣營任務
 */
export interface CreditConfig {
  /** 信用初始值（預設 0） */
  initialValue?: number;
  /** 正值極限（信用上限） */
  positiveLimit: number;
  /** 負值極限（信用下限，為負數） */
  negativeLimit: number;
  /** 中斷點百分比（10–15%），用於計算主線鎖定閾值 */
  breakpointPercent: number;
  /** Ditch 扣減百分比（預設 70） */
  ditchPenaltyPercent: number;
  /** 完成初始任務後的信用獎勵（預設 10） */
  initialQuestBonus: number;
}

// ── Tolerance (預留) ─────────────────────────────────────────────

/**
 * 容許度設定。中斷點觸發後才啟用。
 * 預留 interface，MVP-1 不實作。
 *
 * 容許度從好感換算，依陣營而異。
 * 允許有限互動（福利、交易點）。
 * 爭奪任務中，對方陣營的容許度可決定是否撤回中斷點。
 */
export interface ToleranceConfig {
  /** 從好感換算容許度的係數 */
  affinityConversionRate?: number;
  /** 容許度正值極限 */
  positiveLimit?: number;
  /** 是否允許透過爭奪任務撤回中斷點 */
  allowBreakpointRevoke?: boolean;
}

// ── Checkpoint ───────────────────────────────────────────────────

/**
 * 陣營主線的特定點（進度節點）。
 * 一般按順序推進，某些條件下可跳過。
 * 可由多條任務線的不同路徑達成。
 */
export interface FactionCheckpoint {
  id: string;
  /** 設計備注（不出現在 prompt 中） */
  label: string;
  /** 順序索引（0-based），用於判定推進順序 */
  order: number;
  /**
   * 達成條件：需要完成的任務 ID 列表（OR 關係）。
   * 完成其中任一即達成此特定點。
   */
  requiredQuestIds?: string[];
  /**
   * 達成條件：旗標運算式。
   * 與 requiredQuestIds 為 OR 關係——任一條件成立即達成。
   */
  requiredFlagExpression?: string;
  /**
   * 是否可跳過（外界影響時由引擎標記跳過）。
   * 預設 false。
   */
  skippable?: boolean;
  /** 達成後解鎖的劇情任務 ID 列表 */
  unlocksQuestIds?: string[];
  /** 達成後設置的全域旗標 */
  flagsSet?: string[];
}

// ── QuestLine ────────────────────────────────────────────────────

/**
 * 陣營任務線。一組連續型任務的鏈式定義。
 * 任務間有轉場（每個任務的初始化過渡）。
 * 嵌入 FactionEpicDefinition 內部，不獨立存放。
 */
export interface FactionQuestLine {
  id: string;
  /** 設計備注 */
  label: string;
  /** 任務線入口任務 ID */
  entryQuestId: string;
  /**
   * 此任務線可推進的 Checkpoint ID 列表。
   * 完成此線的關鍵任務後，可推進對應的 Checkpoint。
   */
  contributesToCheckpoints?: string[];
  /**
   * 唯一可達的 Checkpoint ID。
   * 若此線是唯一能達成某 Checkpoint 的路徑，該線不會被封閉或有彌補機制。
   */
  solePathToCheckpoint?: string;
}

// ── Epic ─────────────────────────────────────────────────────────

/**
 * 陣營主線（Epic）定義。
 * 沒有直接目標給玩家完成，更像是進度追蹤。
 * 靠 Checkpoint 推進，Checkpoint 可由多條 QuestLine 達成。
 * 完成後會對世界產生顯著影響、改變玩家身分與遭遇。
 */
export interface FactionEpicDefinition {
  id: string;
  /** 設計備注 */
  label: string;
  /** 特定點列表，按 order 排序 */
  checkpoints: FactionCheckpoint[];
  /** 任務線列表，嵌入在陣營定義中 */
  questLines: FactionQuestLine[];
  /**
   * 完成主線後設置的全域旗標。
   * 用於標記世界觀變化（如政權更迭）。
   */
  completionFlags?: string[];
}

// ── Extended Faction ─────────────────────────────────────────────

/**
 * 擴充後的陣營定義，在 Faction 的基礎上加入陣營樹資料。
 * 所有新欄位皆為可選，確保向後相容——現有 Faction JSON 無需修改即可正常載入。
 *
 * 結構：
 *   FactionDefinition
 *     ├── epic: FactionEpicDefinition
 *     │     ├── checkpoints: FactionCheckpoint[]
 *     │     └── questLines: FactionQuestLine[]
 *     ├── credit: CreditConfig
 *     └── tolerance: ToleranceConfig（預留）
 */
export interface FactionDefinition extends Faction {
  /** 陣營主線定義（可擁有多條主線，MVP-1 先支援單一） */
  epic?: FactionEpicDefinition;
  /** 信用系統設定 */
  credit?: CreditConfig;
  /** 容許度設定（預留，MVP-1 不實作） */
  tolerance?: ToleranceConfig;
}
