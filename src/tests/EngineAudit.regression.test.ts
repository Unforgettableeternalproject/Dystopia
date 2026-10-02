// EngineAudit.regression.test.ts
//
// 引擎稽核缺陷 E1–E6 的回歸測試：
//   E1 存檔保留 factionRelations
//   E2 timeRanges 時間窗被一次時間推進跨過時不可永久錯過
//   E3 休息被事件中斷時停點精確落在觸發點
//   E4 selectDialogueChoice 重入鎖
//   E5 消耗品產物依物品定義堆疊
//   E6 ditch 任務走失敗 UI 回饋，且信用只扣一次

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { get } from 'svelte/store';
import { encode, decode } from '../lib/utils/SaveCodec';
import { EventBus } from '../lib/engine/EventBus';
import { EventEngine } from '../lib/engine/EventEngine';
import { StateManager } from '../lib/engine/StateManager';
import { TimeManager } from '../lib/engine/TimeManager';
import { RestResolver } from '../lib/engine/RestResolver';
import { GameController } from '../lib/engine/GameController';
import { LoreVault, isSecretLayerRevealed } from '../lib/lore/LoreVault';
import kachNpc from '../../lore/world/regions/crambell/npcs/crambell_kach.json';
import { activeNpcUI, activeScriptedDialogue, currentQuestBanner, isStreaming } from '../lib/stores/gameStore';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type {
  GameEvent, GameState, GameTime, LocationNode, PropNode, RegionIndex, RegionSchedule, NPCNode,
} from '../lib/types';
import type { ItemNode } from '../lib/types/item';
import type { QuestDefinition } from '../lib/types/quest';
import type { FactionDefinition } from '../lib/types/faction';
import type { DialogueProfile } from '../lib/types/dialogue';
import type { RestContext } from '../lib/types/prop';

// ── 共用 fixtures ─────────────────────────────────────────────────────────────

function makeGameState(): GameState {
  return {
    player: {
      id: 'p1',
      name: 'Tester',
      origin: 'worker',
      currentLocationId: 'loc_a',
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
      inventory:     [],
      melphin:       0,
      activeFlags:   new Set(),
      titles:        [],
      conditions:    [],
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

/** 以 day 13 00:00 為 totalMinutes 基準建立時間 */
function at(hour: number, minute = 0): GameTime {
  return { year: 1498, month: 6, day: 13, hour, minute, totalMinutes: 10000 + hour * 60 + minute };
}

function windowEvent(id: string, opts: Partial<GameEvent> = {}, start = [6, 0], end = [6, 59]): GameEvent {
  return {
    id,
    description: id,
    condition: {
      timeRanges: [{ startHour: start[0], startMinute: start[1], endHour: end[0], endMinute: end[1] }],
    },
    outcomes: [{ id: 'o', description: 'o', flagsSet: [id + '_done'] }],
    isRepeatable: false,
    ...opts,
  };
}

class NullClient implements ILLMClient {
  async complete(): Promise<string> {
    return JSON.stringify({ allowed: true, reason: null, modifiedInput: null, actionType: null, targetId: null });
  }
  async *stream(): AsyncGenerator<string> { yield ''; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (c: GameController) => c as any as { state: StateManager; _pendingQuestOutcomes: Array<{ name: string; outcome: string }> };

afterEach(() => {
  vi.restoreAllMocks();
});

// ── E1 ───────────────────────────────────────────────────────────────────────

describe('E1 SaveCodec factionRelations', () => {
  it('encode→decode 往返後保留 factionRelations', async () => {
    const gs = makeGameState();
    gs.factionRelations = {
      f_a: { factionId: 'f_a', joined: true, breakpointHit: false } as never,
    };
    const { state } = await decode(await encode(gs, []));
    expect(state.factionRelations).toEqual(gs.factionRelations);
  });

  it('舊存檔缺少 factionRelations 時 fallback 為空物件', async () => {
    const gs = makeGameState();
    const legacy = {
      v: 1, ts: 0, turn: 0, phase: 'exploring', lastNarrative: '', history: [],
      discoveredLocationIds: [], activeQuests: {}, completedQuestIds: [], npcMemory: {},
      worldPhase: gs.worldPhase,
      player: { ...gs.player, activeFlags: [] },
      flags: [], time: gs.time, timePeriod: 'rest', eventCooldowns: {}, eventCounters: {},
    };
    const code = 'DYS1:' + gzipSync(Buffer.from(JSON.stringify(legacy))).toString('base64url');
    const { state } = await decode(code);
    expect(state.factionRelations).toEqual({});
  });
});

// ── E2 ───────────────────────────────────────────────────────────────────────

function makeEventHarness(events: GameEvent[], now: GameTime) {
  const lore = new LoreVault();
  const location: LocationNode = {
    id: 'loc_a', name: 'A', regionId: 'region_a', tags: [],
    base: { description: '', ambience: [], connections: [], npcIds: [], eventIds: [], isAccessible: true },
    localVariants: [],
  };
  const region: RegionIndex = {
    id: 'region_a', name: 'R', theme: 't', locationIds: ['loc_a'], npcIds: [], questIds: [], factionIds: [],
    globalEventIds: events.map(e => e.id),
  };
  lore.load({
    locations: { loc_a: location },
    regions: { region_a: region },
    events: Object.fromEntries(events.map(e => [e.id, e])),
  });
  const gs = makeGameState();
  gs.time = now;
  const mgr = new StateManager(gs, new EventBus());
  return { engine: new EventEngine(lore, mgr, new TimeManager()), mgr };
}

describe('E2 timeRanges 跨窗觸發', () => {
  it('一次推進跨過整個窗口（02:00→09:00）時非重複事件仍觸發', () => {
    const { engine, mgr } = makeEventHarness([windowEvent('ev')], at(9));
    const out = engine.checkGlobalEvents('region_a', [3, 4, 5, 6, 7, 8, 9]);
    expect(out.map(t => t.event.id)).toEqual(['ev']);
    expect(mgr.flags.has('ev:fired')).toBe(true);
  });

  it('可重複事件跨窗不補觸發', () => {
    const { engine } = makeEventHarness([windowEvent('ev', { isRepeatable: true })], at(9));
    expect(engine.checkGlobalEvents('region_a', [3, 4, 5, 6, 7, 8, 9])).toHaveLength(0);
  });

  it('未跨越窗口起點（06:40→07:10，窗 06:30–06:59）不觸發', () => {
    const { engine } = makeEventHarness([windowEvent('ev', {}, [6, 30], [6, 59])], at(7, 10));
    expect(engine.checkGlobalEvents('region_a', [7])).toHaveLength(0);
  });

  it('跨入起點整點但未到起點分鐘（05:50→06:05，窗 06:30–06:59）不觸發', () => {
    const { engine } = makeEventHarness([windowEvent('ev', {}, [6, 30], [6, 59])], at(6, 5));
    expect(engine.checkGlobalEvents('region_a', [6])).toHaveLength(0);
  });

  it('跨夜窗（22:00–06:00）從 21:00 推進到 07:00 時觸發', () => {
    const { engine } = makeEventHarness([windowEvent('ev', {}, [22, 0], [6, 0])], at(7));
    const crossed = [22, 23, 0, 1, 2, 3, 4, 5, 6, 7];
    expect(engine.checkGlobalEvents('region_a', crossed)).toHaveLength(1);
  });

  it('回歸：位於窗口內且無跨越整點時 timeRanges 事件照常觸發', () => {
    const { engine } = makeEventHarness([windowEvent('ev')], at(6));
    expect(engine.checkGlobalEvents('region_a', [])).toHaveLength(1);
  });

  it('回歸：triggerHours 事件剛好位於該時段但未跨越整點時不觸發', () => {
    const ev: GameEvent = {
      id: 'hourly', description: 'h', condition: { triggerHours: [6] },
      outcomes: [{ id: 'o', description: 'o' }], isRepeatable: false,
    };
    const { engine } = makeEventHarness([ev], at(6));
    expect(engine.checkGlobalEvents('region_a', [])).toHaveLength(0);
  });

  it('peekTimeRangeInterrupt 回傳到窗口起點的分鐘偏移，且只看非重複事件', () => {
    const { engine } = makeEventHarness(
      [windowEvent('ev', {}, [6, 30], [6, 59]), windowEvent('rep', { isRepeatable: true }, [5, 0], [5, 30])],
      at(2),
    );
    expect(engine.peekTimeRangeInterrupt('region_a', 'loc_a', 420)).toBe(270);
    expect(engine.peekTimeRangeInterrupt('region_a', 'loc_a', 200)).toBeNull();
  });
});

// ── E2 + E3：GameController.executeRest ───────────────────────────────────────

function makeRestController(events: GameEvent[]) {
  const controller = new GameController({ dm: new NullClient(), regulator: new NullClient() });
  const location: LocationNode = {
    id: 'delth_dormitory_room', name: 'Dorm', regionId: 'crambell', tags: [],
    base: {
      description: '', ambience: [], connections: [], npcIds: [], eventIds: [],
      propIds: ['dorm_bed'], isAccessible: true,
    },
    localVariants: [],
  };
  const region: RegionIndex = {
    id: 'crambell', name: 'Crambell', theme: 't', locationIds: ['delth_dormitory_room'],
    npcIds: [], questIds: [], factionIds: [], globalEventIds: events.map(e => e.id),
  };
  const schedule: RegionSchedule = {
    regionId: 'crambell',
    periods: [
      { id: 'work', label: 'Work', startHour: 6, startMinute: 0, endHour: 18, endMinute: 0 },
      { id: 'rest', label: 'Rest', startHour: 18, startMinute: 0, endHour: 6, endMinute: 0 },
    ],
  };
  const bed: PropNode = { id: 'dorm_bed', name: 'Bed', description: 'bed', restPoint: true };
  controller.loadLore({
    locations: { delth_dormitory_room: location },
    regions: { crambell: region },
    schedules: { crambell: schedule },
    events: Object.fromEntries(events.map(e => [e.id, e])),
    props: { dorm_bed: bed },
  });
  const state = internals(controller).state;
  state.getState().player.currentLocationId = 'delth_dormitory_room';
  state.flags.set('game_day1_started');
  state.advanceTime(at(2), 'rest');
  return { controller, state };
}

describe('E2/E3 executeRest 跨窗睡眠中斷', () => {
  it('02:00 睡 7 小時跨過 06:00–06:59：在 06:00 被叫醒且事件觸發', () => {
    // 噪音偏正，若中斷分支仍疊加 noise 停點會偏離 06:00
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { controller, state } = makeRestController([windowEvent('kach_morning')]);

    const result = controller.executeRest(420);

    const t = state.getState().time;
    expect(result.actualMinutes).toBe(240);
    expect(`${t.hour}:${t.minute}`).toBe('6:0');
    expect(state.flags.has('kach_morning:fired')).toBe(true);
    expect(state.flags.has('kach_morning_done')).toBe(true);
  });

  it('可重複的 timeRanges 事件不會中斷睡眠', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { controller } = makeRestController([windowEvent('forest_night', { isRepeatable: true })]);
    const result = controller.executeRest(420);
    // 未中斷：時長為一般解析結果（含 bias），遠超過到 06:00 的 240 分鐘
    expect(result.actualMinutes).toBeGreaterThan(240);
    expect(internals(controller).state.flags.has('forest_night_done')).toBe(false);
  });
});

describe('E3 RestResolver forcedActualMinutes', () => {
  const ctx: RestContext = { mode: 'full_available', restPointIds: [], maxTimeMinutes: 480, statusEffectScale: 1 };

  it('中斷時實際時長等於強制值，不疊加 bias/noise，效果依實際時長按比例計算', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // noise = -30，若被套用會改變時長
    const r = RestResolver.resolve({
      plannedMinutes: 480, restCtx: ctx,
      stamina: 0, staminaMax: 10, stress: 10, stressMax: 10, fatigue: 4,
      forcedActualMinutes: 240, forcedQuality: 'full',
    });
    expect(r.actualMinutes).toBe(240);
    expect(r.deviationMinutes).toBe(-240);
    expect(r.quality).toBe('full');
    expect(r.staminaDelta).toBe(5);    // 240/480 × 10
    expect(r.stressDelta).toBe(-3);    // -(0.5 × 10 × 0.6)
    expect(r.fatigueDelta).toBe(-2);   // 降至 2
  });

  it('強制時長不受最短 5 分鐘 clamp 影響', () => {
    const r = RestResolver.resolve({
      plannedMinutes: 60, restCtx: ctx,
      stamina: 10, staminaMax: 10, stress: 0, stressMax: 10,
      forcedActualMinutes: 3,
    });
    expect(r.actualMinutes).toBe(3);
  });
});

// ── E4 ───────────────────────────────────────────────────────────────────────

describe('E4 selectDialogueChoice 重入鎖', () => {
  beforeEach(() => {
    activeScriptedDialogue.set(null);
    isStreaming.set(false);
  });

  it('連續呼叫兩次只套用一次效果', async () => {
    const controller = new GameController({ dm: new NullClient(), regulator: new NullClient() });
    const npc: NPCNode = {
      id: 'npc_a', name: 'NPC', dialogueId: 'dlg_a', defaultLocationId: 'loc_a', publicDescription: '',
    } as NPCNode;
    const profile: DialogueProfile = {
      id: 'dlg_a', npcId: 'npc_a', defaultContext: '',
      nodes: {
        n1: { lines: [{ speaker: 'npc', text: '嗯' }], choices: [{ id: 'c', text: '好', nextNodeId: 'n2', effects: { affinity: 5 } }] },
        n2: { lines: [{ speaker: 'npc', text: '是' }], choices: [{ id: 'bye', text: '再見', nextNodeId: null }] },
      },
      triggers: [],
    };
    controller.loadLore({ npcs: { npc_a: npc }, dialogues: { dlg_a: profile } });

    activeScriptedDialogue.set({
      npcId: 'npc_a', npcName: 'NPC', dialogueId: 'dlg_a', currentNodeId: 'n1',
      currentChoices: profile.nodes.n1.choices, collectedNarrative: '', endAfterScript: true,
    });

    await Promise.all([controller.selectDialogueChoice('c'), controller.selectDialogueChoice('c')]);

    expect(internals(controller).state.getState().player.externalStats.affinity['npc_a']).toBe(5);
    expect(get(activeScriptedDialogue)?.currentNodeId).toBe('n2');
  });
});

// ── E5 ───────────────────────────────────────────────────────────────────────

describe('E5 consumeItem 產物堆疊', () => {
  it('已持有 1 個空瓶時喝水得到第 2 個空瓶', () => {
    const emptyBottle = { id: 'empty_bottle', stackable: true, maxStack: 2, maxUsesPerInstance: 1 } as ItemNode;
    const gs = makeGameState();
    gs.player.inventory = [
      { instanceId: 'water_1', itemId: 'water_bottle', obtainedAtMinute: 0, quantity: 1, isExpired: false },
      { instanceId: 'empty_1', itemId: 'empty_bottle', obtainedAtMinute: 0, quantity: 1, isExpired: false, usesRemaining: 1 },
    ];
    const mgr = new StateManager(gs, new EventBus());

    const ok = mgr.consumeItem('water_1', { yieldsItemId: 'empty_bottle' }, () => undefined,
      id => (id === 'empty_bottle' ? emptyBottle : undefined));

    expect(ok).toBe(true);
    const bottles = mgr.getState().player.inventory.filter(i => i.itemId === 'empty_bottle');
    expect(bottles.reduce((n, i) => n + i.quantity, 0)).toBe(2);
    expect(mgr.getState().player.inventory.some(i => i.itemId === 'water_bottle')).toBe(false);
  });
});

// ── E6 ───────────────────────────────────────────────────────────────────────

describe('E6 ditch 任務的失敗回饋', () => {
  const faction: FactionDefinition = {
    id: 'f_a', name: '派系', regionId: 'crambell', description: '', defaultReputation: 0,
    credit: {
      initialValue: 0, positiveLimit: 100, negativeLimit: -50,
      breakpointPercent: 15, ditchPenaltyPercent: 70, initialQuestBonus: 0,
    },
  } as FactionDefinition;

  function makeQuest(id: string, betrayal: boolean): QuestDefinition {
    return {
      id, name: id === 'q_b' ? '出賣任務' : '一般任務', type: 'side', source: 'npc',
      canDitch: true,
      coupling: { f_a: 1 },
      ditchConsequences: betrayal ? { beneficiaryFactionId: 'f_other' } : undefined,
      entryStageId: 's1',
      stages: {
        s1: {
          id: 's1', description: 's1',
          objectives: [{ id: 'o1', type: 'flag_check', description: 'x', flag: 'never' }],
          onComplete: { nextStageId: null },
        },
      },
    } as QuestDefinition;
  }

  function setup() {
    const controller = new GameController({ dm: new NullClient(), regulator: new NullClient() });
    controller.loadLore({
      quests: { q_n: makeQuest('q_n', false), q_b: makeQuest('q_b', true) },
      factions: { f_a: faction as never },
    });
    return controller;
  }

  it('一般 ditch 顯示失敗 banner、進入 quest outcome，信用只扣一次', () => {
    const controller = setup();
    currentQuestBanner.set(null);
    expect(controller.acceptQuest('q_n')).toBe(true);
    expect(controller.ditchQuest('q_n')).toBe(true);

    expect(get(currentQuestBanner)).toEqual({ name: '一般任務', outcome: 'failed' });
    expect(internals(controller)._pendingQuestOutcomes).toContainEqual({ name: '一般任務', outcome: 'failed' });
    // distance = |0 - (-50)| = 50 → 50 × 0.7 × 1 = 35
    expect(internals(controller).state.getState().player.externalStats.credit?.['f_a']).toBeCloseTo(-35, 5);
    // 一般放棄仍可再接（既有設計）
    expect(internals(controller).state.getState().completedQuestIds).not.toContain('q_n');
  });

  it('出賣型 ditch 標示為背叛並記錄於 completedQuestIds', () => {
    const controller = setup();
    controller.acceptQuest('q_b');
    controller.ditchQuest('q_b');
    expect(internals(controller)._pendingQuestOutcomes).toContainEqual({ name: '出賣任務（背叛）', outcome: 'failed' });
    expect(internals(controller).state.getState().completedQuestIds).toContain('q_b');
  });

  it('已完成或已失敗的任務拒絕 ditch，不重複扣信用', () => {
    const controller = setup();
    controller.acceptQuest('q_n');
    const st = internals(controller).state;
    st.getState().activeQuests['q_n'].isCompleted = true;
    expect(controller.ditchQuest('q_n')).toBe(false);
    expect(st.getState().player.externalStats.credit?.['f_a']).toBeUndefined();

    st.getState().activeQuests['q_n'].isCompleted = false;
    st.getState().activeQuests['q_n'].isFailed = true;
    expect(controller.ditchQuest('q_n')).toBe(false);
    expect(st.getState().player.externalStats.credit?.['f_a']).toBeUndefined();
  });
});

// ── F3 NPC 會面次數與秘密層 ──────────────────────────────────────────────────

describe('F3 NPC 會面次數（minMeetings）', () => {
  it('同一段對話只計一次會面，重新開啟對話才 +1', () => {
    const controller = new GameController({ dm: new NullClient(), regulator: new NullClient() });
    const npc = { id: 'npc_a', name: 'NPC', dialogueId: 'd', publicDescription: '' } as NPCNode;
    controller.loadLore({ npcs: { npc_a: npc } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const open = (id: string) => (controller as any).updateActiveNpcUI(id);
    const st = internals(controller).state;

    activeNpcUI.set(null);
    open('npc_a');
    open('npc_a');               // 同段對話後續輪次
    expect(st.getNPCMeetingCount('npc_a')).toBe(1);

    activeNpcUI.set(null);       // 對話結束
    open('npc_a');
    expect(st.getNPCMeetingCount('npc_a')).toBe(2);
    activeNpcUI.set(null);
  });

  it('秘密層 minMeetings 與 condition 皆須成立', () => {
    const layer = { minMeetings: 2 };
    expect(isSecretLayerRevealed(layer, new Set(), 1)).toBe(false);
    expect(isSecretLayerRevealed(layer, new Set(), 2)).toBe(true);
    const both = { minMeetings: 2, condition: 'know_x' };
    expect(isSecretLayerRevealed(both, new Set(), 3)).toBe(false);
    expect(isSecretLayerRevealed(both, new Set(['know_x']), 3)).toBe(true);
  });

  it('buildSceneContext 依會面次數揭露秘密層', () => {
    const lore = new LoreVault();
    const location: LocationNode = {
      id: 'loc_a', name: 'A', regionId: 'r', tags: [],
      base: { description: '', ambience: [], connections: [], npcIds: ['npc_a'], eventIds: [], isAccessible: true },
      localVariants: [],
    };
    const npc = {
      id: 'npc_a', name: 'NPC', dialogueId: 'd', publicDescription: '表面',
      defaultLocationId: 'loc_a',
      secretLayers: [{ id: 's', label: 's', minMeetings: 2, context: '秘密內容' }],
    } as NPCNode;
    lore.load({ locations: { loc_a: location }, npcs: { npc_a: npc } });
    const flags = new StateManager(makeGameState(), new EventBus()).flags;
    const ctx = (n: number) => lore.buildSceneContext('loc_a', flags, {}, undefined,
      { includeNpcs: true, npcMeetingCounts: { npc_a: n } });
    expect(ctx(1)).not.toContain('秘密內容');
    expect(ctx(2)).toContain('秘密內容');
  });

  it('會面次數隨存檔保存', async () => {
    const gs = makeGameState();
    gs.npcMeetingCounts = { crambell_kach: 2 };
    const { state } = await decode(await encode(gs, []));
    expect(state.npcMeetingCounts).toEqual({ crambell_kach: 2 });
  });

  it('凱奇 secretLayers[0] 改用 minMeetings: 2', () => {
    const layer = kachNpc.secretLayers[0] as { minMeetings?: number; condition?: string };
    expect(layer.minMeetings).toBe(2);
    expect(layer.condition).toBeUndefined();
  });
});
