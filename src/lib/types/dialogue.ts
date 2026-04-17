// Dialogue tree types — stored separately from NPC definitions.
// A tree is a node graph; nodes reference each other by ID.

export type DialogueNodeType =
  | 'npc_line'       // NPC speaks, then auto-advances or shows choices
  | 'player_choice'  // branch point driven by player selection
  | 'condition'      // invisible fork based on flag/stat expression
  | 'trigger'        // silent node that applies effects then advances
  | 'end';           // terminates dialogue

export interface DialogueEffect {
  type: 'flag_set' | 'flag_unset' | 'stat_change' | 'start_quest' | 'advance_quest';
  flag?: string;
  stat?: string;      // format: "group.field", e.g. "primaryStats.strength"
  delta?: number;
  questId?: string;
}

export interface PlayerChoiceOption {
  text: string;           // shown to player
  condition?: string;     // flag expression; hide option if false
  next: string;           // target node ID
  effects?: DialogueEffect[];
}

export interface NPCLineNode {
  id: string;
  type: 'npc_line';
  speakerId: string;       // NPC ID
  text: string;
  effects?: DialogueEffect[];
  // if choices present: show choice panel. if absent: auto-advance to next.
  choices?: PlayerChoiceOption[];
  next?: string | null;    // used when no choices; null = end
}

export interface ConditionNode {
  id: string;
  type: 'condition';
  condition: string;       // flag expression
  ifTrue: string;          // node ID
  ifFalse: string;         // node ID
}

export interface TriggerNode {
  id: string;
  type: 'trigger';
  effects: DialogueEffect[];
  next: string | null;
}

export interface EndNode {
  id: string;
  type: 'end';
}

export type AnyDialogueNode =
  | NPCLineNode
  | ConditionNode
  | TriggerNode
  | EndNode;

export interface DialogueTree {
  id: string;
  entryNode: string;                         // ID of starting node
  nodes: Record<string, AnyDialogueNode>;
}
