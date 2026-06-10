import { describe, it, expect, beforeEach } from 'vitest';
import { FactionTreeEngine } from '../lib/engine/FactionTreeEngine';
import { QuestEngine } from '../lib/engine/QuestEngine';
import { StateManager } from '../lib/engine/StateManager';
import { EventBus } from '../lib/engine/EventBus';
import { LoreVault } from '../lib/lore/LoreVault';
import type { GameState } from '../lib/types';
import type { QuestDefinition } from '../lib/types/quest';
import type { FactionDefinition } from '../lib/types/faction';

// ── Fixtures ─────────────────────────────────────────────────────

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
        stress:  0,  stressMax:  10,
        endo:    0,  endoMax:    0,
        experience: 0, fatigue: 0,
      },
      externalStats: { reputation: {}, affinity: {}, familiarity: {} },
      inventory:    [],
      melphin:      0,
      activeFlags:  new Set(),
      titles:       [],
      conditions:   [],
      knownIntelIds: [],
    },
    turn:   0,
    phase:  'exploring',
    worldPhase: { currentPhase: 'phase_1', appliedPhaseIds: [] },
    pendingThoughts: [],
    lastNarrative:   '',
    history:         [],
    discoveredLocationIds: [],
    activeQuests:          {},
    completedQuestIds:     [],
    npcMemory:             {},
    time: { year: 1498, month: 6, day: 12, hour: 21, minute: 23, totalMinutes: 0 },
    timePeriod: 'rest',
    eventCooldowns: {},
    eventCounters: {},
    attemptCooldowns: {},
    propFlags: {},
  };
}

// A faction with credit config and epic definition
const FACTION_TREFFEN: FactionDefinition = {
  id: 'test_treffen',
  name: '舊會議',
  regionId: 'test',
  description: '測試用舊會議',
  defaultReputation: 0,
  credit: {
    initialValue: 0,
    positiveLimit: 100,
    negativeLimit: -50,
    breakpointPercent: 15,
    ditchPenaltyPercent: 70,
    initialQuestBonus: 10,
  },
  epic: {
    id: 'test_epic',
    label: '測試主線',
    checkpoints: [
      {
        id: 'cp1',
        label: '初步測試',
        order: 0,
        requiredQuestIds: ['q_test1'],
        flagsSet: ['cp1_done'],
      },
      {
        id: 'cp2',
        label: '完全信任',
        order: 1,
        requiredQuestIds: ['q_test3'],
        flagsSet: ['cp2_done'],
        unlocksQuestIds: ['q_contact'],
      },
    ],
    questLines: [
      {
        id: 'test_line',
        label: '測試線',
        entryQuestId: 'q_test1',
        contributesToCheckpoints: ['cp1', 'cp2'],
        solePathToCheckpoint: 'cp2',
      },
    ],
    completionFlags: ['epic_done'],
  },
};

// Initial quest (triggers faction join + credit bonus)
const QUEST_INITIAL: QuestDefinition = {
  id: 'q_test1',
  name: '測試一',
  type: 'side',
  source: 'npc',
  factionId: 'test_treffen',
  questCategory: 'initial',
  questLineId: 'test_line',
  nextQuestId: 'q_test2',
  coupling: { test_treffen: 0.5 },
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1',
      description: '完成目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'test_done' }],
      onComplete: { nextStageId: null },
    },
  },
};

// Story quest — middle of chain
const QUEST_STORY: QuestDefinition = {
  id: 'q_test2',
  name: '測試二',
  type: 'side',
  source: 'npc',
  factionId: 'test_treffen',
  questCategory: 'story',
  questLineId: 'test_line',
  nextQuestId: 'q_test3',
  coupling: { test_treffen: 0.7 },
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1',
      description: '完成目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'test_done2' }],
      onComplete: { nextStageId: null },
    },
  },
};

// Critical quest — completing it advances CP2
const QUEST_CRITICAL: QuestDefinition = {
  id: 'q_test3',
  name: '測試三',
  type: 'side',
  source: 'npc',
  factionId: 'test_treffen',
  questCategory: 'critical',
  questLineId: 'test_line',
  coupling: { test_treffen: 0.9 },
  canDitch: true,
  ditchConsequences: {
    reputationChanges: { test_treffen: -20 },
    flagsSet: ['treffen_betrayed'],
  },
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1',
      description: '完成目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'test_done3' }],
      onComplete: { nextStageId: null },
    },
  },
};

// General quest — no faction
const QUEST_GENERAL: QuestDefinition = {
  id: 'q_general',
  name: '一般任務',
  type: 'side',
  source: 'npc',
  questCategory: 'general',
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1',
      description: '完成目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'gen_flag' }],
      onComplete: { nextStageId: null },
    },
  },
};

// ── Test Harness ─────────────────────────────────────────────────

let lore: LoreVault;
let bus: EventBus;
let state: StateManager;
let quests: QuestEngine;
let factionTree: FactionTreeEngine;

function setup(gs?: GameState) {
  lore = new LoreVault();
  lore.load({
    factions: {
      test_treffen: FACTION_TREFFEN as any,
    },
    quests: {
      q_test1:   QUEST_INITIAL,
      q_test2:   QUEST_STORY,
      q_test3:   QUEST_CRITICAL,
      q_general: QUEST_GENERAL,
    },
  });

  bus = new EventBus();
  state = new StateManager(gs ?? makeGameState(), bus);
  quests = new QuestEngine(lore, state);
  factionTree = new FactionTreeEngine(lore, state);
  quests.setFactionTree(factionTree);
}

beforeEach(() => setup());

// ── Tests ────────────────────────────────────────────────────────

describe('FactionTreeEngine', () => {
  describe('initFactionRelation', () => {
    it('initializes relation state and credit', () => {
      factionTree.initFactionRelation('test_treffen');

      const relation = state.getFactionRelation('test_treffen');
      expect(relation).toBeDefined();
      expect(relation!.isJoined).toBe(false);
      expect(relation!.completedCheckpointIds).toEqual([]);
      expect(relation!.creditBreakpointHit).toBe(false);
    });

    it('is idempotent — second call is a no-op', () => {
      factionTree.initFactionRelation('test_treffen');
      state.updateFactionRelation('test_treffen', { isJoined: true });
      factionTree.initFactionRelation('test_treffen');

      expect(state.getFactionRelation('test_treffen')!.isJoined).toBe(true);
    });
  });

  describe('onQuestComplete (initial quest)', () => {
    it('joins faction and grants initial credit bonus', () => {
      // Grant and complete the initial quest
      quests.grantQuest('q_test1');
      state.flags.set('test_done');
      quests.checkObjectives();

      const relation = state.getFactionRelation('test_treffen');
      expect(relation).toBeDefined();
      expect(relation!.isJoined).toBe(true);

      const credit = state.getState().player.externalStats.credit?.['test_treffen'];
      expect(credit).toBe(10); // initialQuestBonus
    });

    it('advances checkpoint when initial quest completes', () => {
      quests.grantQuest('q_test1');
      state.flags.set('test_done');
      quests.checkObjectives();

      const relation = state.getFactionRelation('test_treffen');
      expect(relation!.completedCheckpointIds).toContain('cp1');
      expect(state.flags.has('cp1_done')).toBe(true);
    });
  });

  describe('onQuestComplete (critical quest → CP2)', () => {
    it('advances second checkpoint and sets flags', () => {
      // Complete test1 first to establish relation
      quests.grantQuest('q_test1');
      state.flags.set('test_done');
      quests.checkObjectives();

      // Complete test3 (critical)
      quests.grantQuest('q_test3');
      state.flags.set('test_done3');
      quests.checkObjectives();

      const relation = state.getFactionRelation('test_treffen');
      expect(relation!.completedCheckpointIds).toContain('cp2');
      expect(state.flags.has('cp2_done')).toBe(true);
    });

    it('sets epic completion flags when all checkpoints done', () => {
      // Complete test1
      quests.grantQuest('q_test1');
      state.flags.set('test_done');
      quests.checkObjectives();

      // Complete test3
      quests.grantQuest('q_test3');
      state.flags.set('test_done3');
      quests.checkObjectives();

      expect(state.flags.has('epic_done')).toBe(true);
    });
  });

  describe('onQuestDitch (credit penalty)', () => {
    it('applies coupling-weighted credit penalty', () => {
      // Setup: join faction first
      quests.grantQuest('q_test1');
      state.flags.set('test_done');
      quests.checkObjectives();

      const creditBefore = state.getState().player.externalStats.credit?.['test_treffen'] ?? 0;
      expect(creditBefore).toBe(10);

      // Grant and ditch q_test3 (coupling: 0.9)
      quests.grantQuest('q_test3');
      quests.ditchQuest('q_test3');

      const creditAfter = state.getState().player.externalStats.credit?.['test_treffen'] ?? 0;

      // distance = |10 - (-50)| = 60
      // basePenalty = 60 × 0.7 = 42
      // weightedPenalty = 42 × 0.9 = 37.8
      // newCredit = 10 - 37.8 = -27.8
      expect(creditAfter).toBeCloseTo(-27.8, 1);
    });

    it('triggers breakpoint when credit falls below threshold', () => {
      // Setup: join faction
      quests.grantQuest('q_test1');
      state.flags.set('test_done');
      quests.checkObjectives();

      // Manually lower credit close to breakpoint first
      // breakpoint = -50 + (50 × 0.15) = -42.5
      state.modifyCredit('test_treffen', -50, {
        negativeLimit: -50,
        positiveLimit: 100,
      });
      // Credit is now -40 (10 - 50)

      // Now ditch — should push past breakpoint
      quests.grantQuest('q_test3');
      quests.ditchQuest('q_test3');

      const relation = state.getFactionRelation('test_treffen');
      expect(relation!.creditBreakpointHit).toBe(true);
      expect(state.flags.has('faction_breakpoint_test_treffen')).toBe(true);
    });
  });

  describe('isEpicQuestAvailable (breakpoint protection)', () => {
    it('returns true for general quests regardless of breakpoint', () => {
      expect(factionTree.isEpicQuestAvailable('q_general')).toBe(true);
    });

    it('returns true for faction quest when no breakpoint hit', () => {
      factionTree.initFactionRelation('test_treffen');
      expect(factionTree.isEpicQuestAvailable('q_test2')).toBe(true);
    });

    it('returns false for faction quest after breakpoint hit', () => {
      factionTree.initFactionRelation('test_treffen');
      state.updateFactionRelation('test_treffen', { creditBreakpointHit: true });

      expect(factionTree.isEpicQuestAvailable('q_test2')).toBe(false);
    });

    it('blocks quest grant via QuestEngine after breakpoint', () => {
      factionTree.initFactionRelation('test_treffen');
      state.updateFactionRelation('test_treffen', { creditBreakpointHit: true });

      const result = quests.grantQuest('q_test2');
      expect(result).toBe(false);
      expect(state.getState().activeQuests['q_test2']).toBeUndefined();
    });
  });

  describe('QuestEngine + FactionTreeEngine integration', () => {
    it('full quest line flow: grant → complete → checkpoint → credit', () => {
      // 1. Grant and complete initial quest
      quests.grantQuest('q_test1');
      state.flags.set('test_done');
      quests.checkObjectives();

      expect(state.getFactionRelation('test_treffen')!.isJoined).toBe(true);
      expect(state.getState().player.externalStats.credit?.['test_treffen']).toBe(10);
      expect(state.getFactionRelation('test_treffen')!.completedCheckpointIds).toContain('cp1');

      // 2. Grant and complete story quest (no special faction effect)
      quests.grantQuest('q_test2');
      state.flags.set('test_done2');
      quests.checkObjectives();

      // 3. Grant and complete critical quest → CP2 + epic completion
      quests.grantQuest('q_test3');
      state.flags.set('test_done3');
      quests.checkObjectives();

      expect(state.getFactionRelation('test_treffen')!.completedCheckpointIds).toContain('cp2');
      expect(state.flags.has('cp2_done')).toBe(true);
      expect(state.flags.has('epic_done')).toBe(true);
    });
  });
});
