// HuggingFaceClient — HuggingFace Serverless Inference API backend.
// Uses the OpenAI-compatible /v1/chat/completions endpoint.
// Token is read from VITE_HF_TOKEN env var (or passed explicitly).
//
// Model endpoint format:
//   https://api-inference.huggingface.co/models/{modelId}/v1/chat/completions
//
// Recommended small test model: google/gemma-3-4b-it

import { LocalModelClient } from './LocalModelClient';
import type { ILLMClient } from './ILLMClient';

const HF_BASE = 'https://api-inference.huggingface.co/models';

export function createHuggingFaceClient(
  modelId: string,
  token?: string,
): ILLMClient {
  const hfToken = token ?? import.meta.env.VITE_HF_TOKEN;
  if (!hfToken) throw new Error('HuggingFace token not found. Set VITE_HF_TOKEN in .env');

  // LocalModelClient will append /v1/chat/completions to the base URL
  const baseUrl = HF_BASE + '/' + modelId;

  return new LocalModelClient(modelId, baseUrl, {
    Authorization: 'Bearer ' + hfToken,
  });
}

/** Preset: gemma-3-4b-it — small, fast, good for MVP testing (~5GB local equiv) */
export function hfGemma3_4B(token?: string): ILLMClient {
  return createHuggingFaceClient('google/gemma-3-4b-it', token);
}

/** Preset: gemma-3-1b-it — ultra-small, for quick smoke tests */
export function hfGemma3_1B(token?: string): ILLMClient {
  return createHuggingFaceClient('google/gemma-3-1b-it', token);
}
