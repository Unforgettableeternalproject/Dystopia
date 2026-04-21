// World phase types.
// Phases represent the five major time states of the game world.
// Phase effects cascade across multiple regions/NPCs/locations
// so they are defined centrally rather than duplicated per entity.

export type WorldPhaseId =
  | 'grace_period'
  | 'phase_1'
  | 'phase_2'
  | 'phase_3'
  | 'phase_4';

export type PhaseEffectType =
  | 'flag_set'           // set a global world flag
  | 'npc_override'       // patch an NPC's fields (dialogueId, isVisible, etc.)
  | 'npc_relocate'       // move NPC to a different location
  | 'location_restrict'  // add access condition to a location
  | 'location_open'      // remove access restriction from a location
  | 'faction_activate'   // make a faction appear / become active
  | 'region_lock';       // restrict all zone crossings for a region

export interface PhaseEffect {
  type: PhaseEffectType;
  // Fields used depending on type:
  flag?: string;
  npcId?: string;
  locationId?: string;
  factionId?: string;
  regionId?: string;        // '*' = all regions
  condition?: string;       // extra flag condition for the effect
  patch?: Record<string, unknown>;  // for npc_override / npc_relocate
}

export interface WorldPhase {
  id: WorldPhaseId;
  name: string;
  description: string;       // DM-facing: what characterises this era
  triggerFlag: string | null; // null = starting phase (grace_period)
  effects: PhaseEffect[];
}

// Runtime state stored in GameState
export interface WorldPhaseState {
  currentPhase: WorldPhaseId;
  appliedPhaseIds: WorldPhaseId[];  // phases whose effects have been applied
}
