// ── Regulator ─────────────────────────────────────────────────
// 強制限制玩家只能執行其能力範圍內的動作。
// 判定邏輯以玩家數值為主，LLM 只負責語意解析與原因生成。

import type { PlayerAction, PlayerState, RegulatorResult, Thought } from '../types';
import { AnthropicClient } from './AnthropicClient';

const SYSTEM_PROMPT = `你是一個 RPG 遊戲的行動規制器。
你的任務是判斷玩家的輸入是否在其角色能力範圍內。

規則：
1. 根據玩家數值判斷動作可行性。
2. 若動作不可行，給出簡短的理由（用第三人稱，以世界觀語言表達，不要說「你的數值不足」）。
3. 若動作可行但超過能力，可以降級調整（例如：想要完美說服改為嘗試說服）。
4. 回應格式為 JSON：{ "allowed": boolean, "reason": string | null, "modifiedInput": string | null }

不要在 JSON 以外輸出任何文字。`;

export class Regulator {
  private client: AnthropicClient;

  constructor(client: AnthropicClient) {
    this.client = client;
  }

  async validate(
    action: PlayerAction,
    player: PlayerState
  ): Promise<RegulatorResult> {
    // 先做基礎數值邊界檢查（不需要 LLM）
    const hardCheck = this.hardCheck(action, player);
    if (hardCheck !== null) return hardCheck;

    // 語意層判斷（LLM）
    const userMessage = JSON.stringify({
      action: action.input,
      actionType: action.type,
      stats: {
        strength: player.primaryStats.strength,
        knowledge: player.primaryStats.knowledge,
        talent: player.primaryStats.talent,
        spirit: player.primaryStats.spirit,
        luck: player.primaryStats.luck,
      },
      stamina: player.statusStats.stamina,
      stress: player.statusStats.stress,
    });

    try {
      const raw = await this.client.complete(SYSTEM_PROMPT, userMessage, 256);
      const parsed = JSON.parse(raw) as {
        allowed: boolean;
        reason: string | null;
        modifiedInput: string | null;
      };

      return {
        allowed: parsed.allowed,
        reason: parsed.reason ?? undefined,
        modifiedAction: parsed.modifiedInput
          ? { ...action, input: parsed.modifiedInput }
          : undefined,
      };
    } catch {
      // 解析失敗時預設放行，避免卡住遊戲
      return { allowed: true };
    }
  }

  /** 硬邊界檢查：不需要 LLM 的明確限制 */
  private hardCheck(
    action: PlayerAction,
    player: PlayerState
  ): RegulatorResult | null {
    // 體力耗盡時禁止戰鬥類動作
    if (action.type === 'combat' && player.statusStats.stamina <= 0) {
      return {
        allowed: false,
        reason: '精疲力竭，連站穩都費力，更別說戰鬥了。',
      };
    }
    return null;
  }

  /** 產生建議的 Thought 列表（根據當前位置與狀態） */
  async generateThoughts(
    locationContext: string,
    player: PlayerState
  ): Promise<Thought[]> {
    // TODO: Sprint 1 實作 — 目前回傳預設建議
    return [
      { id: 'examine', text: '觀察周圍環境', actionType: 'examine' },
      { id: 'move', text: '查看可以去的地方', actionType: 'move' },
      { id: 'interact', text: '嘗試與人交談', actionType: 'interact' },
    ];
  }
}
