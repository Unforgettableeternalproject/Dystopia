// -- Game State & AI Types ---

import type { PlayerState } from "./player";

export interface GameState {
  player: PlayerState;
  turn: number;
  phase: GamePhase;
  pendingThoughts: Thought[];
  lastNarrative: string;
  history: HistoryEntry[];
  discoveredLocationIds: string[];
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

export interface HistoryEntry {
  turn: number;
  action: PlayerAction;
  narrative: string;
}
