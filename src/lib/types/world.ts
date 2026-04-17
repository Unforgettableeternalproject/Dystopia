// World / Lore entity types.
// Dialogue is a separate type (see dialogue.ts).
// Quest definitions are in quest.ts.
// World phase effects are in phase.ts.

// ── NPC ──────────────────────────────────────────────────────────

export type NPCType = 'stationed' | 'quest' | 'wandering';

// phaseOverrides: keyed by a flag expression string.
// When the flag is active, the matching patch is applied on top of the base NPC fields.
// Intended for NPC-specific personal arc changes only.
// World-wide phase changes are handled by phases.json cascade instead.
export interface NPCOverride {
  dialogueId?: string;
  isVisible?: boolean;
  baseLocationId?: string;
  description?: string;
}

export interface NPCNode {
  id: string;
  name: string;
  type: NPCType;
  baseLocationId: string;        // primary location (wandering type may change at runtime)
  factionId?: string;
  description: string;           // DM-facing character context
  dialogueId: string;            // points to dialogues/<id>.json
  questIds?: string[];
  isVisible: boolean;
  phaseOverrides?: Record<string, NPCOverride>;  // flag expression -> patch
}

// ── Location ─────────────────────────────────────────────────────

export interface LocationConnection {
  targetLocationId: string;
  condition?: string;            // flag expression; omit = always open
  description: string;           // player-facing exit label
  travelNote?: string;           // DM narration hint for the journey
}

export interface LocationBase {
  description: string;           // DM scene description
  ambience: string[];            // mood keywords for DM tone
  connections: LocationConnection[];
  npcIds: string[];
  eventIds: string[];
  isAccessible: boolean;
}

// LocalVariant: for changes scoped to this location only (e.g. mine collapse).
// Cross-location changes (e.g. region-wide lockdown) belong in phases.json.
export interface LocalVariant {
  id: string;
  label: string;
  condition: string;             // flag expression
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
  localVariants: LocalVariant[];  // local-only changes; renamed from 'variants'
}

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

// ── Event ────────────────────────────────────────────────────────

export interface EventCondition {
  flags?: string[];
  anyFlags?: string[];
  minStats?: Partial<Record<string, number>>;
}

export interface EventOutcome {
  id: string;
  condition?: string;
  description: string;
  flagsSet?: string[];
  flagsUnset?: string[];
  statChanges?: Partial<Record<string, number>>;
}

export interface GameEvent {
  id: string;
  locationId?: string;
  condition: EventCondition;
  description: string;
  outcomes: EventOutcome[];
  isRepeatable: boolean;
}

// ── Faction ──────────────────────────────────────────────────────

export interface Faction {
  id: string;
  name: string;
  regionId: string | null;    // null = cross-region (global) faction
  description: string;
  defaultReputation: number;
}

// ── Region index ─────────────────────────────────────────────────

export interface RegionIndex {
  id: string;
  name: string;
  altNames?: string[];
  theme: string;
  startingLocationId?: string;
  locationIds: string[];
  npcIds: string[];
  questIds: string[];
  factionIds: string[];
}
