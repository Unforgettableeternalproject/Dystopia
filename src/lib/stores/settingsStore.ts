// 應用程式層級的介面設定（非存檔層級）。
// - 儲存在 localStorage（key: dystopia.settings），讀寫皆包 try/catch，失敗時退回預設值。
// - 套用方式：把 uiScale 寫入 documentElement 的 CSS 變數 --ui-scale，全專案字級皆依此計算。
// - 跨視窗同步：BroadcastChannel（主要）+ storage 事件（備援），/console、/lore 視窗會即時跟隨。
import { writable, derived, get } from 'svelte/store';

export const SETTINGS_STORAGE_KEY = 'dystopia.settings';
const SETTINGS_CHANNEL_NAME = 'dystopia-settings';
export const SETTINGS_VERSION = 1;

/** 字級縮放檔位 */
export const UI_SCALE_PRESETS = [0.85, 1, 1.15, 1.3, 1.5] as const;
export const UI_SCALE_MIN = 0.75;
export const UI_SCALE_MAX = 1.75;

/**
 * 介面設定。新增設定時：在此加欄位、在 DEFAULT_SETTINGS 給預設值、在 normalizeSettings 加驗證，
 * 必要時調高 SETTINGS_VERSION 並在 normalizeSettings 處理舊版遷移。
 */
export interface AppSettings {
  version: number;
  /** 介面字級縮放倍率（1 = 100%） */
  uiScale: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  uiScale: 1,
};

function clampScale(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.uiScale;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(n * 100) / 100));
}

/** 將任意輸入整理成合法的 AppSettings（缺欄位補預設、非法值修正）。 */
export function normalizeSettings(raw: unknown): AppSettings {
  const src = (raw && typeof raw === 'object') ? raw as Partial<AppSettings> : {};
  return {
    ...DEFAULT_SETTINGS,
    version: SETTINGS_VERSION,
    uiScale: 'uiScale' in src ? clampScale(src.uiScale) : DEFAULT_SETTINGS.uiScale,
  };
}

function readStoredSettings(): AppSettings {
  try {
    const text = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!text) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStoredSettings(s: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 儲存失敗（隱私模式、配額不足等）：設定仍在本次執行期間生效
  }
}

function applyToDocument(s: AppSettings): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
}

export const settings = writable<AppSettings>({ ...DEFAULT_SETTINGS });

/** 目前的字級縮放倍率（供 SVG 幾何等需要 JS 數值的地方使用） */
export const uiScale = derived(settings, s => s.uiScale);

/** 設定面板是否開啟 */
export const settingsOpen = writable(false);

let channel: BroadcastChannel | null = null;
let initialized = false;

function isSame(a: AppSettings, b: AppSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 由其他視窗傳來的設定：只套用，不回寫也不再廣播。 */
function receiveRemote(raw: unknown): void {
  const next = normalizeSettings(raw);
  if (isSame(next, get(settings))) return;
  settings.set(next);
  applyToDocument(next);
}

/**
 * 每個視窗啟動時呼叫一次（在 +layout.svelte 的 onMount）。
 * 讀取已儲存設定並套用，開始監聽其他視窗的變更。回傳清除函式。
 */
export function initSettings(): () => void {
  if (typeof window === 'undefined') return () => {};
  const loaded = readStoredSettings();
  settings.set(loaded);
  applyToDocument(loaded);

  if (initialized) return () => {};
  initialized = true;

  const onStorage = (e: StorageEvent) => {
    if (e.key !== SETTINGS_STORAGE_KEY || !e.newValue) return;
    try { receiveRemote(JSON.parse(e.newValue)); } catch { /* 忽略損毀資料 */ }
  };
  window.addEventListener('storage', onStorage);

  try {
    channel = new BroadcastChannel(SETTINGS_CHANNEL_NAME);
    channel.onmessage = (e: MessageEvent) => receiveRemote(e.data);
  } catch {
    channel = null; // 不支援 BroadcastChannel 時只靠 storage 事件
  }

  return () => {
    window.removeEventListener('storage', onStorage);
    channel?.close();
    channel = null;
    initialized = false;
  };
}

/** 更新部分設定：套用、儲存並廣播給其他視窗。 */
export function updateSettings(patch: Partial<Omit<AppSettings, 'version'>>): void {
  const next = normalizeSettings({ ...get(settings), ...patch });
  settings.set(next);
  applyToDocument(next);
  writeStoredSettings(next);
  try { channel?.postMessage(next); } catch { /* 忽略 */ }
}

/** 恢復全部預設值。 */
export function resetSettings(): void {
  updateSettings({ ...DEFAULT_SETTINGS });
}
