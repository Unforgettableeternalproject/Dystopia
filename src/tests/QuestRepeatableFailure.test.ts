import { describe, it, expect } from 'vitest';
import { QuestEngine } from '../lib/engine/QuestEngine';
import { StateManager } from '../lib/engine/StateManager';
import { EventBus } from '../lib/engine/EventBus';
import { LoreVault } from '../lib/lore/LoreVault';
import type { GameState } from '../lib/types';
import type { QuestDefinition } from '../lib/types/quest';

function makeGameState(): GameState {
  return {
    player: {
      id: 'test',
      name: 'Tester',
      origin: 'worker',
      currentLocationId: 'loc_start',
      primaryStats:       { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
      primaryStatsExp:    { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      inclinationTracker: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      dailyGrantTracker:  { dateKey: '1498-6-12', grantedExp: {} },
      secondaryStats: { consciousness: 2, mysticism: 0, technology: 3 },
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
    worldPhase: { currentPhase: 'phase_1', appliedPhaseIds: [] },
    pendingThoughts: [],
    lastNarrative: '',
    history: [],
    discoveredLocationIds: [],
    activeQuests: {},
    completedQuestIds: [],
    npcMemory: {},
    time: { year: 1498, month: 6, day: 12, hour: 21, minute: 23, totalMinutes: 0 },
    timePeriod: 'rest',
    eventCooldowns: {},
    eventCounters: {},
    attemptCooldowns: {},
    propFlags: {},
  };
}

function makeSetup(quests: QuestDefinition[]) {
  const lore = new LoreVault();
  lore.load({ quests: Object.fromEntries(quests.map(q => [q.id, q])) });
  const bus = new EventBus();
  const state = new StateManager(makeGameState(), bus);
  const engine = new QuestEngine(lore, state);
  return { state, engine };
}

describe('QuestEngine repeatable failures', () => {
  it('sets and clears the generic quest active flag across the quest lifecycle', () => {
    const quest: QuestDefinition = {
      id: 'q_active_flag',
      name: 'Quest Active Flag',
      type: 'side',
      source: 'event',
      isRepeatable: true,
      entryStageId: 'apply',
      stages: {
        apply: {
          id: 'apply',
          description: 'apply',
          objectives: [{ id: 'o1', type: 'flag_check', description: 'done', flag: 'done' }],
          onComplete: { nextStageId: null },
          onFail: { nextStageId: null },
        },
      },
    };

    const { state, engine } = makeSetup([quest]);
    expect(engine.grantQuest('q_active_flag')).toBe(true);
    expect(state.flags.has('q_active_flag:active')).toBe(true);

    engine.applyQuestFail('q_active_flag');

    expect(state.flags.has('q_active_flag:active')).toBe(false);
    expect(engine.grantQuest('q_active_flag')).toBe(true);
    expect(state.flags.has('q_active_flag:active')).toBe(true);
  });

  it('removes repeatable quests from activeQuests after a terminal fail', () => {
    const quest: QuestDefinition = {
      id: 'q_repeat_fail',
      name: 'Repeatable Fail Quest',
      type: 'side',
      source: 'event',
      isRepeatable: true,
      entryStageId: 'apply',
      stages: {
        apply: {
          id: 'apply',
          description: 'apply',
          objectives: [{ id: 'o1', type: 'flag_check', description: 'done', flag: 'done' }],
          onComplete: { nextStageId: null },
          onFail: {
            nextStageId: null,
            flagsSet: ['repeat_fail_cleanup_ran'],
          },
        },
      },
    };

    const { state, engine } = makeSetup([quest]);
    expect(engine.grantQuest('q_repeat_fail')).toBe(true);

    engine.applyQuestFail('q_repeat_fail');

    expect(state.flags.has('repeat_fail_cleanup_ran')).toBe(true);
    expect(state.getState().activeQuests['q_repeat_fail']).toBeUndefined();
    expect(state.getState().completedQuestIds).not.toContain('q_repeat_fail');
    expect(engine.grantQuest('q_repeat_fail')).toBe(true);
  });

  it('keeps non-repeatable failures recorded as completed', () => {
    const quest: QuestDefinition = {
      id: 'q_once_fail',
      name: 'Once Fail Quest',
      type: 'side',
      source: 'event',
      entryStageId: 'apply',
      stages: {
        apply: {
          id: 'apply',
          description: 'apply',
          objectives: [{ id: 'o1', type: 'flag_check', description: 'done', flag: 'done' }],
          onComplete: { nextStageId: null },
          onFail: { nextStageId: null },
        },
      },
    };

    const { state, engine } = makeSetup([quest]);
    expect(engine.grantQuest('q_once_fail')).toBe(true);

    engine.applyQuestFail('q_once_fail');

    expect(state.getState().activeQuests['q_once_fail']?.isFailed).toBe(true);
    expect(state.getState().completedQuestIds).toContain('q_once_fail');
  });
});
