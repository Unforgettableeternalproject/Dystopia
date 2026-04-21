// LLMClientFactory — convenience helpers for configuring AI clients.

import { AnthropicClient }              from './AnthropicClient';
import { LocalModelClient }             from './LocalModelClient';
import { createHuggingFaceClient }      from './HuggingFaceClient';
import type { ILLMClient }              from './ILLMClient';

export interface ClientPair {
  /** Large/quality model for narration (DM). */
  dm: ILLMClient;
  /** Small/fast model for validation and intent (Regulator). */
  regulator: ILLMClient;
}

/** Anthropic API for both roles. */
export function anthropicClients(apiKey?: string): ClientPair {
  const c = new AnthropicClient(apiKey);
  return { dm: c, regulator: c };
}

/**
 * Ollama / LM Studio -- OpenAI-compatible local server.
 * dmModel:        large model for narration (e.g. 'gemma4:e4b-it-q4_K_M')
 * regulatorModel: fast model for validation (default: same as dmModel)
 * baseUrl:        server URL (default: http://localhost:11434)
 *                 Use '/api/llm' for proxy mode (remote access through SvelteKit)
 */
export function ollamaClients(
  dmModel: string,
  regulatorModel?: string,
  baseUrl = 'http://localhost:11434',
): ClientPair {
  return {
    dm:        new LocalModelClient(dmModel,                   baseUrl),
    regulator: new LocalModelClient(regulatorModel ?? dmModel, baseUrl),
  };
}

/**
 * Proxy mode — route LLM requests through SvelteKit API.
 * Use this when running the game on remote devices through Radmin/VPN.
 * The frontend calls /api/llm/chat, which proxies to localhost:11434 on the server.
 * 
 * Benefits:
 * - Ollama stays on localhost (more secure)
 * - Remote clients can access LLM through the Vite server
 * 
 * dmModel:        large model for narration (e.g. 'gemma4:e4b-it-q4_K_M')
 * regulatorModel: fast model for validation (default: same as dmModel)
 */
export function proxyClients(
  dmModel: string,
  regulatorModel?: string,
): ClientPair {
  return ollamaClients(dmModel, regulatorModel, '/api/llm');
}

/** LM Studio defaults to port 1234. */
export function lmStudioClients(dmModel: string, regulatorModel?: string): ClientPair {
  return ollamaClients(dmModel, regulatorModel, 'http://localhost:1234');
}

/**
 * HuggingFace Serverless Inference API.
 * Good for testing without a local GPU.
 * dmModel:        model for narration (default: gemma-3-4b-it)
 * regulatorModel: model for validation (default: same as dmModel)
 * token:          HF token (default: VITE_HF_TOKEN env var)
 */
export function hfClients(
  dmModelId    = 'google/gemma-3-4b-it',
  regulatorModelId?: string,
  token?: string,
): ClientPair {
  const dm        = createHuggingFaceClient(dmModelId, token);
  const regulator = regulatorModelId
    ? createHuggingFaceClient(regulatorModelId, token)
    : dm;
  return { dm, regulator };
}

/**
 * Ollama preset for MVP -- Gemma 4 E4B-IT Q4 for both DM and Regulator.
 * Single model keeps VRAM usage low; regulator calls are short so latency is fine.
 */
export function gemma4Clients(): ClientPair {
  return ollamaClients('gemma4:e4b-it-q4_K_M');
}

/**
 * Auto-detect the best available backend.
 * Priority: Anthropic > Ollama (VITE_OLLAMA_MODEL) > HuggingFace > mock
 *
 * Set VITE_OLLAMA_MODEL=gemma4:e4b-it-q4_K_M in .env to enable Ollama.
 * Set VITE_USE_LLM_PROXY=true to use SvelteKit API proxy mode (for remote access).
 */
export function autoClients(): ClientPair | undefined {
  if (import.meta.env.VITE_ANTHROPIC_API_KEY) {
    return anthropicClients();
  }
  if (import.meta.env.VITE_OLLAMA_MODEL) {
    const model = import.meta.env.VITE_OLLAMA_MODEL;
    // Use proxy mode if VITE_USE_LLM_PROXY is set to 'true'
    if (import.meta.env.VITE_USE_LLM_PROXY === 'true') {
      return proxyClients(model);
    }
    return ollamaClients(model);
  }
  if (import.meta.env.VITE_HF_TOKEN) {
    return hfClients('google/gemma-3-4b-it', 'google/gemma-3-1b-it');
  }
  return undefined; // mock mode
}
