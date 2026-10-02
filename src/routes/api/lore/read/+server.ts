// SvelteKit API Route — Read a lore file (web mode fallback)
import { error, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveInLore } from '$lib/lore-editor/loreGuard.server';
import { readFile } from 'node:fs/promises';

export const GET: RequestHandler = async ({ url }) => {
  const filePath = url.searchParams.get('path');
  if (!filePath) return error(400, 'Missing path parameter');

  const target = resolveInLore(filePath);
  if (!target) return error(403, 'Path outside lore directory');

  try {
    const content = await readFile(target, 'utf-8');
    return text(content);
  } catch {
    return error(404, 'File not found');
  }
};
