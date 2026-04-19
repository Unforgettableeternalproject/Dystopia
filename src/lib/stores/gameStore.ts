// Game Store — Svelte reactive state. UI layer subscribes directly.

import { writable, derived } from 'svelte/store';
import type { Thought } from '../types';
import type { ScriptedChoice } from '../types/dialogue';

// ── Narrative Lines ────────────────────────────────────────────

export interface NarrativeLine {
  id: string;
  text: string;
  /** narrative = DM free text | dialogue = scripted NPC line | player = player input
   *  system = info message | rejected = regulator rejection */
  type: 'narrative' | 'dialogue' | 'system' | 'player' | 'rejected';
  isStreaming: boolean;
}

export const narrativeLines = writable<NarrativeLine[]>([]);
export const isStreaming = writable(false);

export function pushLine(text: string, type: NarrativeLine['type'] = 'narrative'): string {
  const id = 'line-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  narrativeLines.update((lines) => [
    ...lines,
    { id, text, type, isStreaming: type === 'narrative' },
  ]);
  return id;
}

export function appendToLastLine(chunk: string): void {
  narrativeLines.update((lines) => {
    if (lines.length === 0) return lines;
    const last = lines[lines.length - 1];
    return [...lines.slice(0, -1), { ...last, text: last.text + chunk }];
  });
}

export function finishLastLine(): void {
  narrativeLines.update((lines) => {
    if (lines.length === 0) return lines;
    const last = lines[lines.length - 1];
    return [...lines.slice(0, -1), { ...last, isStreaming: false }];
  });
}

// ── Thoughts ───────────────────────────────────────────────────

export const thoughts = writable<Thought[]>([]);
export const inputDisabled = writable(false);

// ── Game phase ─────────────────────────────────────────────────

export type GamePhase = 'title' | 'naming' | 'loading' | 'playing';
export const gamePhase = writable<GamePhase>('title');

// ── Player UI State ────────────────────────────────────────────

export interface PlayerUIState {
  name:             string;
  location:         string;
  regionName:       string;
  stamina:          number;
  staminaMax:       number;
  stress:           number;
  stressMax:        number;
  mana:             number;
  manaMax:          number;
  turn:             number;
  worldPhase?:      string;
  activeQuestCount?: number;
  conditionCount?:  number;
  time?:            string;   // "AD 1498-06-12 21:23"
  timePeriod?:      string;   // "休息時段"
  topFactions?:     Array<{ id: string; name: string; rep: number }>;
  titles?:          string[];
  activeQuestSummaries?: Array<{ name: string; stageSummary: string }>;
  conditions?:      Array<{ label: string }>;
  /** Structured data for the SVG mini-map (current area). */
  miniMap?:         MiniMapData;
  /** Structured data for the full region map modal. */
  regionMap?:       RegionMapData;
}

// ── Map data types ─────────────────────────────────────────────

export interface MiniMapNode {
  id:          string;
  label:       string;
  isCurrent:   boolean;
  isDiscovered: boolean;
  /** IDs of connected nodes that are also within the same area. */
  connections: string[];
  /** True if this node is the area-level parent (vs a sublocation). */
  isArea:      boolean;
}

export interface MiniMapData {
  areaId:       string;
  areaName:     string;
  districtId:   string;
  districtName: string;
  nodes:        MiniMapNode[];
}

export interface DistrictMapNode {
  id:          string;
  label:       string;
  isCurrent:   boolean;
  adjacentIds: string[];
  /** Area nodes — only populated for the current district. */
  areas?: Array<{
    id:          string;
    name:        string;
    isDiscovered: boolean;
    isCurrent:   boolean;
  }>;
}

export interface RegionMapData {
  regionId:          string;
  regionName:        string;
  currentDistrictId: string;
  districts:         DistrictMapNode[];
}

export const playerUI = writable<PlayerUIState>({
  name:       '???',
  location:   '???',
  regionName: '???',
  stamina: 10, staminaMax: 10,
  stress:  0,  stressMax:  10,
  mana:    0,  manaMax:    0,
  turn:    0,
});

// ── Detailed player state (for Self-check modal) ───────────────

export interface DetailedPlayerState {
  primaryStats:   Record<string, number>;
  secondaryStats: Record<string, number>;
  statusStats:    Record<string, number>;
  conditions:     Array<{ label: string }>;
  titles:         string[];
  inventory:      string[];
  reputation:     Record<string, number>;
  affinity:       Record<string, number>;
  knownIntelIds:  string[];
}

export const detailedPlayer = writable<DetailedPlayerState | null>(null);

// ── Active NPC (during dialogue) ───────────────────────────────

export interface ActiveNpcUIState {
  npcId:            string;
  name:             string;
  type:             string;
  publicDescription: string;
  affinity:         number;
  attitude:         string;
  interactionCount: number;
}

export const activeNpcUI = writable<ActiveNpcUIState | null>(null);

// ── Active scripted dialogue ───────────────────────────────────

export interface ActiveScriptedDialogue {
  npcId:              string;
  npcName:            string;
  dialogueId:         string;
  currentNodeId:      string;
  currentChoices:     ScriptedChoice[];  // filtered by flag conditions
  collectedNarrative: string;            // accumulated for history
}

export const activeScriptedDialogue = writable<ActiveScriptedDialogue | null>(null);

// ── Modal state ────────────────────────────────────────────────

export const selfCheckOpen = writable(false);
export const inventoryOpen = writable(false);
export const isSaving      = writable(false);

// ── Derived ────────────────────────────────────────────────────

export const staminaPercent = derived(
  playerUI,
  ($p) => Math.round(($p.stamina / $p.staminaMax) * 100)
);

export const stressPercent = derived(
  playerUI,
  ($p) => Math.round(($p.stress / $p.stressMax) * 100)
);

export const manaPercent = derived(
  playerUI,
  ($p) => $p.manaMax > 0 ? Math.round(($p.mana / $p.manaMax) * 100) : 0
);
