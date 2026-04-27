// SvelteKit API Route — Read a lore file (web mode fallback)
import { error, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const LORE_ROOT = resolve('lore');

export const GET: RequestHandler = async ({ url }) => {
  const filePath = url.searchParams.get('path');
  if (!filePath) return error(400, 'Missing path parameter');

  const target = resolve(filePath);
  if (!target.startsWith(LORE_ROOT)) return error(403, 'Path outside lore directory');

  try {
    const content = await readFile(target, 'utf-8');
    return text(content);
  } catch {
    return error(404, 'File not found');
  }
};
