// SvelteKit API Route — Write a lore file (web mode fallback)
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveWritableInLore } from '$lib/lore-editor/loreGuard.server';
import { writeFile, unlink } from 'node:fs/promises';

export const POST: RequestHandler = async ({ request }) => {
  const { path: filePath, content } = await request.json();
  if (!filePath || typeof content !== 'string') return error(400, 'Missing path or content');

  const target = resolveWritableInLore(filePath);
  if (!target) return error(403, 'Path outside lore directory or protected schema file');

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

  const target = resolveWritableInLore(filePath);
  if (!target) return error(403, 'Path outside lore directory or protected schema file');

  try {
    await unlink(target);
    return json({ ok: true });
  } catch (err) {
    return error(500, `Delete failed: ${err}`);
  }
};
