// Game Store — Svelte reactive state. UI layer subscribes directly.

import { writable, derived } from 'svelte/store';
import type { Thought } from '../types';
import type { GameState, HistoryEntry, ShadowComparison } from '../types/game';
import type { ScriptedChoice } from '../types/dialogue';
import type { EncounterChoice, EncounterType, ScriptLine } from '../types/encounter';
import type { InventoryItem } from '../types/item';
import type { QuestType } from '../types/quest';
import type { RollResult } from '../engine/DiceEngine';

// ── Narrative Lines ────────────────────────────────────────────

export interface NarrativeLine {
  id: string;
  text: string;
  /** narrative = DM free text | dialogue = scripted NPC line | player = player action input
   *  player-dialogue = player speech inside NPC encounter (rendered with 「」)
   *  system = info message | rejected = regulator rejection | event = game event trigger
   *  scene = story encounter description (gray, stage-direction style) */
  type: 'narrative' | 'dialogue' | 'system' | 'player' | 'player-dialogue' | 'rejected' | 'event' | 'scene';
  isStreaming: boolean;
}

export const narrativeLines = writable<NarrativeLine[]>([]);
export const isStreaming = writable(false);

// ── Rewind / Edit-Last-Action ──────────────────────────────────

export interface PreviousSnapshot {
  gameState: GameState;
  flags: string[];
  /** player.activeFlags serialized as array (JSON loses Set → {}) */
  activeFlags: string[];
  narrativeLines: NarrativeLine[];
  originalInput: string;
}

/** Snapshot saved before each player action; cleared after use or after rewind. */
export const previousSnapshot = writable<PreviousSnapshot | null>(null);

/** Set by GameController to let UI components trigger rewind + resubmit. */
export const rewindAction = writable<((newInput: string) => Promise<void>) | null>(null);

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

export type GamePhase  = 'title' | 'naming' | 'loading' | 'playing' | 'ending';
export type EndingType = 'mvp_complete' | 'death' | 'collapse';
export const gamePhase  = writable<GamePhase>('title');
export const endingType = writable<EndingType | null>(null);
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
  /** 所有已有聲望的派系（供陣營關係圖使用） */
  allFactionRep?:   Array<{ id: string; name: string; rep: number }>;
  /** 陣營關係圖資料（節點座標與玩家投影由前端彈簧佈局演算法計算） */
  factionGraphUI?: {
    /** 已發現的派系節點（依 reputation 非零篩選） */
    nodes: Array<{
      id: string;
      /** 已揭露時為派系真名，否則為 '???' */
      displayName: string;
      rep: number;
      revealed: boolean;
    }>;
    /** 兩端均已發現的關係邊 */
    edges: Array<{ a: string; b: string; weight: number }>;
  };
  titles?:          string[];
  activeQuestSummaries?: Array<{
    questId:    string;
    name:       string;
    type:       QuestType;
    stageSummary: string;
    objectives: Array<{ id: string; description: string; completed: boolean }>;
    canAbandon: boolean;
    canDitch: boolean;
    ditchBeneficiaryFactionId?: string;
  }>;
  /** Full list (all active quests, not capped at 3). Used by the quest list modal. */
  allActiveQuestSummaries?: Array<{
    questId:    string;
    name:       string;
    type:       QuestType;
    stageSummary: string;
    objectives: Array<{ id: string; description: string; completed: boolean }>;
    canAbandon: boolean;
    canDitch: boolean;
    ditchBeneficiaryFactionId?: string;
  }>;
  totalActiveQuestCount?: number;
  conditions?:      Array<{ label: string; effectSummary?: string; removeCondition?: string }>;
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
  kind:        'area-root' | 'sublocation' | 'adjacent-area' | 'remote-sublocation';
  isCurrent:   boolean;
  isVisited:   boolean;
  isKnownButUnvisited: boolean;
  /** 地圖隱藏節點：條件不滿足且未到訪，地圖上不顯示但可 hover 顯示 ??? */
  isHidden:    boolean;
  districtId?: string;
  areaId?:     string;
}

export interface MiniMapEdge {
  fromId:              string;
  toId:                string;
  kind:                'local' | 'cross-area' | 'remote-link';
  isLocked:            boolean;
  hasBypass:            boolean;
  isTraversable:       boolean;
  targetIsForeignArea: boolean;
  /** 目標節點為隱藏節點時邊線也隱藏 */
  isHidden:            boolean;
  lockedMessage?:      string;
  bypassMessage?:      string;
}

export interface MiniMapData {
  areaId:       string;
  areaName:     string;
  districtId:   string;
  districtName: string;
  nodes:        MiniMapNode[];
  edges:        MiniMapEdge[];
}

export interface DistrictMapNode {
  id:          string;
  label:       string;
  isCurrent:   boolean;
  isDiscovered: boolean;
  adjacentIds: string[];
  description?: string;
  ambience?:    string[];
  /** Notable NPC names in this district */
  notableNpcs?: string[];
  controlLevel?: number;
  alertLevel?:   number;
}

export interface RegionMapAreaNode {
  id:            string;
  name:          string;
  isCurrent:     boolean;
  isDiscovered:  boolean;
  description?:  string;
  /** 已發現的子區域數 */
  discoveredSubCount: number;
  /** 全部子區域數（含隱藏） */
  totalSubCount:      number;
}

export interface RegionMapAreaEdge {
  fromId:          string;
  toId:            string;
  /** 兩地之間所有連線皆鎖定時為 true */
  isLocked:        boolean;
  /** 至少一條連線有 bypass 路徑時為 true */
  hasBypass:       boolean;
  lockedMessage?:  string;
  bypassMessage?:  string;
}

export interface RegionMapData {
  regionId:          string;
  regionName:        string;
  currentDistrictId: string;
  districts:         DistrictMapNode[];
  /** Area-level graphs per discovered district */
  districtAreaGraphs: Record<string, {
    nodes: RegionMapAreaNode[];
    edges: RegionMapAreaEdge[];
  }>;
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
  primaryStatsExp:   Record<string, number>;
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
  statCheckResult?: { stat: string; dc: number; value: number; passed: boolean; rollResult?: RollResult; sides?: number };
  /** story 型別使用：完整劇情腳本，渲染時依 speaker 決定樣式 */
  script?: ScriptLine[];
  /** story 型別使用：目前已解鎖到的行索引（0-based，含此行） */
  currentLineIndex?: number;
}

export const activeEncounterUI = writable<ActiveEncounterUI | null>(null);

// Story typewriter animation state — true while character-by-character typing is active
export const storyTypingActive = writable(false);

// ── Stat check overlay ─────────────────────────────────────────
// 設定後會觸發畫面中央的判定動畫視窗，顯示完畢後元件自行清除
export const statCheckOverlay = writable<{
  stat: string; dc: number; value: number; passed: boolean; rollResult?: RollResult; sides?: number;
} | null>(null);

// ── Rest modal & result ────────────────────────────────────────

export interface RestModalState {
  /** full_available = 有休息點可完整休息；scuffed = 無休息點只能短眠 */
  canFullRest: boolean;
  /** scuffed 模式下的最大休息分鐘上限 */
  scuffedMaxMinutes: number;
}
export const restModalOpen = writable<RestModalState | null>(null);

export interface RestResultUIState {
  plannedMinutes:   number;
  actualMinutes:    number;
  deviationMinutes: number;
  quality:          string;
  staminaDelta:     number;
  stressDelta:      number;
  fatigueDelta:     number;
  resultTags:       string[];
  /** 睡眠被時間事件提前中斷（如報時鐘、時段切換） */
  wasInterrupted?:  boolean;
}
export const restResultOverlay = writable<RestResultUIState | null>(null);

// ── Faction graph modal ────────────────────────────────────────
export const factionGraphOpen = writable(false);

// ── Modal state ────────────────────────────────────────────────

export const selfCheckOpen = writable(false);
export const inventoryOpen = writable(false);
export const isSaving      = writable(false);

// Quest detail modal — set to a quest summary to open, null to close
export type QuestDetailEntry = NonNullable<PlayerUIState['activeQuestSummaries']>[number];
export const questDetailOpen = writable<QuestDetailEntry | null>(null);

// Quest list modal — shows all active quests when sidebar is capped at 3
export const questListOpen = writable(false);

// Quest banner — single queue; outcomes displayed one at a time, 3.5 s each
export interface QuestBannerEntry {
  name:    string;
  outcome: 'completed' | 'failed';
}

export const currentQuestBanner = writable<QuestBannerEntry | null>(null);

const _questBannerQueue: QuestBannerEntry[] = [];
let _questBannerTimer: ReturnType<typeof setTimeout> | null = null;

function _processQuestBannerQueue(): void {
  if (_questBannerTimer) return;
  const next = _questBannerQueue.shift();
  if (!next) return;
  currentQuestBanner.set(next);
  _questBannerTimer = setTimeout(() => {
    currentQuestBanner.set(null);
    _questBannerTimer = null;
    _processQuestBannerQueue();
  }, 3500);
}

export function enqueueQuestBanner(name: string, outcome: 'completed' | 'failed'): void {
  _questBannerQueue.push({ name, outcome });
  _processQuestBannerQueue();
}

// Quest outcome flash — briefly shows a just-completed/failed quest in the sidebar with animation
export interface QuestOutcomeFlash {
  questId:  string;
  name:     string;
  type:     QuestType;
  outcome:  'completed' | 'failed';
}
export const questOutcomeFlash = writable<QuestOutcomeFlash[]>([]);

export function showQuestOutcomeFlash(questId: string, name: string, type: QuestType, outcome: 'completed' | 'failed'): void {
  questOutcomeFlash.update(list => [...list, { questId, name, type, outcome }]);
  setTimeout(() => {
    questOutcomeFlash.update(list => list.filter(q => !(q.questId === questId && q.outcome === outcome)));
  }, 3000);
}

// ── Event toast ────────────────────────────────────────────────
// 事件觸發時在敘事框右上角閃現三秒的提示

export type ToastVariant = 'normal' | 'negative' | 'danger' | 'rare';

export interface EventToastState {
  label: string;
  variant: ToastVariant;
}

export const eventToast = writable<EventToastState | null>(null);

let _toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showEventToast(label: string, variant: ToastVariant = 'normal'): void {
  if (_toastTimer) clearTimeout(_toastTimer);
  eventToast.set({ label, variant });
  const duration = variant === 'rare' ? 7000 : 5000;
  _toastTimer = setTimeout(() => {
    eventToast.set(null);
    _toastTimer = null;
  }, duration);
}

// ── Acquisition notifications ──────────────────────────────────
// 獲得/失去道具、數值、聲望、好感時在右下角顯示的佇列式通知

export interface AcquisitionNotif {
  id: number;
  label: string;
  gain: boolean; // true = 獲得（綠）, false = 失去（琥珀）
}

export const acquisitionNotifs = writable<AcquisitionNotif[]>([]);

let _notifSeq = 0;

export function showAcquisitionNotif(label: string, gain: boolean): void {
  const id = ++_notifSeq;
  acquisitionNotifs.update(list => [...list, { id, label, gain }]);
  setTimeout(() => {
    acquisitionNotifs.update(list => list.filter(n => n.id !== id));
  }, 3500);
}

// ── Status bar flash ───────────────────────────────────────────
// 狀態數值變動時在 PlayerPanel 的條上閃爍提示（good=綠/bad=紅+抖動）

export type BarFlashKind = 'good' | 'bad';
// key = stat name: 'stamina' | 'stress' | 'endo'
export const barFlash = writable<Partial<Record<string, BarFlashKind>>>({});

export function triggerBarFlash(stat: string, kind: BarFlashKind): void {
  barFlash.update(s => ({ ...s, [stat]: kind }));
  setTimeout(() => {
    barFlash.update(s => { const n = { ...s }; delete n[stat]; return n; });
  }, 900);
}

// ── Melphin flash ──────────────────────────────────────────────
// 梅分變動時閃爍數字（good=綠，bad=紅）

export const melphinFlash = writable<BarFlashKind | null>(null);

export function triggerMelphinFlash(kind: BarFlashKind): void {
  melphinFlash.set(kind);
  setTimeout(() => melphinFlash.set(null), 900);
}

// ── Stat delta floating notifications ─────────────────────────────
// 數值變動時在欄位附近跳出 +/- delta 提示，有益綠色、有害紅色

export interface StatDeltaNotif {
  id: number;
  target: string;   // 'stamina' | 'stress' | 'endo' | 'rep:<factionId>' | 'aff:<npcId>'
  delta: number;
  valence: 'good' | 'bad';
}

export const statDeltaNotifs = writable<StatDeltaNotif[]>([]);

let _deltaSeq = 0;

export function showStatDelta(target: string, delta: number, valence: 'good' | 'bad'): void {
  const id = ++_deltaSeq;
  statDeltaNotifs.update(list => [...list, { id, target, delta, valence }]);
  setTimeout(() => {
    statDeltaNotifs.update(list => list.filter(n => n.id !== id));
  }, 1500);
}

// ── Lore item reading modal ───────────────────────────────────
// Set to a { name, content } to open the lore reading modal; null to close.

export interface LoreItemReading {
  name: string;
  content: string;
}

export const loreItemOpen = writable<LoreItemReading | null>(null);

// ── Observe panel snapshot ─────────────────────────────────────
// Updated by GameController.syncUIState() — deterministic scene data for the Observe UI

import type { ObserveSnapshot } from '../types/prop';

export const observeSnapshot = writable<ObserveSnapshot>({
  location: { id: '', name: '' },
  exits: [],
  npcs: [],
  props: [],
  canFullRest: false,
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

export const endoPercent = derived(
  playerUI,
  ($p) => $p.endoMax > 0 ? Math.round(($p.endo / $p.endoMax) * 100) : 0
);

// ── Shadow Mode (Judge pipeline) ───────────────────────────────
// DM + Judge 雙軌模式：shadow mode 下記錄 DM signals vs Judge resolution 供 DebugPanel 對比。
// 套用邏輯由 GameController 控制，store 只負責儲存對比結果。

/** 是否開啟 shadow mode（debug 模式下可切換）。 */
export const shadowModeActive = writable<boolean>(false);

/** 最近 N 回合的 shadow 對比結果（最多保留 20 筆）。 */
export const shadowComparisons = writable<ShadowComparison[]>([]);

export function pushShadowComparison(entry: ShadowComparison): void {
  shadowComparisons.update(list => [entry, ...list].slice(0, 20));
}
