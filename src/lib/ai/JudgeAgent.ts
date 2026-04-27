// JudgeAgent — validates DM's decided proposal and produces authoritative resolution.
//
// In the DM + Judge architecture:
//   DM Phase 1  → resolution JSON (DM decides all signals upfront)
//   Judge       → resolution JSON (validates constraints; accepts DM values by default)
//   DM Phase 2  → narration based on Judge-approved resolution
//
// Two resolution types:
//   TurnResolution     — free exploration (move, flags, encounter, timeMinutes)
//   DialogueResolution — NPC dialogue encounter (endEncounter, npcState, flags, quests, timeMinutes)

import type { ILLMClient } from './ILLMClient';
import type { PlayerAction } from '../types';
import type { TurnResolution, DialogueResolution } from '../types/game';
import { JUDGE_EXPLORATION_PROMPT } from './prompts/exploration';
import { JUDGE_DIALOGUE_PROMPT } from './prompts/dialogue';
import { createLogger } from '../utils/Logger';

const log = createLogger('Judge');

// ── JudgeAgent ────────────────────────────────────────────────────────────────

export class JudgeAgent {
  private client: ILLMClient;

  /** Last raw LLM response (for debug tracing). */
  lastRaw = '';

  constructor(client: ILLMClient) {
    this.client = client;
  }

  /**
   * Validate the DM's decided proposal against free-exploration scene constraints.
   * Accept all DM values by default; only override on hard constraint violations.
   */
  async resolve(
    proposal: TurnResolution,
    action: PlayerAction,
    sceneContext: string,
  ): Promise<TurnResolution> {
    this.lastRaw = '';
    // Strip suggestions from proposal sent to Judge — Judge just copies them back,
    // no need to waste context tokens. We merge them back after parsing.
    const { suggestions: dmSuggestions, ...proposalForJudge } = proposal;
    const userMessage = [
      '## Scene Context',
      sceneContext,
      '',
      '## Player Action',
      `type: ${action.type}`,
      `input: ${action.input}`,
      '',
      '## DM Decided Proposal',
      JSON.stringify(proposalForJudge, null, 2),
      '',
      '## Task',
      'Validate the DM proposal against scene constraints. Copy all values by default.',
      'Only override move/encounter if the entity is absent from the scene.',
      'Only remove flags not in "Flag Actions Available". Copy timeMinutes exactly.',
    ].join('\n');

    const raw = await this.client.complete(JUDGE_EXPLORATION_PROMPT, userMessage, 1024);
    this.lastRaw = raw;
    log.debug('Exploration judge raw response', { length: raw.length, preview: raw.slice(0, 200) });
    const result = parseExplorationJudgeResponse(raw);
    // Merge DM suggestions back — Judge may have filtered them, but if Judge didn't output
    // suggestions at all, fall back to DM's original suggestions.
    if (!result.suggestions?.length && dmSuggestions?.length) {
      result.suggestions = dmSuggestions;
    }
    return result;
  }

  /**
   * Validate the DM's decided dialogue resolution against encounter constraints.
   * Accept all DM values by default; only override on hard constraint violations.
   */
  async resolveDialogue(
    proposal: DialogueResolution,
    npcId: string,
    npcContext: string,
  ): Promise<DialogueResolution> {
    this.lastRaw = '';
    const { suggestions: dmSuggestions, ...proposalForJudge } = proposal;
    const userMessage = [
      '## NPC Context',
      npcContext,
      '',
      '## NPC ID',
      npcId,
      '',
      '## DM Decided Proposal',
      JSON.stringify(proposalForJudge, null, 2),
      '',
      '## Task',
      'Validate the DM dialogue proposal. Copy all values by default.',
      'Only remove flags not in "Flag Actions Available". Copy timeMinutes exactly.',
      'Accept endEncounter as-is. Validate attitude values.',
    ].join('\n');

    const raw = await this.client.complete(JUDGE_DIALOGUE_PROMPT, userMessage, 1024);
    this.lastRaw = raw;
    log.debug('Dialogue judge raw response', { length: raw.length, preview: raw.slice(0, 200) });
    const result = parseDialogueJudgeResponse(raw);
    if (!result.suggestions?.length && dmSuggestions?.length) {
      result.suggestions = dmSuggestions;
    }
    return result;
  }
}

// ── Response parsers ──────────────────────────────────────────────────────────

function extractJson(raw: string): string {
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { JSON.parse(s); return s; } catch { /* fall through */ }
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end > start) return s.slice(start, end + 1);
  return s;
}

function parseExplorationJudgeResponse(raw: string): TurnResolution {
  const cleaned = extractJson(raw);

  try {
    const obj = JSON.parse(cleaned);
    const resolution: TurnResolution = {};

    if (typeof obj.move === 'string' && obj.move.length > 0) resolution.move = obj.move;
    if (typeof obj.timeMinutes === 'number' && obj.timeMinutes > 0) {
      resolution.timeMinutes = Math.min(480, Math.max(1, Math.round(obj.timeMinutes)));
    }
    if (Array.isArray(obj.flagsSet))   resolution.flagsSet   = obj.flagsSet.filter((f: unknown) => typeof f === 'string');
    if (Array.isArray(obj.flagsUnset)) resolution.flagsUnset = obj.flagsUnset.filter((f: unknown) => typeof f === 'string');
    if (obj.encounter && typeof obj.encounter === 'object') {
      resolution.encounter = obj.encounter;
    }
    if (typeof obj.reasoning === 'string' && obj.reasoning.length > 0) {
      resolution.reasoning = obj.reasoning;
    }
    if (Array.isArray(obj.suggestions)) {
      resolution.suggestions = obj.suggestions.filter((s: unknown) => typeof s === 'string' && s.length > 0).slice(0, 3);
    }

    return resolution;
  } catch (err) {
    log.error('Exploration judge JSON parse failed', { error: String(err), raw: raw.slice(0, 500), cleaned: cleaned.slice(0, 500) });
    return { timeMinutes: 10, flagsSet: [], flagsUnset: [], reasoning: '[judge parse error]' };
  }
}

function parseDialogueJudgeResponse(raw: string): DialogueResolution {
  const cleaned = extractJson(raw);

  try {
    const obj = JSON.parse(cleaned);
    const res: DialogueResolution = {
      endEncounter: obj.endEncounter === true,
    };
    if (obj.npcState && typeof obj.npcState === 'object') res.npcState = obj.npcState;
    if (typeof obj.timeMinutes === 'number' && obj.timeMinutes > 0) {
      res.timeMinutes = Math.min(60, Math.max(1, Math.round(obj.timeMinutes)));
    }
    if (Array.isArray(obj.flagsSet))   res.flagsSet   = obj.flagsSet.filter((f: unknown) => typeof f === 'string');
    if (Array.isArray(obj.flagsUnset)) res.flagsUnset = obj.flagsUnset.filter((f: unknown) => typeof f === 'string');
    if (Array.isArray(obj.questSignals)) res.questSignals = obj.questSignals;
    if (typeof obj.reasoning === 'string' && obj.reasoning.length > 0) res.reasoning = obj.reasoning;
    if (Array.isArray(obj.suggestions)) {
      res.suggestions = obj.suggestions.filter((s: unknown) => typeof s === 'string' && s.length > 0).slice(0, 3);
    }
    return res;
  } catch (err) {
    log.error('Dialogue judge JSON parse failed', { error: String(err), raw: raw.slice(0, 500), cleaned: cleaned.slice(0, 500) });
    return { endEncounter: false, flagsSet: [], flagsUnset: [], reasoning: '[dialogue judge parse error]' };
  }
}
