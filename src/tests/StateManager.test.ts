import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from '../lib/engine/StateManager';
import { EventBus, GameEvents } from '../lib/engine/EventBus';
import type { GameState } from '../lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(): GameState {
  return {
    player: {
      id: 'test',
      name: 'Tester',
      origin: 'worker',
      currentLocationId: 'loc_a',
      primaryStats:   { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
      secondaryStats: { consciousness: 2, mysticism: 0, technology: 3 },
      statusStats: {
        stamina: 10, staminaMax: 10,
        stress:  2,  stressMax:  10,
        endo:    5,  endoMax:    20,
        experience: 0,
      },
      externalStats: { reputation: { faction_x: 0 }, affinity: {}, familiarity: {} },
      inventory:    [],
      melphin:      100,
      activeFlags:  new Set(['initial_flag']),
      titles:       [],
      conditions:   [],
      knownIntelIds: [],
    },
    turn:   1,
    phase:  'exploring',
    worldPhase: { currentPhase: 'phase_1', appliedPhaseIds: [] },
    pendingThoughts: [],
    lastNarrative:   '',
    history:         [],
    discoveredLocationIds: ['loc_a'],
    activeQuests:          {},
    completedQuestIds:     [],
    npcMemory:             {},
    time: { year: 1498, month: 6, day: 12, hour: 21, minute: 23, totalMinutes: 0 },
    timePeriod: 'rest',
    eventCooldowns: {},
  };
}

function makeManager(): { mgr: StateManager; bus: EventBus } {
  const bus = new EventBus();
  const mgr = new StateManager(makeState(), bus);
  return { mgr, bus };
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

describe('StateManager — 初始化', () => {
  it('initialFlags 從 activeFlags 載入到 FlagSystem', () => {
    const { mgr } = makeManager();
    expect(mgr.flags.has('initial_flag')).toBe(true);
  });

  it('getState() 回傳初始狀態', () => {
    const { mgr } = makeManager();
    expect(mgr.getState().player.name).toBe('Tester');
  });
});

// ── 移動與探索 ─────────────────────────────────────────────────────────────────

describe('StateManager — 移動與探索', () => {
  it('movePlayer — 更新 currentLocationId', () => {
    const { mgr } = makeManager();
    mgr.movePlayer('loc_b');
    expect(mgr.getState().player.currentLocationId).toBe('loc_b');
  });

  it('movePlayer — 新地點加入 discoveredLocationIds', () => {
    const { mgr } = makeManager();
    mgr.movePlayer('loc_new');
    expect(mgr.getState().discoveredLocationIds).toContain('loc_new');
  });

  it('movePlayer — 發送 LOCATION_CHANGED 事件', () => {
    const { mgr, bus } = makeManager();
    let payload: { from: string; to: string } | null = null;
    bus.on<{ from: string; to: string }>(GameEvents.LOCATION_CHANGED, p => { payload = p; });
    mgr.movePlayer('loc_b');
    expect(payload).toEqual({ from: 'loc_a', to: 'loc_b' });
  });

  it('discoverLocation — 重複探索不重複加入', () => {
    const { mgr } = makeManager();
    mgr.discoverLocation('loc_a');    // already discovered
    const ids = mgr.getState().discoveredLocationIds;
    expect(ids.filter(id => id === 'loc_a').length).toBe(1);
  });
});

// ── 數值修改 ───────────────────────────────────────────────────────────────────

describe('StateManager — 數值修改', () => {
  it('modifyStat — 正常增減', () => {
    const { mgr } = makeManager();
    mgr.modifyStat('primaryStats.strength', 2);
    expect(mgr.getState().player.primaryStats.strength).toBe(7);
  });

  it('modifyStat — 不可低於 0（clamp）', () => {
    const { mgr } = makeManager();
    mgr.modifyStat('statusStats.stamina', -100);
    expect(mgr.getState().player.statusStats.stamina).toBe(0);
  });

  it('modifyStat — 不存在的 key 不報錯', () => {
    const { mgr } = makeManager();
    expect(() => mgr.modifyStat('primaryStats.nonexistent', 5)).not.toThrow();
  });

  it('modifyReputation — 正常增量', () => {
    const { mgr } = makeManager();
    mgr.modifyReputation('faction_x', 10);
    expect(mgr.getState().player.externalStats.reputation['faction_x']).toBe(10);
  });

  it('modifyReputation — 可累加', () => {
    const { mgr } = makeManager();
    mgr.modifyReputation('faction_x', 10);
    mgr.modifyReputation('faction_x', -3);
    expect(mgr.getState().player.externalStats.reputation['faction_x']).toBe(7);
  });

  it('modifyReputation — 新派系從 0 開始', () => {
    const { mgr } = makeManager();
    mgr.modifyReputation('faction_new', 5);
    expect(mgr.getState().player.externalStats.reputation['faction_new']).toBe(5);
  });

  it('modifyAffinity — 正常增量', () => {
    const { mgr } = makeManager();
    mgr.modifyAffinity('npc_x', 3);
    expect(mgr.getState().player.externalStats.affinity['npc_x']).toBe(3);
  });

  it('modifyMelphin — 正常增量', () => {
    const { mgr } = makeManager();
    mgr.modifyMelphin(50);
    expect(mgr.getState().player.melphin).toBe(150);
  });

  it('modifyMelphin — 不可低於 0', () => {
    const { mgr } = makeManager();
    mgr.modifyMelphin(-500);
    expect(mgr.getState().player.melphin).toBe(0);
  });
});

// ── 道具 ───────────────────────────────────────────────────────────────────────

describe('StateManager — 道具', () => {
  it('addItem — 加入 inventory', () => {
    const { mgr } = makeManager();
    mgr.addItem('item_sword', 0);
    expect(mgr.getState().player.inventory.some(i => i.itemId === 'item_sword')).toBe(true);
  });

  it('addItem — 重複道具不重複加入（idempotent）', () => {
    const { mgr } = makeManager();
    mgr.addItem('item_sword', 0);
    mgr.addItem('item_sword', 5);    // same item, different time
    expect(mgr.getState().player.inventory.filter(i => i.itemId === 'item_sword').length).toBe(1);
  });

  it('addItem — 不同 variantId 視為不同道具', () => {
    const { mgr } = makeManager();
    mgr.addItem('item_potion', 0, 'small');
    mgr.addItem('item_potion', 0, 'large');
    expect(mgr.getState().player.inventory.filter(i => i.itemId === 'item_potion').length).toBe(2);
  });
});

// ── Quest 相關 ─────────────────────────────────────────────────────────────────

describe('StateManager — Quest 操作', () => {
  it('startQuest — 建立 QuestInstance', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1', { source: 'npc' });
    const inst = mgr.getState().activeQuests['q1'];
    expect(inst).toBeDefined();
    expect(inst.currentStageId).toBe('s1');
    expect(inst.isCompleted).toBe(false);
    expect(inst.isFailed).toBe(false);
  });

  it('completeObjective — 加入 completedObjectiveIds', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.completeObjective('q1', 'obj_a');
    expect(mgr.getState().activeQuests['q1'].completedObjectiveIds).toContain('obj_a');
  });

  it('completeObjective — 同一目標不重複記錄', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.completeObjective('q1', 'obj_a');
    mgr.completeObjective('q1', 'obj_a');
    expect(mgr.getState().activeQuests['q1'].completedObjectiveIds.filter(o => o === 'obj_a').length).toBe(1);
  });

  it('advanceQuestStage — 更新 currentStageId 並清除 objectives', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.completeObjective('q1', 'obj_a');
    mgr.advanceQuestStage('q1', 's2');
    const inst = mgr.getState().activeQuests['q1'];
    expect(inst.currentStageId).toBe('s2');
    expect(inst.completedObjectiveIds).toHaveLength(0);
  });

  it('completeQuest — 標記 isCompleted 並加入 completedQuestIds', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.completeQuest('q1');
    const inst = mgr.getState().activeQuests['q1'];
    expect(inst.isCompleted).toBe(true);
    expect(inst.currentStageId).toBeNull();
    expect(mgr.getState().completedQuestIds).toContain('q1');
  });

  it('completeQuest — 套用 flagsSet reward', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.completeQuest('q1', { flagsSet: ['reward_flag'] });
    expect(mgr.flags.has('reward_flag')).toBe(true);
  });

  it('completeQuest — 套用 reputationChanges reward', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.completeQuest('q1', { reputationChanges: { faction_x: 15 } });
    expect(mgr.getState().player.externalStats.reputation['faction_x']).toBe(15);
  });

  it('completeQuest — 套用 experience reward', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.completeQuest('q1', { experience: 100 });
    expect(mgr.getState().player.statusStats.experience).toBe(100);
  });

  it('completeQuest — 不重複加入 completedQuestIds', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.completeQuest('q1');
    mgr.completeQuest('q1');
    expect(mgr.getState().completedQuestIds.filter(id => id === 'q1').length).toBe(1);
  });

  it('failQuest — 標記 isFailed', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.failQuest('q1');
    expect(mgr.getState().activeQuests['q1'].isFailed).toBe(true);
  });

  it('removeActiveQuest — 移除已完成的實例', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.completeQuest('q1');
    mgr.removeActiveQuest('q1');
    expect(mgr.getState().activeQuests['q1']).toBeUndefined();
    expect(mgr.getState().completedQuestIds).toContain('q1');   // 仍在 completedQuestIds
  });

  it('removeActiveQuest — 對未完成任務不操作', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.removeActiveQuest('q1');   // q1 not completed yet
    expect(mgr.getState().activeQuests['q1']).toBeDefined();
  });

  it('setQuestLocalFlag — 不影響全域 FlagSystem', () => {
    const { mgr } = makeManager();
    mgr.startQuest('q1', 's1');
    mgr.setQuestLocalFlag('q1', 'local_flag');
    expect(mgr.getState().activeQuests['q1'].localFlags).toContain('local_flag');
    expect(mgr.flags.has('local_flag')).toBe(false);   // 不應污染全域
  });
});

// ── 玩家名稱與歷史 ────────────────────────────────────────────────────────────

describe('StateManager — 其他', () => {
  it('setPlayerName — 更新 player.name', () => {
    const { mgr } = makeManager();
    mgr.setPlayerName('Alice');
    expect(mgr.getState().player.name).toBe('Alice');
  });

  it('STATE_UPDATED 事件在狀態變更時觸發', () => {
    const { mgr, bus } = makeManager();
    let count = 0;
    bus.on(GameEvents.STATE_UPDATED, () => { count++; });
    mgr.setPlayerName('Bob');
    expect(count).toBeGreaterThan(0);
  });
});
