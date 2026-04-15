// ── AnthropicClient ───────────────────────────────────────────
// 封裝 Anthropic SDK，提供串流與單次呼叫介面。
// API key 從環境變數讀取，不硬編碼。

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

export class AnthropicClient {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? import.meta.env.VITE_ANTHROPIC_API_KEY,
    });
  }

  /**
   * 單次呼叫，回傳完整文字。
   * 用於規制器（需要快速判斷，不需串流）。
   */
  async complete(
    systemPrompt: string,
    userMessage: string,
    maxTokens = MAX_TOKENS
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');
    return content.text;
  }

  /**
   * 串流呼叫，逐字元回傳。
   * 用於 DM（打字機效果）。
   */
  async *stream(
    systemPrompt: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    maxTokens = MAX_TOKENS
  ): AsyncGenerator<string> {
    const stream = await this.client.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }
}
