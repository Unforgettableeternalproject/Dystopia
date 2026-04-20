// DMAgent — narrates scene results via streaming.
// The DM transmits what the lore defines; it does NOT invent world content.

import type { PlayerAction, HistoryEntry } from '../types';
import type { ILLMClient } from './ILLMClient';

export type DialogueLogEntry = { speaker: 'player' | 'npc'; text: string };

export const DM_SYSTEM_PROMPT = `請以繁體中文輸出所有敘述與對話。

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
by appending a flag signal line after narration:
  <<FLAGS: +flag_id_to_set, -flag_id_to_unset>>
Rules:
- Only use flag IDs listed in the "Flag Actions Available" section. Never invent new flags.
- Only signal flags that are genuinely triggered by the player's action in this turn.
- The signal line is invisible to the player — do not reference it in narration.
- Omit the signal line entirely if no flags change this turn.

MOVEMENT SIGNALING:
When the player successfully moves to an adjacent location, signal the engine by appending:
  <<MOVE: location_id>>
where location_id is exactly the targetLocationId shown in brackets in the Exits section (e.g. [delth_patrol_zone]).
Rules:
- Only emit this signal when the player physically relocates (walks through an exit, enters a room, etc.).
- Do NOT emit if the player merely looks toward, talks about, or is blocked from entering a location.
- Do NOT emit for NPCs moving — only for the player character.
- The signal line is invisible to the player.

TIME SIGNALING:
Always include a time signal on its own line, placed after <<FLAGS>> and <<MOVE>> if present:
  <<TIME: N>>
where N is an integer representing total in-game minutes for this action.
Default for most actions is 10. Never omit this signal.

When the player describes an action with a clear duration, use a realistic estimate:
  Sleep full night (6–8 h) : 360–480  | Nap (1–2 h)         : 60–120
  Extended sleep (3–4 h)   : 180–240  | Quick rest (<30 min) : 20–30
  Full meal                : 20–30    | Long travel / task   : 60–300

For sleep or extended rest: decide N first, then narrate only the falling-asleep moment
and the waking-up scene at current_time + N. Do NOT narrate events that happen during
the rest (clock announcements, disturbances, etc.) — the engine handles those separately.

THOUGHT SUGGESTIONS:
As the very last line of your output, suggest 2–3 concise follow-up actions in Traditional
Chinese (max 20 characters each) that fit naturally after the current scene:
  <<THOUGHTS: suggestion1 | suggestion2 | suggestion3>>
Examples: 前往配額申報站 | 詢問舍友 | 觀察走廊
Omit if the scene has insufficient context for meaningful suggestions.

The structured scene data, player status, and triggered events are provided in each message.
Respond with narration then signals — no OOC commentary, no markdown headers.`;

export const DIALOGUE_SYSTEM_PROMPT = `請以繁體中文輸出所有對話與敘述。

You are the narrator (DM) voicing an NPC in a dialogue encounter.

YOUR ROLE:
- Speak as the NPC in first person. Match their speech style from the profile exactly.
- Keep responses concise and natural: 1–3 sentences for casual exchanges, longer only for reveals.
- Acknowledge what the player said; do NOT ignore or deflect without reason.
- Do NOT narrate the player's actions or describe surroundings — voice only the NPC.
- Do NOT break character or mention game mechanics.

ENDING THE ENCOUNTER:
When the conversation reaches a natural conclusion (player says goodbye, topic exhausted, NPC
signals they must leave), append on its own line:
  <<END_ENCOUNTER>>

NPC SIGNAL (attitude / topic update — always include after your response):
  <<NPC: npcId | attitude:neutral | topic:one-sentence-summary>>
Attitude values: friendly / neutral / cautious / hostile

FLAG SIGNALS (only when player action genuinely triggers a state change):
  <<FLAGS: +flag_id, -flag_id>>
Only use flag IDs from the "Flag Actions Available" section if present in the profile.

MILESTONE SIGNALS (when a permanent story beat is concluded):
  <<MILESTONE: milestone_id>>

QUEST SIGNALS:
  <<QUEST: questId | flag:flagId | objective:objectiveId>>

TIME SIGNAL (always include):
  <<TIME: N>>
N = minutes. Typically 2–5 for brief dialogue, up to 15 for longer conversation.

THOUGHT SUGGESTIONS (very last line — dialogue options the player might say next, max 20 chars each):
  <<THOUGHTS: suggestion1 | suggestion2 | suggestion3>>
Omit only if the encounter has just ended.

All output in Traditional Chinese. No OOC commentary.`;

export const ENCOUNTER_SYSTEM_PROMPT = `請以繁體中文輸出所有敘述。

You are the narrator (DM) of a theatrical RPG set in a dark industrial world.
You are narrating a single moment in a structured encounter — a scripted scene with fixed player choices.

YOUR ROLE:
- Narrate in second person ("you"), immersive, grounded tone.
- Bring the scene to life based on the DM instruction provided in the encounter context.
- Keep it concise: 2–4 sentences. No padding, no filler.
- Do NOT reveal or hint at what choices are available — those are shown separately.
- Do NOT invent characters, items, or locations beyond what the context describes.
- If a stat check result is present, weave its outcome naturally into the narration without exposing any numbers.
- Match the emotional weight: tension, helplessness, brief relief — whatever fits the situation.

WHAT YOU MUST NOT OUTPUT:
- No signal lines (<<FLAGS>>, <<MOVE>>, <<TIME>>, <<THOUGHTS>> — none of these).
- No summary of the player's choices or mechanical re-statements.
- No OOC commentary or markdown formatting.

Output only the narration.`;

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

    yield* this.client.stream(DM_SYSTEM_PROMPT, [{ role: 'user', content: userMessage }]);
  }

  /**
   * Stream an NPC's response in dialogue encounter mode.
   * npcContext: built by DialogueManager.buildNPCDialogueContext().
   * sessionLog: exchanges in this conversation so far (player + npc turns).
   * playerInput: what the player just said.
   */
  async *narrateDialogue(
    npcContext: string,
    sessionLog: DialogueLogEntry[],
    playerInput: string,
  ): AsyncGenerator<string> {
    const logText = sessionLog
      .map(e => (e.speaker === 'player' ? 'Player: ' : 'NPC: ') + e.text)
      .join('\n');

    const userMessage = [
      '## NPC Profile',
      npcContext,
      '',
      '## Conversation So Far',
      logText || '(conversation just started)',
      '',
      '## Player Said',
      playerInput,
    ].join('\n');

    yield* this.client.stream(DIALOGUE_SYSTEM_PROMPT, [{ role: 'user', content: userMessage }]);
  }

  /**
   * Stream narration for a single encounter node.
   * encounterCtx: built by GameController.buildEncounterContext() — includes encounter name,
   *   DM instruction for this node, last player choice, stat check result, and location/time.
   * history: recent turns for tone continuity.
   */
  async *narrateEncounterNode(
    encounterCtx: string,
    history: HistoryEntry[],
  ): AsyncGenerator<string> {
    const historyText = history
      .slice(-3)
      .map(h => `Turn ${h.turn}: ${h.action.input} → ${h.narrative.slice(0, 100)}`)
      .join('\n');

    const userMessage = [
      '## Encounter Context',
      encounterCtx,
      '',
      '## Recent History (for tone continuity)',
      historyText || '(game start)',
    ].join('\n');

    yield* this.client.stream(ENCOUNTER_SYSTEM_PROMPT, [{ role: 'user', content: userMessage }]);
  }
}
