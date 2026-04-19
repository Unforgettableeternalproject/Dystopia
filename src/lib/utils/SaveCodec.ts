// SaveCodec -- encode/decode the full game state as a compact string.
//
// Format:  DYS1:<base64url(gzip(JSON))>
//
// The "DYS1:" prefix carries the schema version so we can migrate saves
// in future releases without breaking existing codes.
//
// Usage:
//   const code = await SaveCodec.encode(gameState, flagArray);
//   const { state, flags } = await SaveCodec.decode(code);

import type { GameState, HistoryEntry, PlayerAction, GameTime, GamePhase } from '../types';
import type { PlayerState, PlayerCondition }                               from '../types/player';
import type { QuestInstance }                                              from '../types/quest';
import type { NPCMemoryEntry, ActiveDialogueState }                        from '../types/game';
import type { WorldPhaseState }                                            from '../types/phase';
import type { TimePeriod }                                                 from '../types/world';

const SAVE_PREFIX  = 'DYS1:';
const SAVE_VERSION = 1;

// ── Snapshot shape (serialised -- Set converted to string[]) ─────────────

export interface SaveSnapshot {
  v:                    number;         // schema version
  ts:                   number;         // unix ms timestamp
  turn:                 number;
  phase:                GamePhase;
  lastNarrative:        string;
  history:              HistoryEntry[];
  discoveredLocationIds: string[];
  activeQuests:         Record<string, QuestInstance>;
  completedQuestIds:    string[];
  npcMemory:            Record<string, NPCMemoryEntry>;
  worldPhase:           WorldPhaseState;
  player:               SerializedPlayer;
  flags:                string[];       // FlagSystem.toArray()
  time:                 GameTime;
  timePeriod:           TimePeriod;
  eventCooldowns:       Record<string, number>;
}

// PlayerState with activeFlags serialised as string[] instead of Set
type SerializedPlayer = Omit<PlayerState, 'activeFlags'> & { activeFlags: string[] };

// ── Encode ───────────────────────────────────────────────────────────────

export async function encode(gs: Readonly<GameState>, flags: string[]): Promise<string> {
  const snapshot: SaveSnapshot = {
    v:                    SAVE_VERSION,
    ts:                   Date.now(),
    turn:                 gs.turn,
    phase:                gs.phase,
    lastNarrative:        gs.lastNarrative,
    // Keep last 20 history entries only
    history:              gs.history.slice(-20),
    discoveredLocationIds: gs.discoveredLocationIds,
    activeQuests:         gs.activeQuests,
    completedQuestIds:    gs.completedQuestIds,
    npcMemory:            gs.npcMemory,
    worldPhase:           gs.worldPhase,
    // Serialise Set -> array
    player: {
      ...gs.player,
      activeFlags: Array.from(gs.player.activeFlags),
    },
    flags,
    time:           gs.time,
    timePeriod:     gs.timePeriod,
    eventCooldowns: gs.eventCooldowns,
  };

  const json       = JSON.stringify(snapshot);
  const compressed = await gzip(json);
  return SAVE_PREFIX + toBase64url(compressed);
}

// ── Decode ───────────────────────────────────────────────────────────────

export interface DecodeResult {
  snapshot: SaveSnapshot;
  /** Reconstructed GameState (activeDialogue and pendingThoughts reset to defaults) */
  state:    GameState;
  /** Flags as string[] -- pass to FlagSystem constructor */
  flags:    string[];
}

export async function decode(code: string): Promise<DecodeResult> {
  if (!code.startsWith(SAVE_PREFIX)) {
    throw new Error('Invalid save code: missing version prefix');
  }

  const b64        = code.slice(SAVE_PREFIX.length);
  const compressed = fromBase64url(b64);
  const json       = await gunzip(compressed);
  const snapshot   = JSON.parse(json) as SaveSnapshot;

  if (snapshot.v !== SAVE_VERSION) {
    throw new Error(`Unsupported save version: ${snapshot.v} (expected ${SAVE_VERSION})`);
  }

  // Deserialise array -> Set; add fallbacks for fields added after save version 1
  const player: PlayerState = {
    ...snapshot.player,
    activeFlags:   new Set(snapshot.player.activeFlags),
    knownIntelIds: snapshot.player.knownIntelIds ?? [],
  };

  const state: GameState = {
    player,
    turn:                  snapshot.turn,
    phase:                 snapshot.phase,
    lastNarrative:         snapshot.lastNarrative,
    history:               snapshot.history,
    discoveredLocationIds: snapshot.discoveredLocationIds,
    // Patch localFlags for saves from before quest-local flags were added
    activeQuests: Object.fromEntries(
      Object.entries(snapshot.activeQuests).map(([id, q]) => [
        id, { localFlags: [], ...q },
      ])
    ),
    completedQuestIds:     snapshot.completedQuestIds,
    npcMemory:             snapshot.npcMemory,
    worldPhase:            snapshot.worldPhase,
    pendingThoughts:       [],     // transient -- reset on load
    activeDialogue:        undefined,
    // Fallbacks for saves from before time system was added
    time:           snapshot.time           ?? { year: 1498, month: 6, day: 12, hour: 21, minute: 23, totalMinutes: 0 },
    timePeriod:     snapshot.timePeriod     ?? 'rest',
    eventCooldowns: snapshot.eventCooldowns ?? {},
  };

  return { snapshot, state, flags: snapshot.flags };
}

// ── Compression helpers (browser CompressionStream API) ──────────────────

async function gzip(text: string): Promise<Uint8Array> {
  const input  = new TextEncoder().encode(text);
  // Pipe through CompressionStream with read/write in parallel (required for TransformStream).
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(input); c.close(); },
  }).pipeThrough(new CompressionStream('gzip'));
  return collectStream(stream);
}

async function gunzip(data: Uint8Array): Promise<string> {
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(data); c.close(); },
  }).pipeThrough(new DecompressionStream('gzip'));
  const raw = await collectStream(stream);
  return new TextDecoder().decode(raw);
}

async function collectStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total  = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let   offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ── Base64url (no padding, URL-safe) ─────────────────────────────────────

function toBase64url(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function fromBase64url(str: string): Uint8Array {
  const padded = str
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad    = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(pad));
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    result[i] = binary.charCodeAt(i);
  }
  return result;
}
