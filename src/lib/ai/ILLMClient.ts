// ILLMClient — abstract interface for any LLM backend.
// DMAgent and Regulator depend on this, not on any concrete client.

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ILLMClient {
  /** Single-shot completion. Used by Regulator for fast validation. */
  complete(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<string>;

  /** Streaming completion. Used by DMAgent for typewriter narration. */
  stream(
    systemPrompt: string,
    messages: ChatMessage[],
    maxTokens?: number,
  ): AsyncGenerator<string>;
}
