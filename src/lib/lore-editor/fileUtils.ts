/**
 * Lore Editor — File I/O utilities.
 * Abstracts Tauri fs plugin vs SvelteKit API (web mode).
 */

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const LORE_BASE = 'lore';

export interface LoreFileEntry {
  id: string;
  name: string;
  path: string;
}

/** List JSON files in a lore subdirectory (relative to lore root). */
export async function listLoreDir(subDir: string): Promise<LoreFileEntry[]> {
  const dir = `${LORE_BASE}/${subDir}`;
  if (IS_TAURI) {
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(dir);
    return entries
      .filter((e: { name?: string }) => e.name?.endsWith('.json') && !e.name?.startsWith('_'))
      .map((e: { name?: string }) => ({
        id: e.name!.replace('.json', ''),
        name: e.name!.replace('.json', ''),
        path: `${dir}/${e.name}`,
      }))
      .sort((a: LoreFileEntry, b: LoreFileEntry) => a.id.localeCompare(b.id));
  } else {
    const res = await fetch(`/api/lore/list?dir=${encodeURIComponent(subDir)}`);
    if (!res.ok) return [];
    return res.json();
  }
}

/** Read a lore file and return its text content. */
export async function readLoreFile(path: string): Promise<string> {
  if (IS_TAURI) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(path);
  } else {
    const res = await fetch(`/api/lore/read?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`Read failed: ${res.status}`);
    return res.text();
  }
}

/** Delete a lore file. */
export async function deleteLoreFile(path: string): Promise<void> {
  if (IS_TAURI) {
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(path);
  } else {
    const res = await fetch('/api/lore/write', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  }
}

/** Write text content to a lore file. Validates JSON before writing. */
export async function writeLoreFile(path: string, content: string): Promise<void> {
  JSON.parse(content); // validate
  if (IS_TAURI) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
  } else {
    const res = await fetch('/api/lore/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    if (!res.ok) throw new Error(`Write failed: ${res.status}`);
  }
}
