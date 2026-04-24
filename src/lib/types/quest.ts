// Quest definition types.
// QuestDefinition = authored content (in lore files).
// Player progress (current stage, completed objectives) lives in GameState (QuestInstance).

// ── Source & Type ─────────────────────────────────────────────────

/**
 * 任務來源。
 * 'origin'  — 出身自帶，遊戲開始時自動授予。部分為循環任務。
 * 'npc'     — NPC 賦予。可以有長線/短線之分，長線任務通常綁定派系。
 * 'event'   — 事件產生。可能有時間限制，逾時自動失敗。
 */
export type QuestSource = 'origin' | 'npc' | 'event';

export type QuestType = 'main' | 'side' | 'hidden';

// ── Objective ─────────────────────────────────────────────────────

export type ObjectiveType =
  | 'flag_check'          // 單一全域旗標存在
  | 'flag_expression'     // 複合旗標運算式（支援 AND/OR/NOT 或 &/|/!）
  | 'quest_flag'          // 任務本地旗標（由 DM <<QUEST>> 信號設置）
  | 'location_visit'      // 到達指定地點
  | 'npc_talk'            // 與 NPC 互動過
  | 'item_collect'        // 持有指定道具
  | 'reputation'          // 對派系的聲望達到門檻
  | 'encounter_completed'; // 遭遇以特定結局完成

export interface QuestObjective {
  id: string;
  type: ObjectiveType;
  description: string;        // 玩家可見

  // flag_check
  flag?: string;
  // flag_expression
  flagExpression?: string;    // 傳入 FlagSystem.evaluate()
  // quest_flag — 任務本地旗標，DM 用 <<QUEST: id | flag: name>> 設置
  questFlag?: string;
  // location_visit
  locationId?: string;
  // npc_talk
  npcId?: string;
  // item_collect
  itemId?: string;
  // reputation
  factionId?: string;
  minReputation?: number;
  // encounter_completed
  encounterCompletedId?: string;
  requiredOutcomeType?: 'success' | 'failure' | 'neutral';
}

// ── Stage ─────────────────────────────────────────────────────────

export interface QuestStageOutcome {
  flagsSet?: string[];
  flagsUnset?: string[];
  statChanges?: Record<string, number>;
  reputationChanges?: Record<string, number>;   // factionId -> delta
  affinityChanges?: Record<string, number>;     // npcId -> delta
  grantItems?: Array<{ itemId: string; variantId?: string }>;
  grantQuestId?: string;
  nextStageId: string | null;                   // null = 任務完成
}

/**
 * 任務自動失敗條件。
 * 掛在 QuestDefinition（頂層）或 QuestStage（階段層）。
 * 條件滿足時由 GameController 自動呼叫 QuestEngine.applyQuestFail()。
 *
 * 頂層 failCondition：任何階段都適用，條件達成即失敗整個任務。
 * 階段層 failCondition：只在此階段有效，條件達成時觸發該階段的 onFail。
 */
export interface QuestFailCondition {
  /** 跨越這些整點小時（0–23）時自動觸發失敗檢查 */
  triggerHours?: number[];
  /** 這些旗標全部存在時自動失敗 */
  flags?: string[];
  /** 任意一個旗標存在時自動失敗 */
  anyFlags?: string[];
}

/**
 * 任務階段失敗後果。由 QuestEngine.applyQuestFail() 套用。
 *
 * nextStageId 語意：
 *   null      = 任務完全失敗（進入 completedQuestIds，標記 isFailed）
 *   string    = 任務退回指定階段（如重試入口），不失敗
 *   undefined = 僅套用效果，停留在當前階段（輕微懲罰，可繼續嘗試）
 */
export interface QuestStageFailOutcome {
  flagsSet?: string[];
  flagsUnset?: string[];
  statChanges?: Record<string, number>;
  reputationChanges?: Record<string, number>;
  affinityChanges?: Record<string, number>;
  nextStageId?: string | null;
  /**
   * 失敗時直接觸發的事件 ID（由 GameController 轉交 EventEngine.fireEventById）。
   * 事件仍會進行 notFlags 等防衛條件檢查。
   */
  startEventId?: string;
}

export interface QuestStage {
  id: string;
  description: string;            // 玩家可見的階段標籤
  /**
   * 目標是否需要按順序完成。
   * true = 每次只檢查第一個未完成的目標。
   * false / 省略 = 並行評估所有目標（預設）。
   */
  ordered?: boolean;
  objectives: QuestObjective[];
  onComplete: QuestStageOutcome;
  /**
   * 此階段的自動失敗條件。條件達成時觸發本階段的 onFail。
   * 與頂層 QuestDefinition.failCondition 並存（頂層優先檢查）。
   */
  failCondition?: QuestFailCondition;
  /**
   * 外部觸發失敗時的後果（由 EventOutcome.failQuestId、EncounterChoiceEffects.failQuestId
   * 或 failCondition 自動觸發時啟動）。
   * 省略時若任務有 onFailDefault 則退回使用該預設值。
   */
  onFail?: QuestStageFailOutcome;
  /**
   * 玩家在此階段放棄任務時的後果。
   * 省略 = 無後果（但聲望損失仍由 ditchConsequences 決定）。
   */
  onDitch?: Pick<QuestStageOutcome, 'flagsSet' | 'flagsUnset' | 'statChanges' | 'reputationChanges'>;
}

// ── Reward ────────────────────────────────────────────────────────

export interface QuestReward {
  experience?: number;
  items?: Array<{ itemId: string; variantId?: string }>;
  skillIds?: string[];                          // 解鎖技能（供未來技能系統使用）
  reputationChanges?: Record<string, number>;   // factionId -> delta
  affinityChanges?: Record<string, number>;     // npcId -> delta
  flagsSet?: string[];                          // 完成時設置的全域旗標
}

// ── Ditch Consequences ────────────────────────────────────────────

/**
 * 出賣任務（ditch）的後果。
 *
 * Ditch 不是普通放棄，而是主動將派系任務秘密暴露給敵對派系的背叛行為。
 * 典型效果：
 *   - 被出賣的派系聲望永久歸負（使用 reputationOverrides 直接設值）
 *   - 受益派系聲望大幅提升（使用 reputationChanges 增量）
 *   - 設置永久旗標（如 crambell_treffen_betrayed）
 *
 * reputationOverrides vs reputationChanges:
 *   reputationChanges = 在現有基礎上增減（+/-N）
 *   reputationOverrides = 直接設為此值，無視現有（用於強制歸負）
 */
export interface QuestDitchConsequences {
  /** 受益派系 ID（接受情報的一方） */
  beneficiaryFactionId?: string;
  /** 直接設定聲望值（覆蓋現有，用於強制歸負） Record<factionId, newValue> */
  reputationOverrides?: Record<string, number>;
  /** 增減聲望（增量）Record<factionId, delta> */
  reputationChanges?: Record<string, number>;
  affinityChanges?: Record<string, number>;
  flagsSet?: string[];
  flagsUnset?: string[];
  statChanges?: Record<string, number>;
}

// ── Definition ────────────────────────────────────────────────────

export interface QuestDefinition {
  id: string;
  name: string;
  type: QuestType;
  source: QuestSource;

  /** 賦予任務的 NPC（source = 'npc' 時使用） */
  giverNpcId?: string;
  /** 綁定區域，null / 省略 = 跨區域 */
  regionId?: string;
  /** 觸發此任務的事件 ID（source = 'event' 時使用） */
  parentEventId?: string;

  /**
   * 出身過濾器。
   * source = 'origin' 時，只有符合 origin 的玩家才會自動獲得此任務。
   * 省略 = 所有出身。
   */
  originFilter?: string[];

  /**
   * 任務分類（說明用，不影響引擎邏輯）。
   * 'once'       — 一次性任務，達成即完成。
   * 'staged'     — 多階段任務，依序推進。
   * 'repeatable' — 循環任務，完成後重新開始。
   */
  questKind?: 'once' | 'staged' | 'repeatable';

  /**
   * 是否為循環任務。
   * true = 完成後重置回 entryStageId，不會進入 completedQuestIds。
   * 典型用途：出身帶來的每日配額任務。
   */
  isRepeatable?: boolean;

  /**
   * 循環任務重置條件（僅 isRepeatable=true 時有效）。
   * 省略 = 完成後立即重置（舊行為）。
   * 有值 = 完成後等到此旗標運算式為 true 才重新授予。
   */
  repeatCondition?: string;

  /**
   * 是否為派系入會任務。
   * 完成後玩家被視為正式加入 factionId 指定的派系。
   */
  isFactionQuest?: boolean;
  factionId?: string;

  /**
   * 玩家是否可以主動放棄此任務（MVP v1 Abandon 語意）。
   * 省略時由引擎依 type 推導：type !== 'main' 的任務預設可放棄。
   * Abandon 結果 = 直接視為 fail，套用當前階段 onFail / onFailDefault。
   */
  canAbandon?: boolean;

  /**
   * 與此任務相斥的任務 ID 列表。
   * 玩家已接取列表中任何一個任務時，此任務不能被授予。
   * 典型用途：敵對陣營主線任務互斥，請作者顯式標註。
   */
  cannotCoexist?: string[];

  /**
   * 玩家是否可以主動出賣此任務（MVP v2 Ditch 語意）。
   * true = 允許 ditch，並套用 ditchConsequences（陣營背叛後果）。
   * 出身任務與事件任務通常不可放棄。
   * @deprecated MVP v1 請使用 canAbandon；Ditch 語意留待 v2 實作。
   */
  canDitch?: boolean;
  ditchConsequences?: QuestDitchConsequences;

  /**
   * 任務時間限制（遊戲內分鐘）。
   * 玩家接受後，totalMinutes + timeLimit = 截止時間。
   * 逾時自動失敗。source = 'event' 任務常用。
   */
  timeLimit?: number;

  /**
   * 是否自動接受。
   * true = 不需要玩家主動操作，系統自動授予（出身任務、事件任務）。
   */
  autoAccept?: boolean;

  /**
   * 頂層自動失敗條件。任何階段下條件達成即直接失敗整個任務，
   * 優先於階段層 failCondition 檢查。
   */
  failCondition?: QuestFailCondition;
  /**
   * 無 onFail 定義的階段失敗時使用的預設後果。
   * 若階段有明確 onFail，則忽略此預設值。
   * 典型用途：循環任務的重置邏輯，避免每個階段都重複定義。
   */
  onFailDefault?: QuestStageFailOutcome;

  entryStageId: string;
  stages: Record<string, QuestStage>;
  rewards?: QuestReward;
}

// ── Runtime Instance ──────────────────────────────────────────────

/**
 * 玩家進行中的任務快照，存於 GameState.activeQuests。
 */
export interface QuestInstance {
  questId: string;
  source: QuestSource;
  currentStageId: string | null;      // null = 完成
  completedObjectiveIds: string[];
  /**
   * 任務本地旗標集。
   * 由 DM <<QUEST: questId | flag: name>> 信號設置。
   * 用於 type:'quest_flag' 目標的判斷。
   * 不會污染全域 FlagSystem。
   */
  localFlags: string[];
  isCompleted: boolean;
  isFailed: boolean;
  isDitched: boolean;

  /** 接受任務時的 totalMinutes（用於計算逾時） */
  acceptedAtMinutes?: number;
  /** 截止 totalMinutes，逾時自動失敗 */
  expiresAtMinutes?: number;

  /** 賦予此任務的 NPC ID（source = 'npc' 時填入） */
  giverNpcId?: string;
  /** 觸發此任務的事件 ID（source = 'event' 時填入） */
  sourceEventId?: string;
}
