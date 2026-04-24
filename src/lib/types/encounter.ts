// Encounter types.
//
// 遭遇（Encounter）是特殊的遊戲狀態：
//   - 由事件（EventOutcome.startEncounterId）觸發，或地點條件自動觸發
//   - 有結構化的選項和判定，不同於自由文字輸入的探索模式
//   - 結束時套用結果效果，恢復 exploring 狀態
//
// 五種型別（在 EncounterDefinition.type 設定）：
//   'story'     — 劇情遭遇：線性 cutscene，直接顯示文字，每幕可套用遷入值，不走 DM
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
export type EncounterType = 'story' | 'event' | 'dialogue' | 'combat' | 'shop';

// ── Dice Types ────────────────────────────────────────────────

/** 骰型規格，如 { count: 1, sides: 20 } 代表 1d20。 */
export interface DiceSpec {
  count: number;
  sides: number;
}

/** 單一骰點補正項目，如裝備加成、劣勢懲罰等。 */
export interface RollModifier {
  /** 補正來源標籤（顯示用，如 "裝備加成"、"地形懲罰"） */
  label: string;
  value: number;
}

// ── Stat Check ────────────────────────────────────────────────

/**
 * 數值判定。節點到達時自動執行，結果決定跳轉節點。
 * 使用 DnD 風格骰點系統：roll(dice) + floor((stat - 8) / 3) + modifiers >= dc。
 * dice 省略時預設 1d20。
 */
export interface EncounterStatCheck {
  /** Dot-path 數值鍵，如 "primaryStats.strength" */
  stat: string;
  /** Difficulty Class — 骰點結果需大於等於此值才通過 */
  dc: number;
  /** 骰型規格；省略時預設 1d20 */
  dice?: DiceSpec;
  /** 優勢：擲兩次取較高值 */
  advantage?: boolean;
  /** 劣勢：擲兩次取較低值 */
  disadvantage?: boolean;
  /** 額外補正（疊加在 stat modifier 之上） */
  modifiers?: RollModifier[];
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
   * 明確標記玩家已接觸指定派系（即使無聲望變化）。
   * 用於「見到某組織成員但 rep 不變」的場景；不影響 unknownUntil 的識別判斷。
   */
  contactFactionIds?: string[];
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
  /**
   * 將指定任務推進到特定階段。
   * 由 GameController 轉交 StateManager.advanceQuestStage 處理。
   */
  advanceQuestStage?: { questId: string; stageId: string };
  /**
   * 標記指定任務目標為已完成。
   * 由 GameController 轉交 QuestEngine 處理。
   */
  completeQuestObjective?: { questId: string; objectiveId: string };
  /**
   * 移動玩家到指定地點 ID。
   * 由 GameController 轉交 StateManager.movePlayer 處理。
   */
  movePlayer?: string;
  /**
   * 推進遊戲時間（分鐘數）。
   * 由 GameController 處理（包含時段更新、物品過期）。
   */
  timeAdvance?: number;
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
  itemRequirements?: ItemRequirement[];
  /**
   * 最低梅分門檻。玩家持有梅分需大於等於此數值，此選項才顯示。
   */
  minMelphin?: number;
  /**
   * 派系聲望下限（AND 關係）。key = factionId，value = 最低聲望值。
   * 玩家對所有指定派系的聲望均需達標，此選項才顯示。
   */
  minReputation?: Record<string, number>;
  /**
   * 派系聲望上限（AND 關係）。key = factionId，value = 最高聲望值。
   * 玩家對所有指定派系的聲望均需不超過此值，此選項才顯示。
   */
  maxReputation?: Record<string, number>;
  /**
   * NPC 好感下限（AND 關係）。key = npcId，value = 最低好感值。
   */
  minAffinity?: Record<string, number>;
  /**
   * NPC 好感上限（AND 關係）。key = npcId，value = 最高好感值。
   */
  maxAffinity?: Record<string, number>;
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

// ── Story (cutscene) types ────────────────────────────────────

/**
 * story 型別的單一台詞 / 效果行。
 *
 * speaker 規則：
 *   'narrator' — 旁白（斜體，無引號框）
 *   'player'   — 玩家台詞（引號，玩家名稱顯示）
 *   其他字串   — NPC 名稱或 ID（引號，對話框樣式）
 *
 * effects（遷入值）：此行呈現時套用的效果。
 * speaker / text 可省略，此時為純效果行（不顯示任何文字）。
 */
export interface ScriptLine {
  speaker?: string;
  text?: string;
  /** 遷入值：到達此行時套用的效果 */
  effects?: EncounterChoiceEffects;
  /**
   * 在此行後暫停，等待玩家點「繼續」才推進下一個批次。
   * 省略 = 自動推進（不需要玩家輸入）。
   * 常用於切換地點或度過大量時間之後。
   */
  pause?: boolean;
}

/**
 * story 型別遭遇的最終結果。
 * 玩家確認結束時套用，可省略（省略 = 故事結束無額外效果）。
 */
export interface StoryResult {
  outcomeType?: 'success' | 'failure' | 'neutral';
  effects?: EncounterChoiceEffects;
}

// ── Definition ────────────────────────────────────────────────

/**
 * 遭遇定義節點（lore/world/regions/<region>/encounters/<id>.json）。
 * 靜態資料，不隨遊戲狀態改變。
 *
 * story 型別使用 scenes + result；
 * event / dialogue / combat / shop 型別使用 entryNodeId + nodes。
 */
export interface EncounterDefinition {
  id: string;
  name: string;
  /** 遭遇型別，決定 UI 主視覺；省略時預設為 'event' */
  type?: EncounterType;
  /** DM-facing：此遭遇的整體情境說明 */
  description: string;

  // ── story 型別 ──
  /** 劇情腳本行序列（story 型別使用） */
  script?: ScriptLine[];
  /** 玩家確認結束時套用的效果與結局類型（story 型別使用，可省略） */
  result?: StoryResult;

  // ── event / dialogue / combat / shop 型別 ──
  /** 遭遇開始時的進入節點 ID */
  entryNodeId?: string;
  nodes?: Record<string, EncounterNode>;
}

// ── Active Runtime State ──────────────────────────────────────

/**
 * GameState 中記錄進行中遭遇的執行狀態。
 * GameState.phase = 'event' 時此欄位存在。
 */
export interface ActiveEncounter {
  encounterId: string;
  /** event / dialogue / combat / shop 型別使用 */
  currentNodeId?: string;
  /** story 型別使用：目前已顯示到的行索引（含純效果行跳過後的第一個文字行） */
  currentLineIndex?: number;
  /** 累積的敘述文字，遭遇結束後寫入 history */
  collectedNarrative: string;
}
