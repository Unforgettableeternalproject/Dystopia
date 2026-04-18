// Logger -- lightweight structured logger with Svelte store integration.
// Stores entries in a circular buffer (max 500). Dev mode mirrors to console.

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
}
