// TraceStore — per-turn structured trace for the debug console.
// Uses BroadcastChannel so the /console route (independent window) can subscribe.

import { writable, get } from 'svelte/store';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TracePhase {
  name:       string;   // e.g. 'input', 'regulator', 'context', 'dm-phase1', 'judge', 'dm-phase2', 'effects', 'error'
  timestamp:  number;
  data:       unknown;  // structured payload — action object, resolution, context string, etc.
  raw?:       string;   // raw LLM response text (before parsing)
  error?:     string;   // parse error message if applicable
}

export interface TraceEntry {
  id:         number;
  timestamp:  number;
  turn:       number;
  type:       'exploration' | 'dialogue' | 'event' | 'system';
  label:      string;   // human-readable one-liner, e.g. "explore: look around" or "dialogue: Mira"
  locationId?: string;
  npcId?:     string;
  phases:     TracePhase[];
}

// ── Store ────────────────────────────────────────────────────────────────────

const MAX_TRACES = 200;
let seq = 0;

export const traceEntries = writable<TraceEntry[]>([]);

// BroadcastChannel for cross-window sync (main window → /console window)
const CHANNEL_NAME = 'dystopia-trace';
let bc: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (bc) return bc;
  try {
    bc = new BroadcastChannel(CHANNEL_NAME);
    return bc;
  } catch {
    return null; // SSR or unsupported
  }
}

function broadcast(msg: { type: string; payload?: unknown }): void {
  getBroadcastChannel()?.postMessage(msg);
}

// ── Mutation API (used by GameController in main window) ─────────────────────

/** Start a new trace entry for this turn. Returns the trace id. */
export function startTrace(
  turn: number,
  type: TraceEntry['type'],
  label: string,
  extra?: { locationId?: string; npcId?: string },
): number {
  const id = seq++;
  const entry: TraceEntry = {
    id,
    timestamp: Date.now(),
    turn,
    type,
    label,
    locationId: extra?.locationId,
    npcId:      extra?.npcId,
    phases:     [],
  };
  traceEntries.update(list => {
    const next = [...list, entry];
    return next.length > MAX_TRACES ? next.slice(next.length - MAX_TRACES) : next;
  });
  broadcast({ type: 'add', payload: entry });
  return id;
}

/** Update the label of an existing trace entry (e.g. after Regulator reclassifies). */
export function updateTraceLabel(traceId: number, label: string): void {
  traceEntries.update(list =>
    list.map(e => e.id === traceId ? { ...e, label } : e),
  );
  broadcast({ type: 'label', payload: { traceId, label } });
}

/** Append a phase to an existing trace entry. */
export function addTracePhase(
  traceId: number,
  name: string,
  data: unknown,
  extra?: { raw?: string; error?: string },
): void {
  const phase: TracePhase = {
    name,
    timestamp: Date.now(),
    data,
    raw:   extra?.raw,
    error: extra?.error,
  };
  traceEntries.update(list =>
    list.map(e => e.id === traceId ? { ...e, phases: [...e.phases, phase] } : e),
  );
  broadcast({ type: 'phase', payload: { traceId, phase } });
}

/** Clear all trace entries. */
export function clearTraces(): void {
  traceEntries.set([]);
  broadcast({ type: 'clear' });
}

/** Export all traces as a JSON string. */
export function exportTraces(): string {
  const entries = get(traceEntries);
  return JSON.stringify(entries, null, 2);
}

// ── Receiver API (used by /console route in separate window) ─────────────────

/** Subscribe to trace events from the main window. Call once in /console onMount. */
export function listenForTraces(): (() => void) {
  const channel = getBroadcastChannel();
  if (!channel) return () => {};

  const handler = (ev: MessageEvent) => {
    const msg = ev.data as { type: string; payload?: unknown };
    switch (msg.type) {
      case 'add': {
        const entry = msg.payload as TraceEntry;
        traceEntries.update(list => {
          const next = [...list, entry];
          return next.length > MAX_TRACES ? next.slice(next.length - MAX_TRACES) : next;
        });
        break;
      }
      case 'phase': {
        const { traceId, phase } = msg.payload as { traceId: number; phase: TracePhase };
        traceEntries.update(list =>
          list.map(e => e.id === traceId ? { ...e, phases: [...e.phases, phase] } : e),
        );
        break;
      }
      case 'label': {
        const { traceId, label } = msg.payload as { traceId: number; label: string };
        traceEntries.update(list =>
          list.map(e => e.id === traceId ? { ...e, label } : e),
        );
        break;
      }
      case 'clear':
        traceEntries.set([]);
        break;
      case 'sync':
        traceEntries.set(msg.payload as TraceEntry[]);
        break;
    }
  };

  channel.addEventListener('message', handler);
  // Request full state from main window
  broadcast({ type: 'request-sync' });

  return () => channel.removeEventListener('message', handler);
}

/** Listen for sync requests from the console window (call in main window). */
export function listenForSyncRequests(): (() => void) {
  const channel = getBroadcastChannel();
  if (!channel) return () => {};

  const handler = (ev: MessageEvent) => {
    const msg = ev.data as { type: string };
    if (msg.type === 'request-sync') {
      broadcast({ type: 'sync', payload: get(traceEntries) });
    }
  };

  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}
