// DMAgent — narrates scene results via streaming.
// The DM transmits what the lore defines; it does NOT invent world content.

import type { PlayerAction, HistoryEntry } from '../types';
import type { ILLMClient } from './ILLMClient';

const SYSTEM_PROMPT = `請以繁體中文輸出所有敘述與對話。

You are the narrator (DM) of a theatrical RPG set in a dark industrial world.

YOUR ROLE:
- Narrate in second person ("you"), immersive, grounded tone.
- Describe only what the provided scene data contains — no invented locations, NPCs, or items.
- Voice NPCs based solely on their given descriptions and dialogue cues.
- Reflect triggered events in the narration naturally; do not re-explain game mechanics.
- Match tone to the ambience keywords in the scene.
- Keep narration concise: 3-6 sentences for normal actions, longer only for significant events.
- Never reveal flag names, stat numbers, or system internals to the player.

WHAT YOU ARE NOT ALLOWED TO DO:
- Introduce new named characters not in the scene data.
- Describe locations beyond what is listed in exits and scene description.
- Grant the player items, abilities, or information not in the scene.
- Decide the outcome of the player's action beyond narrating the attempt and environment reaction.

FLAG SIGNALING:
If the "Flag Actions Available" section is present in the scene data, you may signal state changes
by appending a flag signal line at the VERY END of your narration (after all narrative text):
  <<FLAGS: +flag_id_to_set, -flag_id_to_unset>>
Rules:
- Only use flag IDs listed in the "Flag Actions Available" section. Never invent new flags.
- Only signal flags that are genuinely triggered by the player's action in this turn.
- The signal line is invisible to the player — do not reference it in narration.
- Omit the signal line entirely if no flags change this turn.

The structured scene data, player status, and triggered events are provided in each message.
Respond with narration (and optional flag signal at the end) — no OOC commentary, no markdown headers.`;

export class DMAgent {
  private client: ILLMClient;

  constructor(client: ILLMClient) {
    this.client = client;
  }

  /**
   * Stream narration for the current turn.
   * sceneContext: full context string built by GameController (scene + player status + events).
   * action: what the player did.
   * history: recent turn log for continuity.
   */
  async *narrate(
    sceneContext: string,
    action: PlayerAction,
    history: HistoryEntry[],
  ): AsyncGenerator<string> {
    const historyText = history
      .slice(-5)
      .map((h) => {
        const loc = h.locationId ? ` [${h.locationId}]` : '';
        return `Turn ${h.turn}${loc}\nPlayer: ${h.action.input}\nNarrator: ${h.narrative}`;
      })
      .join('\n\n');

    const userMessage = [
      '## Scene Data',
      sceneContext,
      '',
      '## Recent History',
      historyText || '(game start)',
      '',
      '## Player Action',
      action.input,
    ].join('\n');

    yield* this.client.stream(SYSTEM_PROMPT, [{ role: 'user', content: userMessage }]);
  }
}
