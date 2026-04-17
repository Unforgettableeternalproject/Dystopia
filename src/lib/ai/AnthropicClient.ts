// AnthropicClient — Anthropic SDK backend.
// Used when VITE_ANTHROPIC_API_KEY is set.

import Anthropic from '@anthropic-ai/sdk';
import type { ILLMClient, ChatMessage } from './ILLMClient';

const DEFAULT_MODEL  = 'claude-sonnet-4-6';
const DEFAULT_TOKENS = 1024;

export class AnthropicClient implements ILLMClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model = DEFAULT_MODEL) {
    this.client = new Anthropic({
      apiKey: apiKey ?? import.meta.env.VITE_ANTHROPIC_API_KEY,
    });
    this.model = model;
  }

  async complete(system: string, user: string, maxTokens = DEFAULT_TOKENS): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Anthropic response type');
    return block.text;
  }

  async *stream(
    system: string,
    messages: ChatMessage[],
    maxTokens = DEFAULT_TOKENS,
  ): AsyncGenerator<string> {
    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield chunk.delta.text;
      }
    }
  }
}
