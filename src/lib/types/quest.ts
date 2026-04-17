// Quest definition types.
// QuestDefinition = authored content (in lore files).
// Player progress (current stage, completed objectives) lives in GameState.

export type QuestType = 'main' | 'side' | 'hidden';

export type ObjectiveType =
  | 'flag_check'      // a flag must be set
  | 'location_visit'  // player must visit a location
  | 'npc_talk'        // player must talk to an NPC
  | 'item_collect';   // player must have an item

export interface QuestObjective {
  id: string;
  type: ObjectiveType;
  description: string;    // player-visible
  flag?: string;
  locationId?: string;
  npcId?: string;
  itemId?: string;
}

export interface QuestStageOutcome {
  flagsSet?: string[];
  flagsUnset?: string[];
  statChanges?: Record<string, number>;
  nextStageId: string | null;  // null = quest complete
}

export interface QuestStage {
  id: string;
  description: string;         // player-visible stage label
  objectives: QuestObjective[];
  onComplete: QuestStageOutcome;
}

export interface QuestReward {
  experience?: number;
  items?: string[];
  flags?: string[];
  reputationChanges?: Record<string, number>;  // factionId -> delta
}

export interface QuestDefinition {
  id: string;
  name: string;
  type: QuestType;
  giverNpcId?: string;
  regionId?: string;          // null = cross-region
  entryStageId: string;       // ID of the first stage
  stages: Record<string, QuestStage>;
  rewards?: QuestReward;
}

// Runtime instance stored in GameState
export interface QuestInstance {
  questId: string;
  currentStageId: string | null;   // null = completed
  completedObjectiveIds: string[];
  isCompleted: boolean;
  isFailed: boolean;
}
