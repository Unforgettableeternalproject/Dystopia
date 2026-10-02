// SvelteKit API Route — List lore directory (web mode fallback)
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LORE_ROOT, resolveInLore } from '$lib/lore-editor/loreGuard.server';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const GET: RequestHandler = async ({ url }) => {
  const dir = url.searchParams.get('dir');
  if (!dir) return error(400, 'Missing dir parameter');

  const target = resolveInLore(join(LORE_ROOT, dir));
  if (!target) return error(403, 'Path outside lore directory');

  try {
    const entries = await readdir(target, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('_'))
      .map(e => ({
        id: e.name.replace('.json', ''),
        name: e.name.replace('.json', ''),
        path: `lore/${dir}/${e.name}`,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return json(files);
  } catch {
    return json([]);
  }
};
