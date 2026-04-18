// ModelWarmup -- pre-loads a local model into VRAM before first player action.
// Sends a minimal 1-token request so Ollama loads the weights in the background.
// Call on app start; the game can begin while warmup runs concurrently.

import type { ILLMClient } from '../ai/ILLMClient';
import { createLogger }    from './Logger';
import { writable, get }   from 'svelte/store';

const log = createLogger('Warmup');

export type WarmupStatus = 'idle' | 'running' | 'ready' | 'failed';

export const warmupStatus = writable<WarmupStatus>('idle');

/**
 * Fire-and-forget warmup. Does NOT block game start.
 * Sets warmupStatus so the UI can show a "Model loading..." indicator.
 *
 * client: the DM client (largest model -- slowest to load, most important to pre-warm)
 */
export async function warmUpModel(client: ILLMClient): Promise<void> {
  warmupStatus.set('running');
  log.info('Starting model warmup...');
  const t0 = Date.now();
  try {
    // 1-token completion to trigger model load without wasting inference time
    await client.complete('You are a warmup ping.', 'ok', 1);
    const ms = Date.now() - t0;
    log.info('Model ready in ' + ms + 'ms');
    warmupStatus.set('ready');
  } catch (err) {
    log.warn('Warmup failed -- first request may be slow', err);
    warmupStatus.set('failed');
    // Non-fatal: game continues in mock mode or with slow first response
  }
}

/**
 * Returns true once the model is confirmed loaded.
 * Poll this (or subscribe to warmupStatus) to check readiness.
 */
export function isModelReady(): boolean {
  return get(warmupStatus) === 'ready';
}
