// JudgeValidation.test.ts
// Verifies that the Judge live pipeline's deterministic post-validation correctly gates
// dialogue encounters against resolveNPC (timePeriod + isVisible), not just npcIds.

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { shadowComparisons, shadowModeActive, activeNpcUI } from '../lib/stores/gameStore';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type { LocationNode, NPCNode, RegionIndex, RegionSchedule } from '../lib/types';
import type { TurnResolution, ExplorationShadowComparison } from '../lib/types/game';

/** Assert comparison is an exploration turn and narrow the type. */
function asExploration(cmp: unknown): ExplorationShadowComparison {
  const c = cmp as ExplorationShadowComparison;
  if (c.type !== 'exploration') throw new Error(`Expected exploration comparison, got ${c.type}`);
  return c;
}

// ── Mock LLM client ───────────────────────────────────────────────────────────
// Routes responses by system prompt content:
//   "action validator"  → Regulator JSON
//   "planning layer"    → DMProposal JSON (DM Phase 1: decided signals)
//   "You are the Judge" → TurnResolution JSON (with encounter pointing to test NPC)
//   stream()            → plain narration, no signals

class JudgeTestClient implements ILLMClient {
  readonly targetNpcId: string;

  constructor(npcId: string) {
    this.targetNpcId = npcId;
  }

  async complete(systemPrompt: string): Promise<string> {
    if (systemPrompt.includes('action validator')) {
      return JSON.stringify({ allowed: true, reason: null, modifiedInput: null, actionType: 'examine', targetId: null });
    }
    if (systemPrompt.includes('planning layer')) {
      return JSON.stringify({
        narrativeSummary: 'Player interacts with NPC.',
        timeMinutes: 5,
        flagsSet: [],
        flagsUnset: [],
        encounter: { type: 'dialogue', npcId: this.targetNpcId },
      } satisfies TurnResolution);
    }
    if (systemPrompt.includes('You are the Judge')) {
      return JSON.stringify({
        move: null,
        timeMinutes: 5,
        flagsSet: [],
        flagsUnset: [],
        encounter: { type: 'dialogue', npcId: this.targetNpcId },
        reasoning: '',
      });
    }
    return '';
  }

  async *stream(): AsyncGenerator<string> {
    yield '你環顧四周。<<TIME: 5>>';
  }
}

// ── Lore builders ─────────────────────────────────────────────────────────────

function makeLocation(npcId: string): LocationNode {
  return {
    id: 'delth_dormitory_room',
    name: 'Test Room',
    regionId: 'crambell',
    tags: [],
    base: {
      description: 'A test location.',
      ambience: [],
      connections: [],
      npcIds: [npcId],
      eventIds: [],
      isAccessible: true,
    },
    localVariants: [],
  };
}

function makeNpc(id: string, availablePeriods?: Array<'work' | 'rest' | 'special'>): NPCNode {
  return {
    id,
    name: '測試 NPC',
    type: 'stationed',
    baseLocationId: 'delth_dormitory_room',
    publicDescription: '一個測試用 NPC',
    dialogueId: id,
    isVisible: true,
    ...(availablePeriods ? { availablePeriods } : {}),
  };
}

function makeRegion(): RegionIndex {
  return {
    id: 'crambell',
    name: 'Crambell',
    theme: 'test',
    locationIds: ['delth_dormitory_room'],
    npcIds: [],
    questIds: [],
    factionIds: [],
  };
}

function makeSchedule(): RegionSchedule {
  return {
    regionId: 'crambell',
    periods: [
      { id: 'work', label: '作業', startHour: 6,  startMinute: 0, endHour: 18, endMinute: 0 },
      { id: 'rest', label: '休息', startHour: 18, startMinute: 0, endHour: 6,  endMinute: 0 },
    ],
  };
}

// Flush all pending microtasks so fire-and-forget shadow pipeline can complete.
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  // Give a tick for any additional promise chains inside runShadowPipeline.
  await new Promise(r => setTimeout(r, 0));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JudgeValidation — dialogue encounter deterministic check', () => {
  beforeEach(() => {
    shadowComparisons.set([]);
    shadowModeActive.set(false);
    activeNpcUI.set(null);  // reset between tests — live Judge pipeline may open NPC panels
  });

  it('rejects encounter when NPC is outside availablePeriods for current timePeriod', async () => {
    // NPC only available during 'work'; initial timePeriod is 'rest' (hour 21)
    const npcId = 'npc_work_only';
    const client = new JudgeTestClient(npcId);
    const controller = new GameController({ dm: client, regulator: client });

    controller.loadLore({
      locations: { delth_dormitory_room: makeLocation(npcId) },
      npcs:      { [npcId]: makeNpc(npcId, ['work']) },
      regions:   { crambell: makeRegion() },
      schedules: { crambell: makeSchedule() },
    });

    controller.debugToggleShadowMode();
    await controller.submitAction('看看周圍有誰', 'examine');
    await flushAsync();

    const comps = get(shadowComparisons);
    expect(comps.length).toBeGreaterThan(0);

    const latest = asExploration(comps[0]);
    // After deterministic validation: NPC not in 'rest' period → encounter cleared
    expect(latest.judgeResolution.encounter).toBeUndefined();
    // reasoning should note why it was cleared
    expect(latest.judgeResolution.reasoning ?? '').not.toBe('');
  });

  it('accepts encounter when NPC has no period restriction', async () => {
    // NPC with no availablePeriods (always available)
    const npcId = 'npc_always';
    const client = new JudgeTestClient(npcId);
    const controller = new GameController({ dm: client, regulator: client });

    controller.loadLore({
      locations: { delth_dormitory_room: makeLocation(npcId) },
      npcs:      { [npcId]: makeNpc(npcId) }, // no availablePeriods = always shown
      regions:   { crambell: makeRegion() },
      schedules: { crambell: makeSchedule() },
    });

    controller.debugToggleShadowMode();
    await controller.submitAction('和 NPC 說話', 'examine');
    await flushAsync();

    const comps = get(shadowComparisons);
    expect(comps.length).toBeGreaterThan(0);

    // submitAction triggers handleDialogueInput which pushes a dialogue comparison first;
    // we want the exploration comparison that contains the encounter decision.
    const explorationComp = comps.find(c => c.type === 'exploration');
    expect(explorationComp).toBeDefined();
    const latest = asExploration(explorationComp!);
    // NPC always available → encounter kept
    expect(latest.judgeResolution.encounter).toBeDefined();
    expect(latest.judgeResolution.encounter?.npcId).toBe(npcId);
  });

  it('rejects encounter when NPC isVisible is false', async () => {
    const npcId = 'npc_invisible';
    const client = new JudgeTestClient(npcId);
    const controller = new GameController({ dm: client, regulator: client });

    const invisibleNpc: NPCNode = { ...makeNpc(npcId), isVisible: false };
    controller.loadLore({
      locations: { delth_dormitory_room: makeLocation(npcId) },
      npcs:      { [npcId]: invisibleNpc },
      regions:   { crambell: makeRegion() },
      schedules: { crambell: makeSchedule() },
    });

    controller.debugToggleShadowMode();
    await controller.submitAction('看看四周', 'examine');
    await flushAsync();

    const comps = get(shadowComparisons);
    expect(comps.length).toBeGreaterThan(0);
    expect(asExploration(comps[0]).judgeResolution.encounter).toBeUndefined();
  });

  it('rejects encounter when npcId is not in location npcIds', async () => {
    const npcId = 'npc_elsewhere';
    const client = new JudgeTestClient(npcId);
    const controller = new GameController({ dm: client, regulator: client });

    // Location has a different NPC, not npc_elsewhere
    const location = makeLocation('npc_other');
    controller.loadLore({
      locations: { delth_dormitory_room: location },
      npcs:      { [npcId]: makeNpc(npcId), npc_other: makeNpc('npc_other') },
      regions:   { crambell: makeRegion() },
      schedules: { crambell: makeSchedule() },
    });

    controller.debugToggleShadowMode();
    await controller.submitAction('找人說話', 'examine');
    await flushAsync();

    const comps = get(shadowComparisons);
    expect(comps.length).toBeGreaterThan(0);
    expect(asExploration(comps[0]).judgeResolution.encounter).toBeUndefined();
  });
});
