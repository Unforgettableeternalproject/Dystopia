/**
 * Lore Editor — File I/O utilities.
 *
 * 一律經由 SvelteKit dev server 的 `/api/lore/*` 讀寫原始碼目錄下的 lore/。
 * `npm run dev` 與 `npm run tauri dev` 都由 Vite dev server 提供這些端點，
 * 因此不需要為原始碼目錄開放 Tauri fs 權限。
 * 打包版（adapter-static）沒有 server 端點，編輯器僅支援開發模式。
 */

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface LoreFileEntry {
  id: string;
  name: string;
  path: string;
}

function assertApiAvailable(): void {
  if (!import.meta.env.DEV && IS_TAURI) {
    throw new Error('Lore Editor 僅支援開發模式（npm run tauri dev 或 npm run dev）');
  }
}

/** List JSON files in a lore subdirectory (relative to lore root). */
export async function listLoreDir(subDir: string): Promise<LoreFileEntry[]> {
  assertApiAvailable();
  const res = await fetch(`/api/lore/list?dir=${encodeURIComponent(subDir)}`);
  if (!res.ok) return [];
  return res.json();
}

/** Read a lore file and return its text content. */
export async function readLoreFile(path: string): Promise<string> {
  assertApiAvailable();
  const res = await fetch(`/api/lore/read?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`Read failed: ${res.status}`);
  return res.text();
}

/** Delete a lore file. */
export async function deleteLoreFile(path: string): Promise<void> {
  assertApiAvailable();
  const res = await fetch('/api/lore/write', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

/** Write text content to a lore file. Validates JSON before writing. */
export async function writeLoreFile(path: string, content: string): Promise<void> {
  JSON.parse(content); // validate
  assertApiAvailable();
  const res = await fetch('/api/lore/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error(`Write failed: ${res.status}`);
}
