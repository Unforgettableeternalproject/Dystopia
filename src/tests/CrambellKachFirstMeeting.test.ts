// CrambellKachFirstMeeting.test.ts
//
// 凱奇初次會面依時段播放不同問候，之後一律接到共用的森林提問節點（kach_forest_ask）。
// 驗證：時段觸發、共用節點、effects 只套用一次、第二次對話不再觸發 first_meeting、nodeId 引用有效。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../lib/engine/EventBus';
import { StateManager } from '../lib/engine/StateManager';
import { DialogueManager } from '../lib/engine/DialogueManager';
import { LoreVault } from '../lib/lore/LoreVault';
import type { GameState } from '../lib/types/game';
import type { DialogueProfile } from '../lib/types/dialogue';

const REPO_ROOT = new URL('../../', import.meta.url);
const NPC = 'crambell_kach';
const PROFILE = 'crambell_kach_default';
const FIRST_MEETING_NODES = ['first_meeting_work', 'first_meeting_rest', 'first_meeting'];

function readProfile(): DialogueProfile {
  return JSON.parse(readFileSync(
    new URL(`lore/world/regions/crambell/dialogues/${PROFILE}.json`, REPO_ROOT), 'utf8',
  )) as DialogueProfile;
}

function makeState(hour: number, minute = 0): GameState {
  return {
    player: {
      id: 'kach-first-meeting',
      name: 'Tester',
      origin: 'worker',
      currentLocationId: 'delth_mine_worksite',
      primaryStats:       { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
      primaryStatsExp:    { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      inclinationTracker: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      dailyGrantTracker:  { dateKey: '1498-6-12', grantedExp: {} },
      secondaryStats: { consciousness: 0, mysticism: 0, technology: 0 },
      statusStats: {
        stamina: 10, staminaMax: 10,
        stress: 0, stressMax: 10,
        endo: 0, endoMax: 0,
        experience: 0, fatigue: 0,
      },
      externalStats: { reputation: {}, affinity: {}, familiarity: {} },
      inventory: [],
      melphin: 0,
      activeFlags: new Set(),
      titles: [],
      conditions: [],
      knownIntelIds: [],
    },
    turn: 0,
    phase: 'exploring',
    pendingThoughts: [],
    lastNarrative: '',
    history: [],
    discoveredLocationIds: [],
    activeQuests: {},
    completedQuestIds: [],
    npcMemory: {},
    worldPhase: { currentPhase: 'phase_1', appliedPhaseIds: [] },
    time: { year: 1498, month: 6, day: 12, hour, minute, totalMinutes: 0 },
    timePeriod: hour >= 6 && hour < 18 ? 'work' : 'rest',
    eventCooldowns: {},
    eventCounters: {},
    attemptCooldowns: {},
    propFlags: {},
  };
}

function setup(hour: number, minute = 0) {
  const lore = new LoreVault();
  lore.load({ dialogues: { [PROFILE]: readProfile() } });
  const state = new StateManager(makeState(hour, minute), new EventBus());
  const dialogueMgr = new DialogueManager(lore, state);
  return { state, dialogueMgr };
}

describe('凱奇初次會面時段問候', () => {
  it.each([
    [10, 0, 'first_meeting_work'],
    [17, 59, 'first_meeting_work'],
    [18, 0, 'first_meeting_rest'],
    [22, 0, 'first_meeting_rest'],
    [5, 59, 'first_meeting_rest'],
    [6, 0, 'first_meeting_work'],
  ])('%i:%i 觸發 %s', (hour, minute, expected) => {
    const { state, dialogueMgr } = setup(hour, minute);
    const r = dialogueMgr.checkScriptedTrigger(NPC, PROFILE, state.flags, 0);
    expect(r?.nodeId).toBe(expected);
  });

  it('工作與休息時段問候不同，且都接到同一個森林提問節點', () => {
    const workCtx = setup(10);
    const work = workCtx.dialogueMgr.checkScriptedTrigger(NPC, PROFILE, workCtx.state.flags, 0)!;
    const restCtx = setup(22);
    const rest = restCtx.dialogueMgr.checkScriptedTrigger(NPC, PROFILE, restCtx.state.flags, 0)!;

    expect(work.nodeId).not.toBe(rest.nodeId);
    const greeting = (n: typeof work) => n.node.lines.find(l => l.speaker === 'npc')!.text;
    expect(greeting(work)).not.toBe(greeting(rest));
    // 休息時段不應提到開工
    expect(greeting(rest)).not.toContain('工作');

    for (const r of [work, rest]) {
      expect(r.node.choices).toHaveLength(1);
      expect(r.node.choices[0].nextNodeId).toBe('kach_forest_ask');
      expect(r.node.choices[0].effects).toBeUndefined();
    }
    const forest = restCtx.dialogueMgr.getNode(NPC, PROFILE, 'kach_forest_ask')!;
    expect(forest.lines.some(l => l.text.includes('森林'))).toBe(true);
  });

  it.each([10, 22])('%i 點走完一條分支：effects 只套用一次，第二次對話不再觸發 first_meeting', (hour) => {
    const { state, dialogueMgr } = setup(hour);
    const first = dialogueMgr.checkScriptedTrigger(NPC, PROFILE, state.flags, 0)!;
    expect(FIRST_MEETING_NODES).toContain(first.nodeId);

    // 問候 → 共用森林節點
    const bridge = dialogueMgr.filterChoices(first.node.choices, state.flags)[0];
    dialogueMgr.applyChoiceEffects(NPC, bridge.effects);
    const forest = dialogueMgr.getNode(NPC, PROFILE, bridge.nextNodeId!)!;

    // friendly_agree (+1) → kach_intro_follow_up → accept (+1, flags)
    const agree = dialogueMgr.filterChoices(forest.choices, state.flags).find(c => c.id === 'friendly_agree')!;
    dialogueMgr.applyChoiceEffects(NPC, agree.effects);
    const followUp = dialogueMgr.getNode(NPC, PROFILE, agree.nextNodeId!)!;
    const accept = followUp.choices.find(c => c.id === 'accept')!;
    dialogueMgr.applyChoiceEffects(NPC, accept.effects);
    expect(accept.nextNodeId).toBeNull();

    expect(state.flags.has('crambell_kach_met')).toBe(true);
    expect(state.flags.has('kach_hangout_accepted')).toBe(true);
    expect(state.getState().player.externalStats.affinity[NPC]).toBe(2);

    // 第二次對話（interactionCount = 1）不再觸發任何 first_meeting 變體
    const second = dialogueMgr.checkScriptedTrigger(NPC, PROFILE, state.flags, 1);
    expect(second === null || !FIRST_MEETING_NODES.includes(second.nodeId)).toBe(true);
  });

  it('first_meeting 觸發順序：時段變體在前，無 timeRanges 的通用版在最後', () => {
    const triggers = readProfile().triggers!.filter(t => t.firstMeetingOnly);
    expect(triggers.map(t => t.nodeId)).toEqual(FIRST_MEETING_NODES);
    expect(triggers[2].timeRanges).toBeUndefined();
  });

  it('所有 nodeId 引用有效', () => {
    const profile = readProfile();
    const nodes = profile.nodes ?? {};
    for (const t of profile.triggers ?? []) expect(nodes, t.nodeId).toHaveProperty([t.nodeId]);
    for (const [id, node] of Object.entries(nodes)) {
      for (const c of node.choices) {
        if (c.nextNodeId !== null) expect(nodes, `${id}.${c.id}`).toHaveProperty([c.nextNodeId]);
        for (const b of c.branches ?? []) expect(nodes, `${id}.${c.id}`).toHaveProperty([b.nodeId]);
      }
    }
  });
});
