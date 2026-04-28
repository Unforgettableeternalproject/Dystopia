// SvelteKit API Route — List lore directory (web mode fallback)
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const LORE_ROOT = resolve('lore');

export const GET: RequestHandler = async ({ url }) => {
  const dir = url.searchParams.get('dir');
  if (!dir) return error(400, 'Missing dir parameter');

  const target = resolve(join(LORE_ROOT, dir));
  if (!target.startsWith(LORE_ROOT)) return error(403, 'Path outside lore directory');

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
