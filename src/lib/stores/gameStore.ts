// Game Store — Svelte reactive state. UI layer subscribes directly.

import { writable, derived } from 'svelte/store';
import type { Thought } from '../types';
import type { HistoryEntry } from '../types/game';
import type { ScriptedChoice } from '../types/dialogue';
import type { EncounterChoice, EncounterType } from '../types/encounter';
import type { InventoryItem } from '../types/item';
import type { QuestType } from '../types/quest';

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

export function pushLine(
  text:      string,
  type:      NarrativeLine['type'] = 'narrative',
  streaming?: boolean,
): string {
  const id = 'line-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  narrativeLines.update((lines) => [
    ...lines,
    { id, text, type, isStreaming: streaming ?? (type === 'narrative') },
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

/** Rebuild narrativeLines from saved history (called on load). */
export function restoreHistoryLines(history: HistoryEntry[]): void {
  const lines: NarrativeLine[] = [];
  for (const entry of history) {
    // Skip internal engine actions that shouldn't appear in the log
    if (entry.action.input && !entry.action.input.startsWith('(')) {
      lines.push({
        id:          'hist-player-' + entry.turn,
        text:        entry.action.input,
        type:        'player',
        isStreaming: false,
      });
    }
    if (entry.narrative) {
      lines.push({
        id:          'hist-narrative-' + entry.turn,
        text:        entry.narrative,
        type:        'narrative',
        isStreaming: false,
      });
    }
  }
  narrativeLines.set(lines);
}

// ── Dialogue Encounter ─────────────────────────────────────────

export interface EncounterLogEntry {
  speaker: 'player' | 'npc';
  text: string;
}

/** Per-session exchange log; cleared when encounter ends (player moves away, END_ENCOUNTER). */
export const encounterSessionLog = writable<EncounterLogEntry[]>([]);

export function appendEncounterLog(speaker: 'player' | 'npc', text: string): void {
  encounterSessionLog.update(log => [...log, { speaker, text }]);
}

// ── Thoughts ───────────────────────────────────────────────────

export const thoughts = writable<Thought[]>([]);
export const inputDisabled = writable(false);

// ── Game phase ─────────────────────────────────────────────────

export type GamePhase = 'title' | 'naming' | 'loading' | 'playing';
export const gamePhase    = writable<GamePhase>('title');
export const isDebugMode  = writable(false);

// ── Player UI State ────────────────────────────────────────────

export interface PlayerUIState {
  name:             string;
  location:         string;
  regionName:       string;
  stamina:          number;
  staminaMax:       number;
  stress:           number;
  stressMax:        number;
  endo:             number;
  endoMax:          number;
  turn:             number;
  worldPhase?:      string;
  activeQuestCount?: number;
  conditionCount?:  number;
  time?:            string;   // "AD 1498-06-12 21:23"
  timePeriod?:      string;   // "休息時段"
  topFactions?:     Array<{ id: string; name: string; rep: number }>;
  titles?:          string[];
  activeQuestSummaries?: Array<{
    questId:    string;
    name:       string;
    type:       QuestType;
    stageSummary: string;
    objectives: Array<{ id: string; description: string; completed: boolean }>;
  }>;
  conditions?:      Array<{ label: string }>;
  melphin?:         number;
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
  endo:    0,  endoMax:    0,
  turn:    0,
});

// ── Detailed player state (for Self-check modal) ───────────────

export interface ResolvedInventoryItem {
  instanceId:   string;
  itemId:       string;
  name:         string;
  description:  string;
  type:         string;
  variantLabel?: string;
  quantity:     number;
  isExpired:    boolean;
}

export interface DetailedPlayerState {
  primaryStats:      Record<string, number>;
  secondaryStats:    Record<string, number>;
  statusStats:       Record<string, number>;
  conditions:        Array<{ label: string }>;
  titles:            string[];
  inventory:         InventoryItem[];
  resolvedInventory: ResolvedInventoryItem[];
  reputation:        Record<string, number>;
  affinity:          Record<string, number>;
  knownIntelIds:     string[];
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

// ── Active structured encounter ────────────────────────────────

export interface ActiveEncounterUI {
  encounterId:   string;
  encounterName: string;
  /** 遭遇型別，決定渲染的 UI 元件 */
  type:          EncounterType;
  /** 顯示給玩家的場景文字（displayText 或 DM 敘述） */
  nodeText:      string;
  /** 過濾後玩家可見的選項 */
  choices:       EncounterChoice[];
  /** 數值判定結果（若有的話） */
  statCheckResult?: { stat: string; threshold: number; passed: boolean };
}

export const activeEncounterUI = writable<ActiveEncounterUI | null>(null);

// ── Modal state ────────────────────────────────────────────────

export const selfCheckOpen = writable(false);
export const inventoryOpen = writable(false);
export const isSaving      = writable(false);

// Quest detail modal — set to a quest summary to open, null to close
export type QuestDetailEntry = NonNullable<PlayerUIState['activeQuestSummaries']>[number];
export const questDetailOpen    = writable<QuestDetailEntry | null>(null);

// Quest completion banner — set to quest name to trigger, cleared by the banner component
export const questCompletionBanner = writable<string | null>(null);

// ── Derived ────────────────────────────────────────────────────

export const staminaPercent = derived(
  playerUI,
  ($p) => Math.round(($p.stamina / $p.staminaMax) * 100)
);

export const stressPercent = derived(
  playerUI,
  ($p) => Math.round(($p.stress / $p.stressMax) * 100)
);

export const endoPercent = derived(
  playerUI,
  ($p) => $p.endoMax > 0 ? Math.round(($p.endo / $p.endoMax) * 100) : 0
);
