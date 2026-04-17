// LLMClientFactory — convenience helpers for configuring AI clients.

import { AnthropicClient }                   from './AnthropicClient';
import { LocalModelClient }                  from './LocalModelClient';
import { createHuggingFaceClient, hfGemma3_4B } from './HuggingFaceClient';
import type { ILLMClient }                   from './ILLMClient';

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
 * Ollama / LM Studio — OpenAI-compatible local server.
 * dmModel:        large model for narration (e.g. 'gemma4:e4b-it-q4_K_M')
 * regulatorModel: fast model for validation (default: same as dmModel)
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
 * Auto-detect the best available backend from environment variables.
 * Priority: Anthropic API > HuggingFace API > mock (undefined = mock mode)
 */
export function autoClients(): ClientPair | undefined {
  if (import.meta.env.VITE_ANTHROPIC_API_KEY) {
    return anthropicClients();
  }
  if (import.meta.env.VITE_HF_TOKEN) {
    // Use gemma-3-4b-it as DM, gemma-3-1b-it as regulator (faster validation)
    return hfClients('google/gemma-3-4b-it', 'google/gemma-3-1b-it');
  }
  return undefined; // falls back to mock mode
}
