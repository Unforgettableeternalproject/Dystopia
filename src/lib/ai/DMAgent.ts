// DMAgent — narrates scene results via streaming.
// The DM transmits what the lore defines; it does NOT invent world content.
//
// Prompt architecture (one file per encounter type under ./prompts/):
//   exploration.ts  — free exploration (Phase 1 intent + Phase 2 narration)
//   dialogue.ts     — NPC dialogue encounter (Phase 1 intent + Phase 2 narration)
//   event.ts        — structured event encounter narration
//
// Phase 1 (intent): DM outputs decided signals as JSON → Judge validates constraints.
// Phase 2 (narrate): DM streams immersive narration based on Judge-approved resolution.

import type { PlayerAction, HistoryEntry } from '../types';
import type { ILLMClient } from './ILLMClient';
import type { TurnResolution, DialogueResolution } from '../types/game';
import { DM_NARRATION_PROMPT, DM_INTENT_PROMPT } from './prompts/exploration';
import { DIALOGUE_INTENT_PROMPT, DIALOGUE_NARRATION_PROMPT } from './prompts/dialogue';
import { EVENT_NARRATION_PROMPT, EVENT_CLOSE_PROMPT } from './prompts/event';

export type DialogueLogEntry = { speaker: 'player' | 'npc'; text: string };

// ── DMAgent ───────────────────────────────────────────────────────────────

export class DMAgent {
  private client: ILLMClient;

  /** Last raw LLM response from narrateIntent / narrateDialogueIntent (for debug tracing). */
  lastRaw = '';

  constructor(client: ILLMClient) {
    this.client = client;
  }

  // ── Free exploration ──────────────────────────────────────────────────

  /**
   * DM Phase 1 (free exploration): output decided signals as structured JSON.
   * Non-streaming. The Judge validates constraints against this proposal.
   */
  async narrateIntent(
    sceneContext: string,
    action: PlayerAction,
    history: HistoryEntry[],
  ): Promise<TurnResolution> {
    this.lastRaw = '';
    const historyText = history
      .slice(-3)
      .map(h => `Turn ${h.turn}: ${h.action.input} → ${h.narrative.slice(0, 80)}`)
      .join('\n');

    const userMessage = [
      '## Scene Context',
      sceneContext,
      '',
      '## Recent History',
      historyText || '(game start)',
      '',
      '## Player Action',
      `type: ${action.type}`,
      `input: ${action.input}`,
    ].join('\n');

    const raw = await this.client.complete(DM_INTENT_PROMPT, userMessage, 512);
    this.lastRaw = raw;
    return parseIntentResponse(raw);
  }

  /**
   * DM Phase 2 (free exploration): stream narration for the current turn.
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

    yield* this.client.stream(DM_NARRATION_PROMPT, [{ role: 'user', content: userMessage }]);
  }

  /**
   * Stream narration for world events that fired this turn, BEFORE the player action is narrated.
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

    yield* this.client.stream(DM_NARRATION_PROMPT, [{ role: 'user', content: userMessage }]);
  }

  // ── Dialogue encounter ────────────────────────────────────────────────

  /**
   * DM Phase 1 (dialogue encounter): output decided signals as structured JSON.
   * Non-streaming. The Judge validates constraints against this proposal.
   */
  async narrateDialogueIntent(
    npcContext: string,
    sessionLog: DialogueLogEntry[],
    playerInput: string,
    options?: { wrapUp?: boolean },
  ): Promise<DialogueResolution> {
    this.lastRaw = '';
    const logText = sessionLog
      .map(e => (e.speaker === 'player' ? 'Player: ' : 'NPC: ') + e.text)
      .join('\n');

    const isOpener = playerInput === '(opener)';
    const playerSection = isOpener
      ? '## 情況\nNPC 主動開口。腳本段落剛結束，或遭遇剛開始。NPC 先說話，勿等待玩家。'
      : `## Player Said\n${playerInput}`;

    const parts = [
      '## NPC Profile',
      npcContext,
      '',
      '## Conversation So Far',
      logText || '(conversation just started)',
      '',
      playerSection,
    ];

    if (options?.wrapUp) {
      parts.push(
        '',
        '## 系統提示',
        '對話已進行多輪。請將 endEncounter 設為 true，並在 narrativeSummary 說明收尾。',
      );
    }

    const raw = await this.client.complete(DIALOGUE_INTENT_PROMPT, parts.join('\n'), 512);
    this.lastRaw = raw;
    return parseDialogueIntentResponse(raw);
  }

  /**
   * DM Phase 2 (dialogue encounter): stream NPC speech.
   * All signals are resolved by Phase 1 + Judge; this method only narrates.
   */
  async *narrateDialogue(
    npcContext: string,
    sessionLog: DialogueLogEntry[],
    playerInput: string,
    options?: { endEncounter?: boolean },
  ): AsyncGenerator<string> {
    const logText = sessionLog
      .map(e => (e.speaker === 'player' ? 'Player: ' : 'NPC: ') + e.text)
      .join('\n');

    const isOpener = playerInput === '(opener)';
    const playerSection = isOpener
      ? '## 情況\nNPC 主動開口。腳本段落剛結束，或遭遇剛開始。NPC 先說話，勿等待玩家。'
      : `## Player Said\n${playerInput}`;

    const parts = [
      '## NPC Profile',
      npcContext,
      '',
      '## Conversation So Far',
      logText || '(conversation just started)',
      '',
      playerSection,
    ];

    if (options?.endEncounter) {
      parts.push(
        '',
        '## 系統提示',
        '對話即將結束。請讓 NPC 說一句合理的場面話或告別語作為收尾。不需要輸出 <<THOUGHTS>>。',
      );
    }

    yield* this.client.stream(DIALOGUE_NARRATION_PROMPT, [{ role: 'user', content: parts.join('\n') }]);
  }

  // ── Structured event encounter ────────────────────────────────────────

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

    yield* this.client.stream(EVENT_NARRATION_PROMPT, [{ role: 'user', content: userMessage }]);
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

    yield* this.client.stream(EVENT_CLOSE_PROMPT, [{ role: 'user', content: userMessage }]);
  }
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function extractJsonBlock(raw: string): string {
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { JSON.parse(s); return s; } catch { /* fall through */ }
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end > start) return s.slice(start, end + 1);
  return s;
}

function parseIntentResponse(raw: string): TurnResolution {
  const cleaned = extractJsonBlock(raw);
  try {
    const obj = JSON.parse(cleaned);
    const proposal: TurnResolution = {};
    if (typeof obj.narrativeSummary === 'string') {
      proposal.narrativeSummary = obj.narrativeSummary || '(no summary)';
    }
    if (typeof obj.move === 'string' && obj.move.length > 0) proposal.move = obj.move;
    if (typeof obj.timeMinutes === 'number' && obj.timeMinutes > 0) {
      proposal.timeMinutes = Math.min(480, Math.max(1, Math.round(obj.timeMinutes)));
    }
    if (Array.isArray(obj.flagsSet))   proposal.flagsSet   = obj.flagsSet.filter((f: unknown) => typeof f === 'string');
    if (Array.isArray(obj.flagsUnset)) proposal.flagsUnset = obj.flagsUnset.filter((f: unknown) => typeof f === 'string');
    if (obj.encounter && typeof obj.encounter === 'object') proposal.encounter = obj.encounter;
    return proposal;
  } catch {
    return { narrativeSummary: '[intent parse error]' };
  }
}

function parseDialogueIntentResponse(raw: string): DialogueResolution {
  const cleaned = extractJsonBlock(raw);
  try {
    const obj = JSON.parse(cleaned);
    const res: DialogueResolution = {
      endEncounter: obj.endEncounter === true,
    };
    if (typeof obj.narrativeSummary === 'string') res.narrativeSummary = obj.narrativeSummary;
    if (obj.npcState && typeof obj.npcState === 'object') res.npcState = obj.npcState;
    if (typeof obj.timeMinutes === 'number' && obj.timeMinutes > 0) {
      res.timeMinutes = Math.min(60, Math.max(1, Math.round(obj.timeMinutes)));
    }
    if (Array.isArray(obj.flagsSet))   res.flagsSet   = obj.flagsSet.filter((f: unknown) => typeof f === 'string');
    if (Array.isArray(obj.flagsUnset)) res.flagsUnset = obj.flagsUnset.filter((f: unknown) => typeof f === 'string');
    if (Array.isArray(obj.questSignals)) res.questSignals = obj.questSignals;
    return res;
  } catch {
    return { endEncounter: false, narrativeSummary: '[dialogue intent parse error]' };
  }
}
