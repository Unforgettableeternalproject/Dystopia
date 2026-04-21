// LocalModelClient -- OpenAI-compatible backend.
// Works with Ollama (port 11434), LM Studio (port 1234), or any
// server that implements the /v1/chat/completions endpoint.
// Optional headers allow auth tokens for remote APIs (e.g. HuggingFace).
//
// Proxy mode: When baseUrl is a relative path (e.g., '/api/llm'),
// requests go through the SvelteKit API proxy instead of directly to LLM.
// This allows remote clients to access the LLM without exposing the service.
//
// Gemma 4 note: thinking models output reasoning first (delta.reasoning),
// then content (delta.content). We only yield content -- reasoning is skipped.

import type { ILLMClient, ChatMessage } from './ILLMClient';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_TOKENS   = 1200; // thinking models need extra budget for reasoning phase

export class LocalModelClient implements ILLMClient {
  private headers: Record<string, string>;
  private endpoint: string;

  constructor(
    private model: string,
    private baseUrl = DEFAULT_BASE_URL,
    extraHeaders: Record<string, string> = {},
  ) {
    this.headers = { 'Content-Type': 'application/json', ...extraHeaders };
    // Determine the endpoint based on whether we're using proxy mode
    this.endpoint = this.isProxyMode() ? '/api/llm/chat' : `${this.baseUrl}/v1/chat/completions`;
  }

  /** Check if we're using SvelteKit API proxy (relative path) or direct connection (full URL) */
  private isProxyMode(): boolean {
    return this.baseUrl.startsWith('/');
  }

  async complete(system: string, user: string, maxTokens = DEFAULT_TOKENS): Promise<string> {
    const res = await fetch(this.endpoint, {
      method:  'POST',
      headers: this.headers,
      body: JSON.stringify({
        model:      this.model,
        max_tokens: maxTokens,
        stream:     false,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
      }),
    });
    if (!res.ok) throw new Error('LocalModelClient complete failed: ' + res.status);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0].message.content;
  }

  async *stream(
    system: string,
    messages: ChatMessage[],
    maxTokens = DEFAULT_TOKENS,
  ): AsyncGenerator<string> {
    const res = await fetch(this.endpoint, {
      method:  'POST',
      headers: this.headers,
      body: JSON.stringify({
        model:      this.model,
        max_tokens: maxTokens,
        stream:     true,
        messages: [
          { role: 'system', content: system },
          ...messages,
        ],
      }),
    });
    if (!res.ok) throw new Error('LocalModelClient stream failed: ' + res.status);

    const body = res.body;
    if (!body) return;

    const reader  = body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const chunk = JSON.parse(payload) as {
              choices: Array<{ delta: { content?: string; reasoning?: string } }>;
            };
            // Skip reasoning phase (chain-of-thought); only yield actual content.
            const text = chunk.choices?.[0]?.delta?.content;
            if (text) yield text;
          } catch { /* malformed chunk -- skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
