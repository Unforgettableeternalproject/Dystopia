// Encounter types.
//
// 遭遇（Encounter）是特殊的遊戲狀態：
//   - 由事件（EventOutcome.startEncounterId）觸發，或地點條件自動觸發
//   - 有結構化的選項和判定，不同於自由文字輸入的探索模式
//   - 結束時套用結果效果，恢復 exploring 狀態
//
// 五種型別（在 EncounterDefinition.type 設定）：
//   'narrative' — 劇情遭遇：敘事場景、小劇情，通常沒有選項或只有「繼續」
//   'event'     — 事件遭遇：有選項的決策場景，可含數值判定
//   'dialogue'  — 對話遭遇：橋接到現有 NPC 對話系統（目前作為觸發器使用）
//   'combat'    — 戰鬥遭遇：戰鬥系統（MVP 延後）
//   'shop'      — 商店遭遇：交易界面（MVP 延後）

import type { EventGrantItem } from './world';
import type { ItemRequirement } from './item';

// ── Encounter Type ────────────────────────────────────────────

/**
 * 遭遇型別。決定渲染的 UI 元件與主視覺。
 * 型別設定於 EncounterDefinition 層級（整個遭遇的主要型別）。
 */
export type EncounterType = 'narrative' | 'event' | 'dialogue' | 'combat' | 'shop';

// ── Stat Check ────────────────────────────────────────────────

/**
 * 數值判定。節點到達時自動執行，結果決定跳轉節點。
 * 門檻由靜態定義設定，通過條件為 playerStat >= threshold。
 */
export interface EncounterStatCheck {
  /** Dot-path 數值鍵，如 "primaryStats.strength" */
  stat: string;
  /** 通過門檻；玩家數值需大於等於此值 */
  threshold: number;
  successNodeId: string;
  failNodeId: string;
}

// ── Choice ────────────────────────────────────────────────────

/** 選擇後套用的效果 */
export interface EncounterChoiceEffects {
  flagsSet?: string[];
  flagsUnset?: string[];
  /** Dot-path 格式的數值 delta，如 "statusStats.stress": 2 */
  statChanges?: Record<string, number>;
  /** 派系聲望 delta，key = factionId */
  reputationChanges?: Record<string, number>;
  /** NPC 好感 delta，key = npcId */
  affinityChanges?: Record<string, number>;
  grantItems?: EventGrantItem[];
  grantQuestId?: string;
  grantIntelId?: string;
  /**
   * 梅分變化（正 = 獲得，負 = 扣除）。不走 statChanges dot-path。
   * 由 GameController 轉交 StateManager.modifyMelphin 處理。
   */
  melphinChange?: number;
  /**
   * 觸發指定任務的 onFail 效果並推進/失敗該任務。
   * 由 GameController 轉交 QuestEngine.applyQuestFail 處理。
   */
  failQuestId?: string;
}

/** 遭遇中的單一選項 */
export interface EncounterChoice {
  id: string;
  text: string;
  /**
   * 旗標運算式；為 false 時此選項對玩家隱藏。
   * 省略 = 永遠顯示。
   */
  condition?: string;
  /**
   * 物品持有需求（AND 關係）。玩家需持有所有未失效的指定物品，此選項才顯示。
   * 與旗標 condition 為獨立條件（AND）。
   */
  itemCondition?: ItemRequirement[];
  /**
   * 最低梅分門檻。玩家持有梅分需大於等於此數值，此選項才顯示。
   */
  minMelphin?: number;
  /** 選擇後套用的效果（選填） */
  effects?: EncounterChoiceEffects;
  /**
   * 選擇後跳往的節點 ID。
   * null = 遭遇在此選項後結束。
   */
  nextNodeId: string | null;
}

// ── Node ──────────────────────────────────────────────────────

/** 遭遇節點。遭遇是有向圖（DAG），每個節點代表一個場景狀態。 */
export interface EncounterNode {
  id: string;
  /**
   * 向 DM 提供的場景說明（不直接顯示給玩家）。
   * DM 根據此文字生成敘述，或直接以此作為顯示文字（displayText 省略時）。
   */
  dmNarrative: string;
  /**
   * 直接顯示給玩家的固定文字（省略 = 由 DM 根據 dmNarrative 生成）。
   * 適合不需要 AI 改寫的固定場景。
   */
  displayText?: string;
  /**
   * 數值判定。到達此節點時自動執行。
   * 有判定時不顯示 choices（判定結果決定跳轉）。
   */
  statCheck?: EncounterStatCheck;
  /** 玩家可選擇的選項（有判定時不適用） */
  choices?: EncounterChoice[];
  /**
   * 此節點是否為結局節點（到達即結束遭遇）。
   * 結局節點可攜帶 effects 作為最終結果效果。
   */
  isOutcome?: boolean;
  /** 到達此節點時套用的效果（通常用於結局節點） */
  effects?: EncounterChoiceEffects;
  /**
   * 結局類型（isOutcome 為 true 時有意義）。
   * 'success' / 'failure' / 'neutral'
   * 用於判斷任務目標 encounter_completed 的成功條件。
   */
  outcomeType?: 'success' | 'failure' | 'neutral';
}

// ── Definition ────────────────────────────────────────────────

/**
 * 遭遇定義節點（lore/world/regions/<region>/encounters/<id>.json）。
 * 靜態資料，不隨遊戲狀態改變。
 */
export interface EncounterDefinition {
  id: string;
  name: string;
  /** 遭遇型別，決定 UI 主視覺；省略時預設為 'event' */
  type?: EncounterType;
  /** DM-facing：此遭遇的整體情境說明 */
  description: string;
  /** 遭遇開始時的進入節點 ID */
  entryNodeId: string;
  nodes: Record<string, EncounterNode>;
}

// ── Active Runtime State ──────────────────────────────────────

/**
 * GameState 中記錄進行中遭遇的執行狀態。
 * GameState.phase = 'event' 時此欄位存在。
 */
export interface ActiveEncounter {
  encounterId: string;
  currentNodeId: string;
  /** 累積的敘述文字，遭遇結束後寫入 history */
  collectedNarrative: string;
}
