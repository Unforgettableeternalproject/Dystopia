// -- Game State & AI Types ---

import type { PlayerState } from "./player";
import type { InventoryItem } from "./item";
import type { QuestInstance } from "./quest";
import type { WorldPhaseState } from "./phase";
import type { TimePeriod } from "./world";
import type { PlayerAttitude } from "./dialogue";

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
 * 更新時機：
 *   - 每次 NPC 互動後由 DialogueManager 根據 DM 信號更新
 *   - 永久里程碑由 <<MILESTONE: id>> 信號確認後寫入
 */
export interface NPCMemoryEntry {
  npcId: string;
  firstMetTurn: number;
  lastInteractedTurn: number;
  interactionCount: number;

  /**
   * 玩家對此 NPC 的態度（由 DM <<NPC: ...>> 信號更新）。
   * DM 在對話生成時參考此欄位判斷玩家的言行傾向。
   */
  playerAttitude: PlayerAttitude;

  /**
   * 上次對話的核心主題（DM <<NPC: ...>> 信號更新，1 句話）。
   * DM 用於避免重複相同的對話內容。
   */
  lastTopic?: string;

  /**
   * 永久里程碑 ID 列表。
   * 一旦記錄，對應里程碑的 permanentSummary 在未來所有對話中始終可見。
   * 由 DM <<MILESTONE: id>> 信號觸發，DialogueManager 寫入。
   */
  permanentMilestoneIds: string[];
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
    inventory: InventoryItem[];
  };
}
