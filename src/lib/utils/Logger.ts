// Logger -- lightweight structured logger with Svelte store integration.
// Stores entries in a circular buffer (max 500). Dev mode mirrors to console.
// BroadcastChannel syncs entries to /console window.

import { writable, get } from 'svelte/store';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id:        number;
  level:     LogLevel;
  tag:       string;    // subsystem label, e.g. 'DM', 'Regulator', 'Engine'
  message:   string;
  timestamp: number;
  detail?:   unknown;   // arbitrary extra data (error objects, state diffs, etc.)
}

const MAX_ENTRIES = 500;
let   seq         = 0;
const isDev       = import.meta.env.DEV;

// Reactive store -- UI can subscribe for a live debug panel
export const logEntries = writable<LogEntry[]>([]);

// ── BroadcastChannel for cross-window log sync ───────────────────────────
const LOG_CHANNEL_NAME = 'dystopia-log';
let logBC: BroadcastChannel | null = null;

function getLogChannel(): BroadcastChannel | null {
  if (logBC) return logBC;
  try {
    logBC = new BroadcastChannel(LOG_CHANNEL_NAME);
    return logBC;
  } catch {
    return null; // SSR or unsupported
  }
}

function broadcastLog(msg: { type: string; payload?: unknown }): void {
  getLogChannel()?.postMessage(msg);
}

function push(level: LogLevel, tag: string, message: string, detail?: unknown): void {
  const entry: LogEntry = {
    id:        seq++,
    level,
    tag,
    message,
    timestamp: Date.now(),
    detail,
  };

  logEntries.update((entries) => {
    const next = [...entries, entry];
    return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  });

  // Broadcast to /console window
  broadcastLog({ type: 'add', payload: entry });

  if (isDev) {
    const prefix = `[${tag}]`;
    switch (level) {
      case 'debug': console.debug(prefix, message, detail ?? ''); break;
      case 'info':  console.info (prefix, message, detail ?? ''); break;
      case 'warn':  console.warn (prefix, message, detail ?? ''); break;
      case 'error': console.error(prefix, message, detail ?? ''); break;
    }
  }
}

// Named logger instance -- avoids repeating the tag at every call site
export function createLogger(tag: string) {
  return {
    debug: (msg: string, detail?: unknown) => push('debug', tag, msg, detail),
    info:  (msg: string, detail?: unknown) => push('info',  tag, msg, detail),
    warn:  (msg: string, detail?: unknown) => push('warn',  tag, msg, detail),
    error: (msg: string, detail?: unknown) => push('error', tag, msg, detail),
  };
}

// Export current log as plain text (for copy-paste or file save)
export function exportLog(): string {
  const entries = get(logEntries);
  return entries
    .map((e) => {
      const t  = new Date(e.timestamp).toISOString();
      const lv = e.level.toUpperCase().padEnd(5);
      const base = `${t} ${lv} [${e.tag}] ${e.message}`;
      return e.detail !== undefined ? base + '\n  ' + JSON.stringify(e.detail) : base;
    })
    .join('\n');
}

export function clearLog(): void {
  logEntries.set([]);
  broadcastLog({ type: 'clear' });
}

/**
 * Broadcast an app-closing signal so satellite windows (e.g. /console) can self-close.
 * Call once from the main window's beforeunload or Tauri close handler.
 */
export function broadcastAppClose(): void {
  broadcastLog({ type: 'app-close' });
}

// ── Receiver API (used by /console route) ────────────────────────────────

/** Subscribe to log entries from the main window. Call once in /console onMount. */
export function listenForLogs(): (() => void) {
  const channel = getLogChannel();
  if (!channel) return () => {};

  const handler = (ev: MessageEvent) => {
    const msg = ev.data as { type: string; payload?: unknown };
    switch (msg.type) {
      case 'add': {
        const entry = msg.payload as LogEntry;
        logEntries.update(entries => {
          const next = [...entries, entry];
          return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
        });
        break;
      }
      case 'clear':
        logEntries.set([]);
        break;
      case 'sync':
        logEntries.set(msg.payload as LogEntry[]);
        break;
      case 'app-close':
        // Main window is closing — close this satellite window too
        window.close();
        break;
    }
  };

  channel.addEventListener('message', handler);
  // Request full state from main window
  broadcastLog({ type: 'request-sync' });

  return () => channel.removeEventListener('message', handler);
}

/** Listen for sync requests from the console window (call in main window). */
export function listenForLogSyncRequests(): (() => void) {
  const channel = getLogChannel();
  if (!channel) return () => {};

  const handler = (ev: MessageEvent) => {
    const msg = ev.data as { type: string };
    if (msg.type === 'request-sync') {
      broadcastLog({ type: 'sync', payload: get(logEntries) });
    }
  };

  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}
