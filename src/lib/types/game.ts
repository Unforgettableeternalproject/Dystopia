// ── Game State & AI Types ─────────────────────────────────────

import type { PlayerState } from './player';

/** 完整遊戲狀態快照 */
export interface GameState {
  player: PlayerState;
  turn: number;
  phase: GamePhase;
  pendingThoughts: Thought[]; // 規制器產生的建議動作
  lastNarrative: string;      // DM 最後輸出的敘述
  history: HistoryEntry[];    // 最近的行動紀錄（給 DM 作為上下文）
}

/** 遊戲階段 */
export type GamePhase =
  | 'exploring'   // 自由探索
  | 'dialogue'    // 與 NPC 對話中
  | 'event'       // 事件進行中
  | 'combat'      // 戰鬥（MVP 後）
  | 'ending';     // 結局觸發

/** Thought — 規制器給玩家的建議動作 */
export interface Thought {
  id: string;
  text: string;              // 顯示給玩家的建議文字
  actionType: ActionType;
  isManipulated?: boolean;   // 若為 true 表示此 Thought 可能被外力影響（遊戲機制）
}

/** 動作類型 */
export type ActionType =
  | 'move'        // 移動到另一地點
  | 'interact'    // 與 NPC 或物件互動
  | 'examine'     // 觀察環境
  | 'use'         // 使用道具
  | 'rest'        // 休息
  | 'free';       // 自由輸入（不在 Thought 列表中）

/** 玩家動作 */
export interface PlayerAction {
  type: ActionType;
  input: string;             // 玩家原始輸入
  targetId?: string;         // 目標 NPC/地點/物件 ID
}

/** 規制器判定結果 */
export interface RegulatorResult {
  allowed: boolean;
  reason?: string;           // 若拒絕，說明原因
  modifiedAction?: PlayerAction; // 規制器修正後的動作（能力不足時降級）
}

/** DM 回應 */
export interface DMResponse {
  narrative: string;         // 主要敘述文字（串流）
  thoughts: Thought[];       // 建議的後續動作
  flagsTriggered: string[];  // 本次回應觸發的旗標
  stateChanges?: Partial<GameState>; // 狀態變化摘要
}

/** 歷史紀錄條目 */
export interface HistoryEntry {
  turn: number;
  action: PlayerAction;
  narrative: string;         // DM 當時的回應摘要
}
