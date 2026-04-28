// SvelteKit API Route — Write a lore file (web mode fallback)
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const LORE_ROOT = resolve('lore');

export const POST: RequestHandler = async ({ request }) => {
  const { path: filePath, content } = await request.json();
  if (!filePath || typeof content !== 'string') return error(400, 'Missing path or content');

  const target = resolve(filePath);
  if (!target.startsWith(LORE_ROOT)) return error(403, 'Path outside lore directory');

  try {
    // Validate JSON before writing
    JSON.parse(content);
    await writeFile(target, content, 'utf-8');
    return json({ ok: true });
  } catch (err) {
    return error(500, `Write failed: ${err}`);
  }
};

export const DELETE: RequestHandler = async ({ request }) => {
  const { path: filePath } = await request.json();
  if (!filePath) return error(400, 'Missing path');

  const target = resolve(filePath);
  if (!target.startsWith(LORE_ROOT)) return error(403, 'Path outside lore directory');

  try {
    await unlink(target);
    return json({ ok: true });
  } catch (err) {
    return error(500, `Delete failed: ${err}`);
  }
};
