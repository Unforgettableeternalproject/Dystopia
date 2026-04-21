// DMAgent — narrates scene results via streaming.
// The DM transmits what the lore defines; it does NOT invent world content.
//
// Prompt architecture:
//   DM_SYSTEM_PROMPT          — free exploration (non-encounter)
//   ENCOUNTER_BASE_PROMPT     — base for all encounter types
//     + ENCOUNTER_DIALOGUE_ADDENDUM  → NPC dialogue encounter
//     + ENCOUNTER_EVENT_ADDENDUM     → structured event encounter
//     (future: ENCOUNTER_STORY_ADDENDUM, ENCOUNTER_COMBAT_ADDENDUM, ...)
//
// Use buildEncounterPrompt(type) to assemble the correct system prompt.

import type { PlayerAction, HistoryEntry } from '../types';
import type { ILLMClient } from './ILLMClient';

export type DialogueLogEntry = { speaker: 'player' | 'npc'; text: string };

// ── Free exploration prompt ───────────────────────────────────────────────

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
When the player successfully moves to a location, signal the engine by appending:
  <<MOVE: location_id>>
where location_id is exactly the targetLocationId shown in the Exits section.
Rules:
- Only emit this signal when the player physically relocates to a destination.
- Do NOT emit if the player merely looks toward, talks about, or is blocked from entering a location.
- Do NOT emit for NPCs moving — only for the player character.
- The signal line is invisible to the player.

MULTI-HOP NAVIGATION:
When a "### Navigation Route (engine-resolved)" block appears in the scene context:
- The engine has already validated a path to a non-adjacent previously-discovered location.
- Narrate the full journey naturally (passing through intermediate areas) without revealing mechanical path details.
- Emit <<MOVE: location_id>> using the Destination ID shown in that block.
- Use the provided time value for <<TIME: N>> (e.g. <<TIME: 15>>).

ENCOUNTER SIGNALING:
When the player initiates contact with an NPC or a scene event triggers a structured encounter, signal:
  <<ENCOUNTER: dialogue | npc: npc_id>>       (player approaches / speaks to an NPC)
  <<ENCOUNTER: event | id: encounter_id>>      (scene event triggers a structured encounter)
Rules:
- Only emit when the player's action directly causes an encounter to begin.
- Use the exact npc_id or encounter_id from the scene data.
- The signal line is invisible to the player.

CRITICAL — SIGNAL FORMAT:
All signal markers MUST use ASCII double angle brackets: << and >>
Do NOT use Chinese guillemets 《 or 》 in signal lines under any circumstances.

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

// ── Encounter base prompt ─────────────────────────────────────────────────
// Common constraints shared by all encounter types.
// Always append a type-specific addendum via buildEncounterPrompt().

const ENCOUNTER_BASE_PROMPT = `請以繁體中文輸出所有敘述與對話。

You are the narrator (DM) operating inside an encounter — a self-contained scene
separate from free exploration.

GROUND RULES (apply to all encounter types):
- Do NOT invent characters, items, locations, or lore not present in the provided context.
- Do NOT reveal flag names, stat numbers, or any engine internals to the player.
- Do NOT produce OOC commentary or markdown formatting.
- All output in Traditional Chinese.

SIGNAL FORMAT:
All signal markers MUST use ASCII double angle brackets: << and >>
Do NOT use Chinese guillemets 《 or 》 under any circumstances.`;

// ── Dialogue encounter addendum ───────────────────────────────────────────

const ENCOUNTER_DIALOGUE_ADDENDUM = `

--- ENCOUNTER TYPE: DIALOGUE ---

You are voicing a single NPC in a dialogue encounter.

YOUR ROLE:
- Speak as the NPC in first person. Match their speech style from the profile exactly.
- Keep responses concise and natural: 1–3 sentences for casual exchanges, longer only for reveals.
- Acknowledge what the player said; do NOT ignore or deflect without reason.
- Do NOT narrate the player's actions or describe surroundings — voice only the NPC.
- Do NOT break character or mention game mechanics.

OPENER MODE: If the "Player Said" section is absent or contains "(opener)", the NPC
should naturally open or continue the conversation — a greeting, remark, or question
fitting the context. Do NOT reference "(opener)". Do NOT wait for the player to speak first.

SIGNALS (append after your NPC response, in this order if applicable):

End of conversation — when it reaches a natural conclusion (goodbye, topic exhausted, NPC must leave):
  <<END_ENCOUNTER>>

NPC state update — always include after every response:
  <<NPC_STATE: attitude:neutral | topic:one-sentence-summary>>
  Attitude values: friendly / neutral / cautious / hostile

Flag signals — only when the player's action genuinely triggers a state change:
  <<FLAGS: +flag_id, -flag_id>>
  Only use IDs from the "Flag Actions Available" section. Omit if nothing changes.

Quest signal:
  <<QUEST: questId | flag:flagId | objective:objectiveId>>

Time elapsed — always include:
  <<TIME: N>>
  N = minutes. Typically 2–5 for brief exchanges, up to 15 for longer scenes.

Thought suggestions — very last line, dialogue options the player might say next (max 20 chars each):
  <<THOUGHTS: suggestion1 | suggestion2 | suggestion3>>
  Omit only if <<END_ENCOUNTER>> was emitted.`;

// ── Event encounter addendum ──────────────────────────────────────────────

const ENCOUNTER_EVENT_ADDENDUM = `

--- ENCOUNTER TYPE: EVENT ---

You are narrating a moment in a structured event encounter with fixed player choices.

YOUR ROLE:
- Narrate in second person ("you"), immersive, grounded tone.
- Bring the scene to life based on the DM instruction provided in the encounter context.
- Keep it concise: 2–4 sentences. No padding, no filler.
- Do NOT reveal or hint at what choices are available — those are shown separately.
- If a stat check result is present, weave its outcome naturally without exposing any numbers.
- Match the emotional weight: tension, helplessness, brief relief — whatever fits.

Output only the narration. No signal lines of any kind.`;

// ── Prompt builder ────────────────────────────────────────────────────────

type EncounterPromptType = 'dialogue' | 'event' | 'event-close';

export function buildEncounterPrompt(type: EncounterPromptType): string {
  switch (type) {
    case 'dialogue':
      return ENCOUNTER_BASE_PROMPT + ENCOUNTER_DIALOGUE_ADDENDUM;
    case 'event':
      return ENCOUNTER_BASE_PROMPT + ENCOUNTER_EVENT_ADDENDUM;
    case 'event-close':
      return ENCOUNTER_BASE_PROMPT + ENCOUNTER_EVENT_ADDENDUM +
        '\n\nThis is the CLOSING narration of the encounter. Briefly describe how the situation resolves and the player returns to the normal flow. 1–3 sentences.';
  }
}

// ── DMAgent ───────────────────────────────────────────────────────────────

export class DMAgent {
  private client: ILLMClient;

  constructor(client: ILLMClient) {
    this.client = client;
  }

  /**
   * Stream narration for the current turn (free exploration).
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
   * Stream narration for world events that fired this turn, BEFORE the player action is narrated.
   * This keeps event narration and action response separate so they don't bleed together.
   * No signals are emitted — the engine has already applied all state changes.
   */
  async *narrateWorldEvent(
    sceneContext: string,
    history: HistoryEntry[],
  ): AsyncGenerator<string> {
    const historyText = history
      .slice(-3)
      .map(h => `Turn ${h.turn}: ${h.action.input} → ${h.narrative.slice(0, 80)}`)
      .join('\n\n');

    const userMessage = [
      '## Scene Data',
      sceneContext,
      '',
      '## Recent History',
      historyText || '(game start)',
      '',
      '## World Event',
      '（背景世界事件在此刻觸發。請根據上方「Events This Turn」中的觸發內容，以沉浸式第二人稱描述正在發生的事，2–4句，語氣配合場景氛圍。' +
      '請勿回應任何玩家行動。請勿輸出任何 <<>> 訊號標記。）',
    ].join('\n');

    yield* this.client.stream(DM_SYSTEM_PROMPT, [{ role: 'user', content: userMessage }]);
  }

  /**
   * Stream an NPC's response in a dialogue encounter.
   * npcContext: built by DialogueManager.buildNPCDialogueContext().
   */
  async *narrateDialogue(
    npcContext: string,
    sessionLog: DialogueLogEntry[],
    playerInput: string,
  ): AsyncGenerator<string> {
    const logText = sessionLog
      .map(e => (e.speaker === 'player' ? 'Player: ' : 'NPC: ') + e.text)
      .join('\n');

    const isOpener = playerInput === '(opener)';
    const playerSection = isOpener
      ? '## 情況\nNPC 主動開口。腳本段落剛結束，或遭遇剛開始。NPC 先說話，勿等待玩家。'
      : `## Player Said\n${playerInput}`;

    const userMessage = [
      '## NPC Profile',
      npcContext,
      '',
      '## Conversation So Far',
      logText || '(conversation just started)',
      '',
      playerSection,
    ].join('\n');

    yield* this.client.stream(buildEncounterPrompt('dialogue'), [{ role: 'user', content: userMessage }]);
  }

  /**
   * Stream narration for a single structured event encounter node.
   * encounterCtx: built by GameController.buildEncounterContext().
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

    yield* this.client.stream(buildEncounterPrompt('event'), [{ role: 'user', content: userMessage }]);
  }

  /**
   * Stream a closing narration when an event encounter ends without an outcome node.
   * closeCtx: built by GameController.buildEncounterCloseContext().
   */
  async *narrateEncounterClose(
    closeCtx: string,
    history: HistoryEntry[],
  ): AsyncGenerator<string> {
    const historyText = history
      .slice(-3)
      .map(h => `Turn ${h.turn}: ${h.action.input} → ${h.narrative.slice(0, 100)}`)
      .join('\n');

    const userMessage = [
      '## Encounter Context',
      closeCtx,
      '',
      '## Recent History (for tone continuity)',
      historyText || '(game start)',
    ].join('\n');

    yield* this.client.stream(buildEncounterPrompt('event-close'), [{ role: 'user', content: userMessage }]);
  }
}
