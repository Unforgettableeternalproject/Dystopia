import { describe, it, expect, beforeEach } from 'vitest';
import { QuestEngine } from '../lib/engine/QuestEngine';
import { StateManager } from '../lib/engine/StateManager';
import { EventBus } from '../lib/engine/EventBus';
import { LoreVault } from '../lib/lore/LoreVault';
import type { GameState } from '../lib/types';
import type { QuestDefinition } from '../lib/types/quest';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
  };
}

// ── Quest Definitions ─────────────────────────────────────────────────────────

/** Side quest — no canAbandon field → defaults to abandonable */
const QUEST_SIDE: QuestDefinition = {
  id: 'q_side', name: '支線任務', type: 'side', source: 'npc',
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'flag_a' }],
      onComplete: { nextStageId: null },
    },
  },
};

/** Main quest — no canAbandon → NOT abandonable by default */
const QUEST_MAIN: QuestDefinition = {
  id: 'q_main', name: '主線任務', type: 'main', source: 'npc',
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '主線目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'flag_b' }],
      onComplete: { nextStageId: null },
    },
  },
};

/** Main quest with explicit canAbandon=true → abandonable despite type='main' */
const QUEST_MAIN_UNLOCKED: QuestDefinition = {
  id: 'q_main_unlock', name: '可放棄主線', type: 'main', source: 'npc',
  canAbandon: true,
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'flag_c' }],
      onComplete: { nextStageId: null },
    },
  },
};

/** Side quest with canAbandon=false → locked despite type='side' */
const QUEST_LOCKED: QuestDefinition = {
  id: 'q_locked', name: '鎖定任務', type: 'side', source: 'npc',
  canAbandon: false,
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'flag_d' }],
      onComplete: { nextStageId: null },
    },
  },
};

/** Quest A — a standalone quest */
const QUEST_A: QuestDefinition = {
  id: 'q_a', name: 'A 任務', type: 'side', source: 'npc',
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'flag_qa' }],
      onComplete: { nextStageId: null },
    },
  },
};

/** Quest B — cannotCoexist with quest A */
const QUEST_B: QuestDefinition = {
  id: 'q_b', name: 'B 任務', type: 'side', source: 'npc',
  cannotCoexist: ['q_a'],
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'flag_qb' }],
      onComplete: { nextStageId: null },
    },
  },
};

/** Quest C — cannotCoexist with both A and B */
const QUEST_C: QuestDefinition = {
  id: 'q_c', name: 'C 任務', type: 'side', source: 'npc',
  cannotCoexist: ['q_a', 'q_b'],
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'flag_qc' }],
      onComplete: { nextStageId: null },
    },
  },
};

// ── Setup helper ──────────────────────────────────────────────────────────────

function makeSetup(quests: QuestDefinition[] = []) {
  const lore = new LoreVault();
  lore.load({ quests: Object.fromEntries(quests.map(q => [q.id, q])) });

  const bus   = new EventBus();
  const state = new StateManager(makeGameState(), bus);
  const engine = new QuestEngine(lore, state);

  return { lore, state, engine, bus };
}

// ── abandonQuest — 基本邏輯 ───────────────────────────────────────────────────

describe('QuestEngine.abandonQuest() — 基本邏輯', () => {
  it('side 任務 → 可放棄，回傳 true', () => {
    const { engine } = makeSetup([QUEST_SIDE]);
    engine.grantQuest('q_side');
    expect(engine.abandonQuest('q_side')).toBe(true);
  });

  it('side 任務放棄後 → isFailed=true', () => {
    const { engine, state } = makeSetup([QUEST_SIDE]);
    engine.grantQuest('q_side');
    engine.abandonQuest('q_side');
    expect(state.getState().activeQuests['q_side'].isFailed).toBe(true);
  });

  it('main 任務（無 canAbandon）→ 不可放棄，回傳 false', () => {
    const { engine } = makeSetup([QUEST_MAIN]);
    engine.grantQuest('q_main');
    expect(engine.abandonQuest('q_main')).toBe(false);
  });

  it('main 任務放棄失敗後 → 任務狀態未改變', () => {
    const { engine, state } = makeSetup([QUEST_MAIN]);
    engine.grantQuest('q_main');
    engine.abandonQuest('q_main');
    const inst = state.getState().activeQuests['q_main'];
    expect(inst.isFailed).toBe(false);
    expect(inst.isCompleted).toBe(false);
  });

  it('main 任務 canAbandon=true → 可放棄，回傳 true', () => {
    const { engine } = makeSetup([QUEST_MAIN_UNLOCKED]);
    engine.grantQuest('q_main_unlock');
    expect(engine.abandonQuest('q_main_unlock')).toBe(true);
  });

  it('canAbandon=false → 即使是 side 也不可放棄', () => {
    const { engine } = makeSetup([QUEST_LOCKED]);
    engine.grantQuest('q_locked');
    expect(engine.abandonQuest('q_locked')).toBe(false);
  });
});

// ── abandonQuest — 邊界情況 ───────────────────────────────────────────────────

describe('QuestEngine.abandonQuest() — 邊界情況', () => {
  it('任務不存在 → 回傳 false', () => {
    const { engine } = makeSetup([QUEST_SIDE]);
    expect(engine.abandonQuest('nonexistent')).toBe(false);
  });

  it('任務不在 activeQuests 中 → 回傳 false', () => {
    const { engine } = makeSetup([QUEST_SIDE]);
    // 不先 grant
    expect(engine.abandonQuest('q_side')).toBe(false);
  });

  it('任務已完成 → 回傳 false', () => {
    const { engine, state } = makeSetup([QUEST_SIDE]);
    engine.grantQuest('q_side');
    state.flags.set('flag_a');
    engine.checkObjectives();
    // Now completed
    expect(engine.abandonQuest('q_side')).toBe(false);
  });

  it('任務已失敗 → 回傳 false', () => {
    const { engine, state } = makeSetup([QUEST_SIDE]);
    engine.grantQuest('q_side');
    engine.abandonQuest('q_side');  // first abandon → fails it
    // Second abandon attempt on already-failed quest
    expect(engine.abandonQuest('q_side')).toBe(false);
  });
});

// ── cannotCoexist — 互斥任務 ──────────────────────────────────────────────────

describe('QuestEngine — cannotCoexist 互斥', () => {
  it('衝突任務活躍中 → 無法授予 B', () => {
    const { engine } = makeSetup([QUEST_A, QUEST_B]);
    engine.grantQuest('q_a');
    // q_a is active and not completed/failed → q_b cannot be granted
    expect(engine.grantQuest('q_b')).toBe(false);
  });

  it('B 無法授予時 → B 不在 activeQuests', () => {
    const { engine, state } = makeSetup([QUEST_A, QUEST_B]);
    engine.grantQuest('q_a');
    engine.grantQuest('q_b');
    expect(state.getState().activeQuests['q_b']).toBeUndefined();
  });

  it('衝突任務已完成 → 可授予 B', () => {
    const { engine, state } = makeSetup([QUEST_A, QUEST_B]);
    engine.grantQuest('q_a');
    // Complete q_a by setting its flag
    state.flags.set('flag_qa');
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_a'].isCompleted).toBe(true);
    // Now q_b should be grantable
    expect(engine.grantQuest('q_b')).toBe(true);
  });

  it('衝突任務已失敗 → 可授予 B', () => {
    const { engine, state } = makeSetup([QUEST_A, QUEST_B]);
    engine.grantQuest('q_a');
    // Abandon q_a (side quest) → isFailed=true
    engine.abandonQuest('q_a');
    expect(state.getState().activeQuests['q_a'].isFailed).toBe(true);
    // Conflict is failed → B can be granted
    expect(engine.grantQuest('q_b')).toBe(true);
  });

  it('衝突任務根本不存在（從未授予）→ 可授予 B', () => {
    const { engine } = makeSetup([QUEST_A, QUEST_B]);
    // q_a was never granted
    expect(engine.grantQuest('q_b')).toBe(true);
  });

  it('C 的多個衝突：只要有一個活躍就阻止授予', () => {
    const { engine } = makeSetup([QUEST_A, QUEST_B, QUEST_C]);
    engine.grantQuest('q_b');  // only q_b active, q_a not active
    // q_c.cannotCoexist = ['q_a', 'q_b']; q_b is active → blocked
    expect(engine.grantQuest('q_c')).toBe(false);
  });

  it('C 的多個衝突：所有衝突都完成 → 可授予', () => {
    const { engine, state } = makeSetup([QUEST_A, QUEST_B, QUEST_C]);
    engine.grantQuest('q_a');
    engine.grantQuest('q_b');
    // Complete both
    state.flags.set('flag_qa');
    state.flags.set('flag_qb');
    engine.checkObjectives();
    expect(engine.grantQuest('q_c')).toBe(true);
  });

  it('非衝突任務不受影響', () => {
    const { engine } = makeSetup([QUEST_A, QUEST_B, QUEST_SIDE]);
    engine.grantQuest('q_a');
    // q_side has no cannotCoexist → unaffected
    expect(engine.grantQuest('q_side')).toBe(true);
  });
});
