// Regulator — action validation and Thought generation.
// Hard rules run first (no LLM). LLM only handles semantic edge cases.

import type { PlayerAction, PlayerState, RegulatorResult, Thought } from '../types';
import type { ResolvedLocation } from '../types/world';
import type { ILLMClient } from './ILLMClient';

const VALIDATE_SYSTEM = `You are an action validator for a grounded RPG.
Determine if the player's action is physically/practically possible given their current stats and conditions.

Rules:
1. Use stats (strength, knowledge, talent, spirit, luck) and status (stamina, stress) to judge feasibility.
2. Active conditions may restrict or modify possible actions (e.g., injured_arm limits heavy lifting).
3. If impossible, give a short in-world reason — never say "your stat is too low".
4. If possible but overreaching, you may downgrade the action (e.g., "perfectly pick lock" → "attempt to pick lock").
5. Respond ONLY with JSON: { "allowed": boolean, "reason": string | null, "modifiedInput": string | null }`;

export class Regulator {
  private client: ILLMClient;

  constructor(client: ILLMClient) {
    this.client = client;
  }

  // ── Validation ──────────────────────────────────────────────

  async validate(action: PlayerAction, player: PlayerState): Promise<RegulatorResult> {
    const hard = this.hardCheck(action, player);
    if (hard !== null) return hard;

    const conditionSummary = player.conditions
      .filter(c => !c.isHidden)
      .map(c => c.id + ': ' + c.description)
      .join('; ');

    const userMessage = JSON.stringify({
      action: action.input,
      actionType: action.type,
      stats: player.primaryStats,
      stamina: player.statusStats.stamina + '/' + player.statusStats.staminaMax,
      stress: player.statusStats.stress + '/' + player.statusStats.stressMax,
      conditions: conditionSummary || 'none',
    });

    try {
      const raw = await this.client.complete(VALIDATE_SYSTEM, userMessage, 256);
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
      return { allowed: true };
    }
  }

  private hardCheck(action: PlayerAction, player: PlayerState): RegulatorResult | null {
    if (action.type === 'combat' && player.statusStats.stamina <= 0) {
      return { allowed: false, reason: '精疲力竭，連站穩都費力，更別說戰鬥了。' };
    }
    return null;
  }

  // ── Thought processing ──────────────────────────────────────

  /**
   * Filter and optionally manipulate a pre-built thought list based on player state.
   * Called by GameController after buildBaseThoughts().
   */
  processThoughts(thoughts: Thought[], player: PlayerState): Thought[] {
    // Filter out thoughts the player cannot attempt
    const filtered = thoughts.filter(t => {
      if (t.actionType === 'combat' && player.statusStats.stamina <= 0) return false;
      return true;
    });

    // Check for mind-control or manipulation conditions
    const isMindControlled = player.conditions.some(c =>
      c.id.includes('mind_control') || c.id.includes('possessed') || c.id.includes('manipulated')
    );

    if (isMindControlled) {
      // Randomly mark thoughts as manipulated (player cannot fully trust their own instincts)
      return filtered.map((t, i) => ({ ...t, isManipulated: i % 2 === 0 }));
    }

    // High stress: combat/aggressive thoughts may feel more urgent than they should
    const stressRatio = player.statusStats.stress / Math.max(player.statusStats.stressMax, 1);
    if (stressRatio >= 0.8) {
      return filtered.map(t => ({
        ...t,
        isManipulated: t.actionType === 'combat',
      }));
    }

    return filtered;
  }
}
