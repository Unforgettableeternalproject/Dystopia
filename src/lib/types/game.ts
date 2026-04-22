// -- Game State & AI Types ---

import type { PlayerState } from "./player";
import type { QuestInstance } from "./quest";
import type { WorldPhaseState } from "./phase";
import type { TimePeriod } from "./world";
import type { PlayerAttitude } from "./dialogue";
import type { ActiveEncounter } from "./encounter";

/**
 * 遊戲內時間。
 * 遊戲從 AD 1498-06-12 21:23 開始，所有動作推進時間。
 * totalMinutes 是自遊戲開始的累計分鐘數，用於冷卻計算。
 */
export interface GameTime {
  year: number;
  month: number;    // 1–12
  day: number;      // 1–31
  hour: number;     // 0–23
  minute: number;   // 0–59
  /** 自遊戲開始的累計分鐘數（不隨存檔重置，用於事件冷卻） */
  totalMinutes: number;
}

export interface ActiveDialogueState {
  npcId:         string;
  dialogueId:    string;
  currentNodeId: string;
}

export interface GameState {
  player: PlayerState;
  turn: number;
  phase: GamePhase;
  worldPhase: WorldPhaseState;
  pendingThoughts: Thought[];
  lastNarrative: string;
  history: HistoryEntry[];
  discoveredLocationIds: string[];
  /** 進行中的任務 Record<questId, QuestInstance> */
  activeQuests: Record<string, QuestInstance>;
  /** 已完成或失敗的任務 ID 列表 */
  completedQuestIds: string[];
  /** 每個 NPC 的互動記憶 Record<npcId, NPCMemoryEntry> */
  npcMemory: Record<string, NPCMemoryEntry>;
  /** 當前進行中的對話；undefined 表示非對話狀態 */
  activeDialogue?: ActiveDialogueState;
  /**
   * 當前進行中的遭遇；undefined 表示非遭遇狀態。
   * GameState.phase = 'event' 時此欄位應存在。
   */
  activeEncounter?: ActiveEncounter;
  /** 當前遊戲內時間 */
  time: GameTime;
  /** 當前時段（作業/休息/特殊） */
  timePeriod: TimePeriod;
  /**
   * 可重複事件的冷卻記錄。
   * key = eventId，value = 上次觸發時的 totalMinutes。
   * EventEngine 用此判斷冷卻是否結束。
   */
  eventCooldowns: Record<string, number>;
  eventCounters: Record<string, number>;
}

export type GamePhase =
  | "exploring"
  | "dialogue"
  | "event"
  | "combat"
  | "ending";

export interface Thought {
  id: string;
  text: string;
  actionType: ActionType;
  /** true 表示此 Thought 可能被污染（高壓、虛空、心靈控制等情況下） */
  isManipulated?: boolean;
}

export type ActionType =
  | "move"
  | "interact"
  | "examine"
  | "use"
  | "rest"
  | "combat"
  | "free";

export interface PlayerAction {
  type: ActionType;
  input: string;
  targetId?: string;
}

export interface RegulatorResult {
  allowed: boolean;
  reason?: string;
  modifiedAction?: PlayerAction;
}

export interface DMResponse {
  narrative: string;
  thoughts: Thought[];
  flagsTriggered: string[];
  stateChanges?: Partial<GameState>;
}

/**
 * 歷史記錄條目。
 * 每回合儲存一筆，作為 DM 的滾動上下文視窗。
 */
export interface HistoryEntry {
  turn: number;
  action: PlayerAction;
  narrative: string;
  locationId: string;       // 事件發生地點
  npcIds?: string[];        // 本回合涉及的 NPC
  flagsChanged?: string[];  // 本回合新增或移除的旗標（格式：+flag_name / -flag_name）
}

/**
 * 單一 NPC 的互動記憶。
 * DM 透過此結構了解玩家與該角色的關係狀態，確保對話的連貫性與真實感。
 *
 * 更新時機：每次 NPC 互動後由 DialogueManager 根據 DM 信號更新。
 */
export interface NPCMemoryEntry {
  npcId: string;
  firstMetTurn: number;
  lastInteractedTurn: number;
  interactionCount: number;

  /**
   * 玩家對此 NPC 的態度（由 DM <<NPC_STATE: ...>> 信號更新）。
   */
  playerAttitude: PlayerAttitude;

  /**
   * 上次對話的核心主題（DM <<NPC_STATE: ...>> 信號更新，1 句話）。
   * DM 用於避免重複相同的對話內容。
   */
  lastTopic?: string;
}

/**
 * 開發用初始設定（lore/world/starter.json）。
 * 分離 world（世界狀態）與 player（玩家初始值），titles 由稱號系統管理。
 */
export interface StarterConfig {
  world: {
    startLocationId: string;
    startTime: { year: number; month: number; day: number; hour: number; minute: number };
    startPeriod: TimePeriod;
    worldPhase: string;
    startingFlags: string[];
  };
  player: {
    origin: string;
    /** 初始顯示稱號；真正的稱號系統之後才實作 */
    title?: string;
    primaryStats: { strength: number; knowledge: number; talent: number; spirit: number; luck: number };
    secondaryStats: { consciousness: number; mysticism: number; technology: number };
    statusStats: { stamina: number; staminaMax: number; stress: number; stressMax: number; endo: number; endoMax: number };
    knownIntelIds: string[];
    /** 初始物品 ID 列表，引擎會在 loadStarter 時轉換成完整 InventoryItem 物件 */
    inventory: string[];
  };
}

// ── Dialogue encounter resolution ────────────────────────────────────────────

/**
 * Dialogue encounter turn resolution.
 * DM Phase 1 outputs this as JSON; Judge validates and returns the same type.
 */
export interface DialogueResolution {
  endEncounter: boolean;
  npcState?: { attitude?: 'friendly' | 'neutral' | 'cautious' | 'hostile'; topic?: string };
  flagsSet?: string[];
  flagsUnset?: string[];
  timeMinutes?: number;
  questSignals?: Array<{ questId: string; type: 'flag' | 'objective'; value: string }>;
  /** DM narrative summary (Phase 1 only). Judge does not use this. */
  narrativeSummary?: string;
  /** Explanation if Judge overrode a value. */
  reasoning?: string;
}

// ── Judge / Shadow Mode ──────────────────────────────────────────────────────

/** encounter 欄位的共用格式（DM intent 與 Judge resolution 共用）。 */
export interface EncounterRef {
  type: 'dialogue' | 'event';
  npcId?: string;
  encounterId?: string;
}

/**
/**
 * 本回合的結算物件。
 * DM 以此格式輸出「已決定的信號」(dmProposal)，
 * Judge 驗證約束後輸出同型結果 (judgeResolution)。
 */
export interface TurnResolution {
  move?: string;
  timeMinutes?: number;
  flagsSet?: string[];
  flagsUnset?: string[];
  encounter?: EncounterRef;
  /** DM 的一句摘要（Phase 1 用）。Judge 不使用此欄位。 */
  narrativeSummary?: string;
  /** 說明為何覆蓋 DM 的值（Judge 用）或為何清除某欄位（deterministic 用）。 */
  reasoning?: string;
}

/**
 * 自由探索回合的 shadow mode 比對結果。
 */
export interface ExplorationShadowComparison {
  type: 'exploration';
  turn: number;
  actionInput: string;
  /** DM Phase 1 輸出的已決定信號（含 narrativeSummary）。 */
  dmProposal: TurnResolution;
  judgeResolution: TurnResolution;
  /** 人類可讀的差異描述列表（空 = 完全一致）。 */
  divergences: string[];
}

/**
 * 對話遭遇回合的 shadow mode 比對結果。
 */
export interface DialogueShadowComparison {
  type: 'dialogue';
  turn: number;
  npcId: string;
  playerInput: string;
  /** DM Phase 1 輸出的已決定對話信號。 */
  dmProposal: DialogueResolution;
  judgeResolution: DialogueResolution;
  /** 人類可讀的差異描述列表（空 = 完全一致）。 */
  divergences: string[];
}

/** 一回合的 shadow mode 比對結果（探索或對話）。 */
export type ShadowComparison = ExplorationShadowComparison | DialogueShadowComparison;
