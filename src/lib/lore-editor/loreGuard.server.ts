// Lore Editor API — 路徑防護：只允許 lore/ 目錄內的路徑
import { resolve, sep } from 'node:path';

export const LORE_ROOT = resolve('lore');

/** 解析路徑並確認位於 lore/ 之內；越界回傳 null。 */
export function resolveInLore(p: string): string | null {
  const target = resolve(p);
  return target === LORE_ROOT || target.startsWith(LORE_ROOT + sep) ? target : null;
}

/** 可寫入／刪除的 lore 路徑：同 resolveInLore，並排除 `_` 開頭的 schema 檔。 */
export function resolveWritableInLore(p: string): string | null {
  const target = resolveInLore(p);
  if (!target) return null;
  const base = target.slice(target.lastIndexOf(sep) + 1);
  return base.startsWith('_') ? null : target;
}
