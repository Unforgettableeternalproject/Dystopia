// -- World / Lore Types ---

export type NPCType = "stationed" | "quest" | "wandering";

export interface NPCNode {
  id: string;
  name: string;
  type: NPCType;
  locationId: string;
  factionId?: string;
  description: string;
  dialogue: DialogueLine[];
  questIds?: string[];
  isVisible: boolean;
}

export interface DialogueLine {
  id: string;
  condition?: string;
  text: string;
  triggers?: string[];
  nextDialogueId?: string;
}

export interface LocationConnection {
  targetLocationId: string;
  condition?: string;
  description: string;
  travelNote?: string;
}

export interface LocationBase {
  description: string;
  ambience: string[];
  connections: LocationConnection[];
  npcIds: string[];
  eventIds: string[];
  isAccessible: boolean;
}

// LocationVariant: applied on top of base when condition (flag expression) is true.
// Rules:
//   - All active variants are sorted by priority (ascending) and applied in order
//   - Higher priority overwrites lower priority
//   - connections: full replacement (not merged)
//   - npcIds / eventIds: additive/subtractive via addNpcIds / removeNpcIds
//   - Other fields: only replace if defined (undefined = keep current value)
export interface LocationVariant {
  id: string;
  label: string;
  condition: string;
  priority: number;
  description?: string;
  ambience?: string[];
  connections?: LocationConnection[];
  isAccessible?: boolean;
  addNpcIds?: string[];
  removeNpcIds?: string[];
  addEventIds?: string[];
  removeEventIds?: string[];
  transitionNote?: string;
}

export interface LocationNode {
  id: string;
  name: string;
  regionId: string;
  tags: string[];
  base: LocationBase;
  variants: LocationVariant[];
}

// ResolvedLocation: computed by LoreVault.resolveLocation() from LocationNode + active flags
export interface ResolvedLocation {
  id: string;
  name: string;
  regionId: string;
  tags: string[];
  description: string;
  ambience: string[];
  connections: LocationConnection[];
  npcIds: string[];
  eventIds: string[];
  isAccessible: boolean;
  activeVariants: string[];
  transitionNotes: string[];
}

export interface EventCondition {
  flags?: string[];
  anyFlags?: string[];
  minStats?: Partial<Record<string, number>>;
}

export interface GameEvent {
  id: string;
  locationId?: string;
  condition: EventCondition;
  description: string;
  outcomes: EventOutcome[];
  isRepeatable: boolean;
}

export interface EventOutcome {
  id: string;
  condition?: string;
  description: string;
  flagsSet?: string[];
  flagsUnset?: string[];
  statChanges?: Partial<Record<string, number>>;
}

export interface Faction {
  id: string;
  name: string;
  regionId: string;
  description: string;
  defaultReputation: number;
}
