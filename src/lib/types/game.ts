// -- Game State & AI Types ---

import type { PlayerState } from "./player";
import type { QuestInstance } from "./quest";
import type { WorldPhaseState } from "./phase";
import type { TimePeriod } from "./world";

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
 * 讓 DM 知道玩家與這個角色的關係歷史，避免對話重複或矛盾。
 */
export interface NPCMemoryEntry {
  npcId: string;
  firstMetTurn: number;
  lastInteractedTurn: number;
  interactionCount: number;
  /** 已完整跑完的對話樹 ID */
  completedDialogueIds: string[];
  /**
   * 玩家做過的重要選擇 ID（對應 DialogueTree 中的 PlayerChoiceOption.id）。
   * DM 建構場景時可參考這些選擇，讓 NPC 對過去的行為有記憶。
   */
  keyChoiceIds: string[];
  /** 可續接的對話節點；undefined = 從頭開始 */
  lastDialogueNodeId?: string;
}

/**
 * 當前進行中的對話狀態。
 * 存在於 GameState 當 phase === "dialogue" 時。
 */
export interface ActiveDialogueState {
  npcId: string;
  dialogueId: string;
  currentNodeId: string;
}
