// ── DMAgent ───────────────────────────────────────────────────
// 負責將結構化場景資料轉為敘述文字（串流）。
// DM 不創造世界，只傳達 Lore Vault 提供的內容。

import type { PlayerAction, GameState, HistoryEntry } from '../types';
import { AnthropicClient } from './AnthropicClient';

const SYSTEM_PROMPT = `你是一個劇場式 RPG 遊戲的 DM（主持人）。

你的職責：
1. 以沉浸式第二人稱（「你」）描述場景與事件。
2. 忠實傳達提供的場景資料，不自行添加資料中沒有的地點、NPC 或物品。
3. 扮演場景中的 NPC，對話應符合其描述的性格。
4. 敘述保持簡潔有力，通常 3-5 句話即可，特殊場景可以更長。
5. 語調應配合場景氛圍關鍵字（ambience）。
6. 不要在敘述中列出遊戲機制數值或旗標名稱。

你收到的資料格式：
- 場景上下文（地點、NPC、出口）
- 玩家動作
- 最近的歷史紀錄

嚴格限制：只能描述場景資料中存在的事物。`;

export class DMAgent {
  private client: AnthropicClient;

  constructor(client: AnthropicClient) {
    this.client = client;
  }

  /**
   * 生成敘述，以 AsyncGenerator 串流回傳文字片段。
   */
  async *narrate(
    sceneContext: string,
    action: PlayerAction,
    history: HistoryEntry[]
  ): AsyncGenerator<string> {
    const historyText = history
      .slice(-5) // 最近 5 筆
      .map((h) => `[Turn ${h.turn}] 玩家：${h.action.input}\nDM：${h.narrative}`)
      .join('\n\n');

    const userMessage = [
      '## 場景資料',
      sceneContext,
      '',
      '## 最近歷史',
      historyText || '（遊戲剛開始）',
      '',
      '## 玩家動作',
      action.input,
    ].join('\n');

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: userMessage },
    ];

    yield* this.client.stream(SYSTEM_PROMPT, messages);
  }
}
