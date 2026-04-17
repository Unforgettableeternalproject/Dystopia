// Game Store — Svelte reactive state. UI layer subscribes directly.

import { writable, derived, get } from 'svelte/store';
import type { Thought, ActionType } from '../types';

// ── Narrative Lines ────────────────────────────────────────────

export interface NarrativeLine {
  id: string;
  text: string;
  type: 'narrative' | 'system' | 'player' | 'rejected';
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

// ── Player UI State ────────────────────────────────────────────

export interface PlayerUIState {
  name: string;
  location: string;
  stamina: number;
  staminaMax: number;
  stress: number;
  stressMax: number;
  turn: number;
  worldPhase?: string;
  activeQuestCount?: number;
  conditionCount?: number;
}

export const playerUI = writable<PlayerUIState>({
  name: '???',
  location: '???',
  stamina: 10,
  staminaMax: 10,
  stress: 0,
  stressMax: 10,
  turn: 0,
});

// ── Derived ────────────────────────────────────────────────────

export const staminaPercent = derived(
  playerUI,
  ($p) => Math.round(($p.stamina / $p.staminaMax) * 100)
);

export const stressPercent = derived(
  playerUI,
  ($p) => Math.round(($p.stress / $p.stressMax) * 100)
);
