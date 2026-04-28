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
    attemptCooldowns: {},
  };
}

/** Minimal 1-stage, 1-objective quest that completes immediately when flag is set. */
const QUEST_SIMPLE: QuestDefinition = {
  id:           'q_simple',
  name:         '簡單任務',
  type:         'side',
  source:       'npc',
  entryStageId: 's1',
  stages: {
    s1: {
      id:          's1',
      description: '完成目標',
      objectives:  [{ id: 'obj1', type: 'flag_check', description: '設置旗標', flag: 'test_flag_a' }],
      onComplete:  { nextStageId: null },
    },
  },
};

/** 2-stage quest — first stage advances to s2; s2 completes the quest. */
const QUEST_TWOSTAGE: QuestDefinition = {
  id:           'q_twostage',
  name:         '兩階段任務',
  type:         'main',
  source:       'npc',
  entryStageId: 's1',
  stages: {
    s1: {
      id:          's1',
      description: '第一階段',
      objectives:  [{ id: 'obj1', type: 'flag_check', description: '旗標A', flag: 'flag_stage1' }],
      onComplete:  { nextStageId: 's2', flagsSet: ['s1_done'] },
    },
    s2: {
      id:          's2',
      description: '第二階段',
      objectives:  [{ id: 'obj2', type: 'flag_check', description: '旗標B', flag: 'flag_stage2' }],
      onComplete:  { nextStageId: null },
    },
  },
  rewards: { flagsSet: ['q_twostage_done'], reputationChanges: { faction_x: 10 } },
};

/** Repeatable quest, no repeatCondition — resets immediately. */
const QUEST_REPEAT: QuestDefinition = {
  id:           'q_repeat',
  name:         '每日任務',
  type:         'side',
  source:       'origin',
  isRepeatable: true,
  entryStageId: 's1',
  stages: {
    s1: {
      id:          's1',
      description: '完成',
      objectives:  [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'repeat_flag' }],
      onComplete:  { nextStageId: null },
    },
  },
};

/** Repeatable quest with a repeatCondition — moves to completedQuestIds first. */
const QUEST_REPEAT_COND: QuestDefinition = {
  id:              'q_repeat_cond',
  name:            '條件循環任務',
  type:            'side',
  source:          'origin',
  isRepeatable:    true,
  repeatCondition: 'reset_flag',
  entryStageId:    's1',
  stages: {
    s1: {
      id:          's1',
      description: '完成',
      objectives:  [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'cond_flag' }],
      onComplete:  { nextStageId: null },
    },
  },
};

/** Quest with time limit. */
const QUEST_TIMELIMIT: QuestDefinition = {
  id:           'q_timelimit',
  name:         '限時任務',
  type:         'side',
  source:       'event',
  timeLimit:    60,          // 60 minutes
  entryStageId: 's1',
  stages: {
    s1: {
      id:          's1',
      description: '限時目標',
      objectives:  [{ id: 'obj1', type: 'flag_check', description: '完成', flag: 'tl_flag' }],
      onComplete:  { nextStageId: null },
    },
  },
};

/** Quest with onFail configured. */
const QUEST_FAILHANDLE: QuestDefinition = {
  id:           'q_fail',
  name:         '失敗測試任務',
  type:         'side',
  source:       'npc',
  entryStageId: 's1',
  stages: {
    s1: {
      id:          's1',
      description: '危險目標',
      objectives:  [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'fail_flag' }],
      onComplete:  { nextStageId: null },
      onFail:      { nextStageId: null, flagsSet: ['q_fail_flagged'] },
    },
    s_retry: {
      id:          's_retry',
      description: '重試',
      objectives:  [{ id: 'obj1', type: 'flag_check', description: '重試旗標', flag: 'retry_flag' }],
      onComplete:  { nextStageId: null },
      onFail:      { nextStageId: 's_retry' },   // stays in retry stage
    },
  },
};

/** Quest with various objective types. */
const QUEST_MULTI_OBJ: QuestDefinition = {
  id:           'q_multi',
  name:         '多種目標任務',
  type:         'side',
  source:       'npc',
  entryStageId: 's1',
  stages: {
    s1: {
      id:          's1',
      description: '多目標',
      objectives:  [
        { id: 'obj_location', type: 'location_visit', description: '訪問地點', locationId: 'loc_target' },
        { id: 'obj_npc',      type: 'npc_talk',       description: '與 NPC 交談', npcId: 'npc_x' },
        { id: 'obj_item',     type: 'item_collect',   description: '收集道具', itemId: 'item_x' },
        { id: 'obj_rep',      type: 'reputation',     description: '聲望', factionId: 'faction_y', minReputation: 5 },
      ],
      onComplete: { nextStageId: null },
    },
  },
};

/** Ordered objectives quest — objectives must be completed in sequence. */
const QUEST_ORDERED: QuestDefinition = {
  id:           'q_ordered',
  name:         '順序任務',
  type:         'side',
  source:       'npc',
  entryStageId: 's1',
  stages: {
    s1: {
      id:          's1',
      description: '依序完成',
      ordered:     true,
      objectives:  [
        { id: 'obj1', type: 'flag_check', description: '先', flag: 'ord_flag1' },
        { id: 'obj2', type: 'flag_check', description: '後', flag: 'ord_flag2' },
      ],
      onComplete: { nextStageId: null },
    },
  },
};

// ── Test setup helper ─────────────────────────────────────────────────────────

function makeSetup(quests: QuestDefinition[] = []) {
  const lore  = new LoreVault();
  lore.load({ quests: Object.fromEntries(quests.map(q => [q.id, q])) });

  const bus   = new EventBus();
  const state = new StateManager(makeGameState(), bus);
  const engine = new QuestEngine(lore, state);

  return { lore, state, engine, bus };
}

// ── grantQuest ────────────────────────────────────────────────────────────────

describe('QuestEngine.grantQuest()', () => {
  it('正常授予任務 — 加入 activeQuests', () => {
    const { engine, state } = makeSetup([QUEST_SIMPLE]);
    const ok = engine.grantQuest('q_simple');
    expect(ok).toBe(true);
    expect(state.getState().activeQuests['q_simple']).toBeDefined();
  });

  it('任務不存在 — 回傳 false', () => {
    const { engine } = makeSetup();
    expect(engine.grantQuest('nonexistent')).toBe(false);
  });

  it('已在 activeQuests 中 — 跳過，回傳 false', () => {
    const { engine } = makeSetup([QUEST_SIMPLE]);
    engine.grantQuest('q_simple');
    expect(engine.grantQuest('q_simple')).toBe(false);
  });

  it('非循環任務已完成 — 跳過，回傳 false', () => {
    const { engine, state } = makeSetup([QUEST_SIMPLE]);
    engine.grantQuest('q_simple');
    state.getState().completedQuestIds.push('q_simple');
    delete (state.getState().activeQuests as Record<string, unknown>)['q_simple'];
    expect(engine.grantQuest('q_simple')).toBe(false);
  });

  it('循環任務已完成 — 仍可重新授予', () => {
    const { engine, state } = makeSetup([QUEST_REPEAT]);
    state.getState().completedQuestIds.push('q_repeat');
    const ok = engine.grantQuest('q_repeat');
    expect(ok).toBe(true);
  });

  it('授予時設置正確的 currentStageId', () => {
    const { engine, state } = makeSetup([QUEST_SIMPLE]);
    engine.grantQuest('q_simple');
    expect(state.getState().activeQuests['q_simple'].currentStageId).toBe('s1');
  });

  it('授予限時任務時設置 expiresAtMinutes', () => {
    const { engine, state } = makeSetup([QUEST_TIMELIMIT]);
    engine.grantQuest('q_timelimit');
    const inst = state.getState().activeQuests['q_timelimit'];
    expect(inst.expiresAtMinutes).toBe(60);   // totalMinutes(0) + timeLimit(60)
  });
});

// ── checkObjectives — flag_check ──────────────────────────────────────────────

describe('QuestEngine.checkObjectives() — flag_check', () => {
  it('旗標未設 — 目標不完成', () => {
    const { engine, state } = makeSetup([QUEST_SIMPLE]);
    engine.grantQuest('q_simple');
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_simple'].completedObjectiveIds).toHaveLength(0);
  });

  it('旗標設置後 — 目標自動完成，任務進入完成狀態', () => {
    const { engine, state } = makeSetup([QUEST_SIMPLE]);
    engine.grantQuest('q_simple');
    state.flags.set('test_flag_a');
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_simple'].isCompleted).toBe(true);
    expect(state.getState().completedQuestIds).toContain('q_simple');
  });
});

// ── checkObjectives — multi-stage ─────────────────────────────────────────────

describe('QuestEngine.checkObjectives() — 多階段', () => {
  it('第一階段完成 — 推進到第二階段，設置 onComplete.flagsSet', () => {
    const { engine, state } = makeSetup([QUEST_TWOSTAGE]);
    engine.grantQuest('q_twostage');
    state.flags.set('flag_stage1');
    engine.checkObjectives();
    const inst = state.getState().activeQuests['q_twostage'];
    expect(inst.currentStageId).toBe('s2');
    expect(state.flags.has('s1_done')).toBe(true);
  });

  it('第一階段完成後目標保留在 completedObjectiveIds（跨 stage 累積，供 UI 顯示刪除線）', () => {
    const { engine, state } = makeSetup([QUEST_TWOSTAGE]);
    engine.grantQuest('q_twostage');
    state.flags.set('flag_stage1');
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_twostage'].completedObjectiveIds).toContain('obj1');
  });

  it('第二階段完成 — 任務完成，套用 rewards', () => {
    const { engine, state } = makeSetup([QUEST_TWOSTAGE]);
    engine.grantQuest('q_twostage');
    state.flags.set('flag_stage1');
    engine.checkObjectives();
    state.flags.set('flag_stage2');
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_twostage'].isCompleted).toBe(true);
    expect(state.flags.has('q_twostage_done')).toBe(true);
    expect(state.getState().player.externalStats.reputation['faction_x']).toBe(10);
  });
});

// ── checkObjectives — ordered ─────────────────────────────────────────────────

describe('QuestEngine.checkObjectives() — ordered=true', () => {
  it('第二個旗標先設置 — 不應完成 obj1（尚未到 obj2）', () => {
    const { engine, state } = makeSetup([QUEST_ORDERED]);
    engine.grantQuest('q_ordered');
    state.flags.set('ord_flag2');   // 第二個旗標先設
    engine.checkObjectives();
    const inst = state.getState().activeQuests['q_ordered'];
    // obj1 尚未完成，任務不應移動
    expect(inst.completedObjectiveIds).toHaveLength(0);
    expect(inst.isCompleted).toBe(false);
  });

  it('依序設置後 — 任務完成', () => {
    const { engine, state } = makeSetup([QUEST_ORDERED]);
    engine.grantQuest('q_ordered');
    state.flags.set('ord_flag1');
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_ordered'].completedObjectiveIds).toContain('obj1');
    state.flags.set('ord_flag2');
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_ordered'].isCompleted).toBe(true);
  });
});

// ── checkObjectives — diverse objective types ─────────────────────────────────

describe('QuestEngine.checkObjectives() — 多種目標類型', () => {
  it('location_visit — 已發現目標地點時完成', () => {
    const { engine, state } = makeSetup([QUEST_MULTI_OBJ]);
    engine.grantQuest('q_multi');
    state.discoverLocation('loc_target');
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_multi'].completedObjectiveIds).toContain('obj_location');
  });

  it('npc_talk — npcMemory 中有記錄時完成', () => {
    const { engine, state } = makeSetup([QUEST_MULTI_OBJ]);
    engine.grantQuest('q_multi');
    // evaluateObjective 只檢查 !!gs.npcMemory[npcId]，提供最小合法結構即可
    state.getState().npcMemory['npc_x'] = {
      npcId: 'npc_x', firstMetTurn: 0, lastInteractedTurn: 0,
      interactionCount: 1, playerAttitude: 'neutral',
    };
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_multi'].completedObjectiveIds).toContain('obj_npc');
  });

  it('item_collect — 持有未過期道具時完成', () => {
    const { engine, state } = makeSetup([QUEST_MULTI_OBJ]);
    engine.grantQuest('q_multi');
    state.addItem('item_x', 0);
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_multi'].completedObjectiveIds).toContain('obj_item');
  });

  it('reputation — 達到門檻時完成', () => {
    const { engine, state } = makeSetup([QUEST_MULTI_OBJ]);
    engine.grantQuest('q_multi');
    state.modifyReputation('faction_y', 5);
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_multi'].completedObjectiveIds).toContain('obj_rep');
  });

  it('reputation — 低於門檻時不完成', () => {
    const { engine, state } = makeSetup([QUEST_MULTI_OBJ]);
    engine.grantQuest('q_multi');
    state.modifyReputation('faction_y', 3);
    engine.checkObjectives();
    expect(state.getState().activeQuests['q_multi'].completedObjectiveIds).not.toContain('obj_rep');
  });
});

// ── checkObjectives — quest_flag via applyQuestSignal ────────────────────────

describe('QuestEngine — quest_flag 目標（applyQuestSignal）', () => {
  const QUEST_QFLAG: QuestDefinition = {
    id: 'q_qflag', name: '本地旗標任務', type: 'side', source: 'npc',
    entryStageId: 's1',
    stages: {
      s1: {
        id: 's1', description: '等待本地旗標',
        objectives: [{ id: 'obj1', type: 'quest_flag', description: '本地旗標', questFlag: 'local_done' }],
        onComplete: { nextStageId: null },
      },
    },
  };

  it('設置任務本地旗標後目標完成', () => {
    const { engine, state } = makeSetup([QUEST_QFLAG]);
    engine.grantQuest('q_qflag');
    engine.applyQuestSignal('q_qflag', 'flag', 'local_done');
    expect(state.getState().activeQuests['q_qflag'].isCompleted).toBe(true);
  });

  it('applyQuestSignal type=objective 直接標記目標為完成', () => {
    const { engine, state } = makeSetup([QUEST_SIMPLE]);
    engine.grantQuest('q_simple');
    engine.applyQuestSignal('q_simple', 'objective', 'obj1');
    expect(state.getState().activeQuests['q_simple'].isCompleted).toBe(true);
  });
});

// ── checkTimeLimits ────────────────────────────────────────────────────────────

describe('QuestEngine.checkTimeLimits()', () => {
  it('時間未到 — 不失敗', () => {
    const { engine, state } = makeSetup([QUEST_TIMELIMIT]);
    engine.grantQuest('q_timelimit');
    engine.checkTimeLimits(59);
    expect(state.getState().activeQuests['q_timelimit'].isFailed).toBe(false);
  });

  it('時間到 — 任務失敗', () => {
    const { engine, state } = makeSetup([QUEST_TIMELIMIT]);
    engine.grantQuest('q_timelimit');
    engine.checkTimeLimits(60);
    expect(state.getState().activeQuests['q_timelimit'].isFailed).toBe(true);
  });

  it('逾時後設置 expired 旗標', () => {
    const { engine, state } = makeSetup([QUEST_TIMELIMIT]);
    engine.grantQuest('q_timelimit');
    engine.checkTimeLimits(100);
    expect(state.flags.has('q_timelimit:expired')).toBe(true);
  });

  it('已完成的任務不會因逾時而失敗', () => {
    const { engine, state } = makeSetup([QUEST_TIMELIMIT]);
    engine.grantQuest('q_timelimit');
    state.flags.set('tl_flag');
    engine.checkObjectives();    // completes the quest
    engine.checkTimeLimits(100);
    expect(state.getState().activeQuests['q_timelimit'].isFailed).toBe(false);
  });
});

// ── applyQuestFail ─────────────────────────────────────────────────────────────

describe('QuestEngine.applyQuestFail()', () => {
  it('nextStageId = null — 任務完全失敗', () => {
    const { engine, state } = makeSetup([QUEST_FAILHANDLE]);
    engine.grantQuest('q_fail');
    engine.applyQuestFail('q_fail');
    expect(state.getState().activeQuests['q_fail'].isFailed).toBe(true);
    expect(state.flags.has('q_fail_flagged')).toBe(true);
  });

  it('無 onFail 定義 — 靜默不操作', () => {
    const { engine, state } = makeSetup([QUEST_SIMPLE]);
    engine.grantQuest('q_simple');
    engine.applyQuestFail('q_simple');
    expect(state.getState().activeQuests['q_simple'].isFailed).toBe(false);
  });

  it('對不存在任務呼叫不報錯', () => {
    const { engine } = makeSetup([QUEST_FAILHANDLE]);
    expect(() => engine.applyQuestFail('nonexistent')).not.toThrow();
  });
});

// ── Repeatable quest ──────────────────────────────────────────────────────────

describe('QuestEngine — 循環任務', () => {
  it('無條件循環 — 完成後立即重置（不進入 completedQuestIds）', () => {
    const { engine, state } = makeSetup([QUEST_REPEAT]);
    engine.grantQuest('q_repeat');
    state.flags.set('repeat_flag');
    engine.checkObjectives();
    const inst = state.getState().activeQuests['q_repeat'];
    expect(inst.isCompleted).toBe(false);
    expect(inst.currentStageId).toBe('s1');
    expect(inst.completedObjectiveIds).toHaveLength(0);
    expect(state.getState().completedQuestIds).not.toContain('q_repeat');
  });

  it('有條件循環 — 完成後進入 completedQuestIds 且移出 activeQuests', () => {
    const { engine, state } = makeSetup([QUEST_REPEAT_COND]);
    engine.grantQuest('q_repeat_cond');
    state.flags.set('cond_flag');
    engine.checkObjectives();
    // 進入 completedQuestIds 等待條件，且從 activeQuests 移除讓 checkPendingRepeats 可重新授予
    expect(state.getState().completedQuestIds).toContain('q_repeat_cond');
    expect(state.getState().activeQuests['q_repeat_cond']).toBeUndefined();
  });

  it('有條件循環 — 條件成立後 checkPendingRepeats 重新授予', () => {
    const { engine, state } = makeSetup([QUEST_REPEAT_COND]);
    engine.grantQuest('q_repeat_cond');
    state.flags.set('cond_flag');
    engine.checkObjectives();
    // 任務已完成進入 completedQuestIds；現在設置 repeatCondition 旗標
    state.flags.set('reset_flag');
    engine.checkPendingRepeats();
    const inst = state.getState().activeQuests['q_repeat_cond'];
    expect(inst).toBeDefined();
    expect(inst.isCompleted).toBe(false);
    expect(inst.currentStageId).toBe('s1');
  });
});

// ── autoGrantOriginQuests ──────────────────────────────────────────────────────

describe('QuestEngine.autoGrantOriginQuests()', () => {
  const QUEST_ORIGIN_WORKER: QuestDefinition = {
    id: 'q_origin_w', name: '工人出身任務', type: 'main', source: 'origin',
    autoAccept: true, originFilter: ['worker'],
    entryStageId: 's1',
    stages: {
      s1: {
        id: 's1', description: '起始',
        objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'x' }],
        onComplete: { nextStageId: null },
      },
    },
  };
  const QUEST_ORIGIN_ALL: QuestDefinition = {
    id: 'q_origin_all', name: '通用出身任務', type: 'side', source: 'origin',
    autoAccept: true,
    entryStageId: 's1',
    stages: {
      s1: {
        id: 's1', description: '起始',
        objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'y' }],
        onComplete: { nextStageId: null },
      },
    },
  };

  it('符合 origin 的任務被授予', () => {
    const { engine, state } = makeSetup([QUEST_ORIGIN_WORKER, QUEST_ORIGIN_ALL]);
    engine.autoGrantOriginQuests('worker');
    expect(state.getState().activeQuests['q_origin_w']).toBeDefined();
    expect(state.getState().activeQuests['q_origin_all']).toBeDefined();
  });

  it('origin 不符的任務不被授予', () => {
    const { engine, state } = makeSetup([QUEST_ORIGIN_WORKER, QUEST_ORIGIN_ALL]);
    engine.autoGrantOriginQuests('merchant');
    expect(state.getState().activeQuests['q_origin_w']).toBeUndefined();
    expect(state.getState().activeQuests['q_origin_all']).toBeDefined();
  });
});

// ── ditchQuest ────────────────────────────────────────────────────────────────

describe('QuestEngine.ditchQuest()', () => {
  const QUEST_DITCHABLE: QuestDefinition = {
    id: 'q_ditch', name: '可放棄任務', type: 'side', source: 'npc',
    canDitch: true,
    ditchConsequences: { reputationChanges: { faction_z: -20 } },
    entryStageId: 's1',
    stages: {
      s1: {
        id: 's1', description: '目標',
        objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'd_flag' }],
        onComplete: { nextStageId: null },
      },
    },
  };

  it('canDitch=true — 成功放棄，任務從 activeQuests 移除', () => {
    const { engine, state } = makeSetup([QUEST_DITCHABLE]);
    engine.grantQuest('q_ditch');
    const ok = engine.ditchQuest('q_ditch');
    expect(ok).toBe(true);
    // ditchQuest 後 StateManager 會 delete activeQuests[questId]
    expect(state.getState().activeQuests['q_ditch']).toBeUndefined();
  });

  it('canDitch=true — 套用 ditchConsequences', () => {
    const { engine, state } = makeSetup([QUEST_DITCHABLE]);
    engine.grantQuest('q_ditch');
    engine.ditchQuest('q_ditch');
    expect(state.getState().player.externalStats.reputation['faction_z']).toBe(-20);
  });

  it('canDitch=false — 無法放棄，回傳 false', () => {
    const { engine } = makeSetup([QUEST_SIMPLE]);
    engine.grantQuest('q_simple');
    expect(engine.ditchQuest('q_simple')).toBe(false);
  });

  it('canDitch=false — 任務仍留在 activeQuests', () => {
    const { engine, state } = makeSetup([QUEST_SIMPLE]);
    engine.grantQuest('q_simple');
    engine.ditchQuest('q_simple');
    expect(state.getState().activeQuests['q_simple']).toBeDefined();
  });

  it('有 beneficiaryFactionId — ditch 後任務進入 completedQuestIds（不可再接）', () => {
    const questWithBeneficiary: QuestDefinition = {
      id: 'q_betray', name: '背叛任務', type: 'side', source: 'npc',
      canDitch: true,
      ditchConsequences: {
        reputationChanges: { faction_a: -30 },
        beneficiaryFactionId: 'faction_gov',
      },
      entryStageId: 's1',
      stages: {
        s1: {
          id: 's1', description: '目標',
          objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'd_flag' }],
          onComplete: { nextStageId: null },
        },
      },
    };
    const { engine, state } = makeSetup([questWithBeneficiary]);
    engine.grantQuest('q_betray');
    engine.ditchQuest('q_betray');
    expect(state.getState().activeQuests['q_betray']).toBeUndefined();
    expect(state.getState().completedQuestIds).toContain('q_betray');
  });

  it('stage onDitch 效果與 ditchConsequences 均套用', () => {
    const questWithOnDitch: QuestDefinition = {
      id: 'q_onditch', name: '階段背叛任務', type: 'side', source: 'npc',
      canDitch: true,
      ditchConsequences: {
        reputationChanges: { faction_z: -20 },
        flagsSet: ['global_betrayed'],
      },
      entryStageId: 's1',
      stages: {
        s1: {
          id: 's1', description: '目標',
          objectives: [{ id: 'obj1', type: 'flag_check', description: '旗標', flag: 'd_flag' }],
          onComplete: { nextStageId: null },
          onDitch: {
            flagsSet: ['stage_betrayed'],
            reputationChanges: { faction_y: -10 },
          },
        },
      },
    };
    const { engine, state } = makeSetup([questWithOnDitch]);
    engine.grantQuest('q_onditch');
    engine.ditchQuest('q_onditch');
    // ditchConsequences 效果
    expect(state.getState().player.externalStats.reputation['faction_z']).toBe(-20);
    expect(state.flags.has('global_betrayed')).toBe(true);
    // stage onDitch 效果
    expect(state.getState().player.externalStats.reputation['faction_y']).toBe(-10);
    expect(state.flags.has('stage_betrayed')).toBe(true);
  });
});
