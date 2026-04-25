// SaveManager — persists game saves to the app's local data directory via Tauri plugin-fs.
// Falls back to localStorage when running in a browser (non-Tauri) environment.
//
// Tauri directory layout (BaseDirectory.AppLocalData):
//   saves/manifest.json      — slot metadata index (no decoding needed to list saves)
//   saves/slot_0.dys         — auto-save slot
//   saves/slot_1.dys         — manual slot 1
//   ...
//   saves/slot_5.dys         — manual slot 5
//
// localStorage layout:
//   dystopia_manifest         — JSON array of SlotMeta | null (length TOTAL_SLOTS)
//   dystopia_slot_0           — JSON SaveFile string
//   ...
//   dystopia_slot_5           — JSON SaveFile string
//
// Each .dys file / localStorage value is a JSON SaveFile envelope: { meta, data: "DYS1:..." }

import {
  readTextFile, writeTextFile,
  exists, mkdir, remove,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import { encode, decode } from './SaveCodec';
import type { DecodeResult } from './SaveCodec';
import type { GameState } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────

const BASE        = BaseDirectory.AppLocalData;
const SAVES_DIR   = 'saves';
const MANIFEST    = 'saves/manifest.json';
export const AUTO_SLOT    = 0;
export const MANUAL_SLOTS = [1, 2, 3, 4, 5] as const;
export const TOTAL_SLOTS  = 6;

// ── Platform detection ────────────────────────────────────────────────────

const IS_TAURI: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ── Types ─────────────────────────────────────────────────────────────────

/** Metadata shown in the save/load UI — stored in manifest and embedded in each .dys file. */
export interface SlotMeta {
  slotId:           number;   // 0 = auto-save, 1–5 = manual
  label?:           string;   // user-provided name
  ts:               number;   // unix timestamp (ms)
  turn:             number;
  locationName:     string;   // human-readable location at save time
  worldTime:        string;   // "AD 1498-06-12 21:23"
  worldPhase:       string;   // e.g. "grace_period"
  activeQuestCount: number;
  lastNarrative:    string;   // first ~120 chars of last DM narrative
}

/** Contents of each .dys save file. */
export interface SaveFile {
  meta: SlotMeta;
  data: string;    // DYS1:... codec string
}

// ── Tauri helpers ─────────────────────────────────────────────────────────

function slotPath(slotId: number): string {
  return `${SAVES_DIR}/slot_${slotId}.dys`;
}

async function ensureSavesDir(): Promise<void> {
  if (!(await exists(SAVES_DIR, { baseDir: BASE }))) {
    await mkdir(SAVES_DIR, { baseDir: BASE, recursive: true });
  }
}

async function readManifest(): Promise<(SlotMeta | null)[]> {
  try {
    if (!(await exists(MANIFEST, { baseDir: BASE }))) {
      return Array<SlotMeta | null>(TOTAL_SLOTS).fill(null);
    }
    const raw = await readTextFile(MANIFEST, { baseDir: BASE });
    return JSON.parse(raw) as (SlotMeta | null)[];
  } catch {
    return Array<SlotMeta | null>(TOTAL_SLOTS).fill(null);
  }
}

async function writeManifest(slots: (SlotMeta | null)[]): Promise<void> {
  await writeTextFile(MANIFEST, JSON.stringify(slots, null, 2), { baseDir: BASE });
}

// ── localStorage helpers ──────────────────────────────────────────────────

const LS_MANIFEST  = 'dystopia_manifest';
const LS_SLOT      = (id: number) => `dystopia_slot_${id}`;

function lsReadManifest(): (SlotMeta | null)[] {
  try {
    const raw = localStorage.getItem(LS_MANIFEST);
    if (!raw) return Array<SlotMeta | null>(TOTAL_SLOTS).fill(null);
    return JSON.parse(raw) as (SlotMeta | null)[];
  } catch {
    return Array<SlotMeta | null>(TOTAL_SLOTS).fill(null);
  }
}

function lsWriteManifest(slots: (SlotMeta | null)[]): void {
  localStorage.setItem(LS_MANIFEST, JSON.stringify(slots));
}

function lsReadSlot(slotId: number): SaveFile | null {
  try {
    const raw = localStorage.getItem(LS_SLOT(slotId));
    if (!raw) return null;
    return JSON.parse(raw) as SaveFile;
  } catch {
    return null;
  }
}

function lsWriteSlot(slotId: number, file: SaveFile): void {
  localStorage.setItem(LS_SLOT(slotId), JSON.stringify(file));
}

function lsDeleteSlot(slotId: number): void {
  localStorage.removeItem(LS_SLOT(slotId));
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * List all save slots.
 * Returns an array of length TOTAL_SLOTS; null entries are empty slots.
 * Index 0 = auto-save, 1–5 = manual.
 */
export async function listSlots(): Promise<(SlotMeta | null)[]> {
  if (!IS_TAURI) return lsReadManifest();
  return readManifest();
}

/**
 * Save the current game state to a slot.
 * Call GameController.save() rather than this directly.
 */
export async function saveSlot(
  slotId:       number,
  gs:           Readonly<GameState>,
  flags:        string[],
  locationName: string,
  worldTime:    string,
  label?:       string,
): Promise<void> {
  const meta: SlotMeta = {
    slotId,
    label,
    ts:               Date.now(),
    turn:             gs.turn,
    locationName,
    worldTime,
    worldPhase:       gs.worldPhase.currentPhase,
    activeQuestCount: Object.values(gs.activeQuests)
      .filter(q => !q.isCompleted && !q.isFailed)
      .length,
    lastNarrative:    gs.lastNarrative.slice(0, 120).replace(/\n+/g, ' '),
  };

  const data     = await encode(gs, flags);
  const saveFile: SaveFile = { meta, data };

  if (!IS_TAURI) {
    lsWriteSlot(slotId, saveFile);
    const manifest = lsReadManifest();
    while (manifest.length < TOTAL_SLOTS) manifest.push(null);
    manifest[slotId] = meta;
    lsWriteManifest(manifest);
    return;
  }

  await ensureSavesDir();
  await writeTextFile(slotPath(slotId), JSON.stringify(saveFile, null, 2), { baseDir: BASE });

  const manifest = await readManifest();
  while (manifest.length < TOTAL_SLOTS) manifest.push(null);
  manifest[slotId] = meta;
  await writeManifest(manifest);
}

/**
 * Load a slot and decode it.
 * Throws if the slot file doesn't exist or the codec is invalid.
 */
export async function loadSlot(slotId: number): Promise<DecodeResult> {
  if (!IS_TAURI) {
    const file = lsReadSlot(slotId);
    if (!file) throw new Error(`Save slot ${slotId} is empty`);
    return decode(file.data);
  }

  const path = slotPath(slotId);
  if (!(await exists(path, { baseDir: BASE }))) {
    throw new Error(`Save slot ${slotId} is empty`);
  }
  const raw      = await readTextFile(path, { baseDir: BASE });
  const saveFile = JSON.parse(raw) as SaveFile;
  return decode(saveFile.data);
}

/** Delete a save slot. */
export async function deleteSlot(slotId: number): Promise<void> {
  if (!IS_TAURI) {
    lsDeleteSlot(slotId);
    const manifest = lsReadManifest();
    if (manifest[slotId] !== undefined) {
      manifest[slotId] = null;
      lsWriteManifest(manifest);
    }
    return;
  }

  const path = slotPath(slotId);
  if (await exists(path, { baseDir: BASE })) {
    await remove(path, { baseDir: BASE });
  }
  const manifest = await readManifest();
  if (manifest[slotId] !== undefined) {
    manifest[slotId] = null;
    await writeManifest(manifest);
  }
}

/**
 * Export a slot as a raw JSON string.
 * The string is a complete SaveFile envelope — suitable for writing to disk or clipboard.
 */
export async function exportSlot(slotId: number): Promise<string> {
  if (!IS_TAURI) {
    const file = lsReadSlot(slotId);
    if (!file) throw new Error(`Save slot ${slotId} is empty`);
    return JSON.stringify(file, null, 2);
  }

  const path = slotPath(slotId);
  if (!(await exists(path, { baseDir: BASE }))) {
    throw new Error(`Save slot ${slotId} is empty`);
  }
  return readTextFile(path, { baseDir: BASE });
}

/**
 * Import a save from a raw JSON string (produced by exportSlot) into a slot.
 * Validates the codec before writing.
 */
export async function importSlot(fileContent: string, slotId: number): Promise<void> {
  let saveFile: SaveFile;
  try {
    saveFile = JSON.parse(fileContent) as SaveFile;
  } catch {
    throw new Error('Invalid save file: not valid JSON');
  }

  // Validate the embedded codec string (will throw on bad data)
  await decode(saveFile.data);

  // Restamp slotId and ts to match the target slot
  saveFile.meta.slotId = slotId;

  if (!IS_TAURI) {
    lsWriteSlot(slotId, saveFile);
    const manifest = lsReadManifest();
    while (manifest.length < TOTAL_SLOTS) manifest.push(null);
    manifest[slotId] = saveFile.meta;
    lsWriteManifest(manifest);
    return;
  }

  await ensureSavesDir();
  await writeTextFile(slotPath(slotId), JSON.stringify(saveFile, null, 2), { baseDir: BASE });

  const manifest = await readManifest();
  while (manifest.length < TOTAL_SLOTS) manifest.push(null);
  manifest[slotId] = saveFile.meta;
  await writeManifest(manifest);
}
