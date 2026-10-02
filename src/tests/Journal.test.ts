// Journal.test.ts
//
// 玩家日誌：來源批次合併、各類別記錄、關鍵選擇不洩漏旗標、隱藏事件不洩漏名稱、
// 200 筆上限、存讀檔往返與舊存檔相容。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { EventBus } from '../lib/engine/EventBus';
import { StateManager } from '../lib/engine/StateManager';
import { EncounterEngine } from '../lib/engine/EncounterEngine';
import { EventEngine } from '../lib/engine/EventEngine';
import { QuestEngine } from '../lib/engine/QuestEngine';
import { TimeManager } from '../lib/engine/TimeManager';
import { GameController } from '../lib/engine/GameController';
import { LoreVault } from '../lib/lore/LoreVault';
import * as SaveCodec from '../lib/utils/SaveCodec';
import { journalEntries, journalOpen, journalUnread } from '../lib/stores/gameStore';
import type { GameState } from '../lib/types/game';
import type { EncounterDefinition } from '../lib/types/encounter';
import type { GameEvent, LocationNode, RegionIndex } from '../lib/types';
import type { QuestDefinition } from '../lib/types/quest';
import type { JournalEntry } from '../lib/types/journal';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeState(): GameState {
  return {
    player: {
      id: 'journal-test', name: 'Tester', origin: 'worker', currentLocationId: 'loc_a',
      primaryStats:       { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
      primaryStatsExp:    { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      inclinationTracker: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      dailyGrantTracker:  { dateKey: '1498-6-1', grantedExp: {} },
      secondaryStats: { consciousness: 0, mysticism: 0, technology: 0 },
      statusStats: { stamina: 8, staminaMax: 10, stress: 2, stressMax: 10, endo: 0, endoMax: 0, experience: 0, fatigue: 3 },
      externalStats: { reputation: {}, affinity: {}, familiarity: {} },
      inventory: [], melphin: 10, activeFlags: new Set(), titles: [], conditions: [], knownIntelIds: [],
    },
    turn: 0, phase: 'exploring', pendingThoughts: [], lastNarrative: '', history: [],
    discoveredLocationIds: ['loc_a'], activeQuests: {}, completedQuestIds: [], npcMemory: {},
    worldPhase: { currentPhase: 'phase_1', appliedPhaseIds: [] },
    time: { year: 1498, month: 6, day: 1, hour: 12, minute: 0, totalMinutes: 0 },
    timePeriod: 'work', eventCooldowns: {}, eventCounters: {}, attemptCooldowns: {}, propFlags: {},
  };
}

const ENCOUNTER: EncounterDefinition = {
  id: 'enc_unrest', name: '動盪不安', type: 'event', description: '測試遭遇',
  entryNodeId: 'n0',
  nodes: {
    n0: {
      id: 'n0', dmNarrative: '人群騷動。', displayText: '人群騷動。',
      choices: [
        {
          id: 'c_push', text: '擠過人群',
          effects: { statChanges: { 'statusStats.stamina': -3, 'statusStats.stress': 2 }, flagsSet: ['secret_flag_xyz'] },
          nextNodeId: 'n_end',
        },
        {
          id: 'c_check', text: '試著穩住身子',
          nextNodeId: 'n_check',
        },
      ],
    },
    n_check: {
      id: 'n_check', dmNarrative: '判定',
      statCheck: { stat: 'primaryStats.strength', dc: 10, successNodeId: 'n_end', failNodeId: 'n_end' },
    },
    n_end: { id: 'n_end', dmNarrative: '結束', displayText: '結束', isOutcome: true, outcomeType: 'success' },
  },
};

const QUEST: QuestDefinition = {
  id: 'q_test', name: '送信', type: 'side', source: 'npc', entryStageId: 's1', canDitch: true,
  stages: {
    s1: {
      id: 's1', description: '找到收件人',
      objectives: [{ id: 'o1', type: 'flag_check', description: '找到收件人', flag: 'found_target' }],
      onComplete: { nextStageId: null },
    },
  },
};

const LOCATION: LocationNode = {
  id: 'loc_a', name: '廣場', regionId: 'region_a', tags: [],
  base: { description: '廣場', ambience: [], connections: [], npcIds: [], eventIds: [], isAccessible: true },
  localVariants: [],
};
const LOCATION_B: LocationNode = { ...LOCATION, id: 'loc_b', name: '碼頭' };
const REGION: RegionIndex = {
  id: 'region_a', name: 'Region', theme: 'test', locationIds: ['loc_a', 'loc_b'],
  npcIds: [], questIds: [], factionIds: [], globalEventIds: [],
};

function setup(extra: { events?: GameEvent[] } = {}) {
  const lore = new LoreVault();
  lore.load({
    locations: { loc_a: { ...LOCATION, base: { ...LOCATION.base, eventIds: (extra.events ?? []).map(e => e.id) } }, loc_b: LOCATION_B },
    regions:   { region_a: REGION },
    encounters: { enc_unrest: ENCOUNTER },
    quests:    { q_test: QUEST },
    events:    Object.fromEntries((extra.events ?? []).map(e => [e.id, e])),
    factions:  { f_guild: { id: 'f_guild', name: '工會', regionId: null, description: '', defaultReputation: 0 } as never },
    npcs:      { npc_kach: { id: 'npc_kach', name: '凱奇' } as never },
    items:     {
      bread: { id: 'bread', name: '麵包', description: '', type: 'consumable', expiresAfterMinutes: 30 } as never,
    },
    intels:    { intel_a: { id: 'intel_a', label: '倉庫的密道', description: '', category: 'location' } as never },
    conditions: {
      cond_bleed: { id: 'cond_bleed', label: '流血', description: '' },
      cond_mind:  { id: 'cond_mind', label: '被操控', description: '', isHidden: true },
    },
  });
  const state = new StateManager(makeState(), new EventBus());
  // 與 GameController.bindJournal 相同的名稱解析
  state.journal.names = {
    faction: id => lore.getFaction(id)?.name,
    npc: id => lore.getNPC(id)?.name,
    item: id => lore.getItem(id)?.name,
    quest: id => lore.getQuest(id)?.name,
    questStage: (q, s) => lore.getQuest(q)?.stages[s]?.description,
    intel: id => lore.getIntel(id)?.label,
    condition: id => {
      const def = lore.getCondition(id);
      return def ? { label: def.label, hidden: !!def.isHidden } : { label: id, hidden: true };
    },
    location: id => lore.getLocation(id)?.name,
  };
  const encounters = new EncounterEngine(lore, state);
  const events     = new EventEngine(lore, state, new TimeManager());
  const quests     = new QuestEngine(lore, state);
  return { lore, state, encounters, events, quests };
}

/** 直接把快照物件編成存檔碼（繞過 buildSnapshot，用來模擬舊格式） */
async function encodeRawSnapshot(snapshot: unknown): Promise<string> {
  const stream = new Blob([JSON.stringify(snapshot)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes  = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return 'DYS1:' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const journalOf = (state: StateManager): JournalEntry[] => state.getState().journal ?? [];
const texts = (state: StateManager): string[] => journalOf(state).map(e => e.text);

afterEach(() => { vi.restoreAllMocks(); });

// ── tests ────────────────────────────────────────────────────────────────────

describe('日誌：數值合併與來源', () => {
  it('一次遭遇選項同時改體力與壓力 → 一筆合併的數值條目，來源為該遭遇', () => {
    const { state, encounters } = setup();
    encounters.start('enc_unrest');
    encounters.selectChoice('c_push');

    const stats = journalOf(state).filter(e => e.category === 'stats');
    expect(stats).toHaveLength(1);
    expect(stats[0].text).toBe('體力 -3、壓力 +2');
    expect(stats[0].source).toBe('遭遇「動盪不安」');
    expect(stats[0].time).toEqual({ year: 1498, month: 6, day: 1, hour: 12, minute: 0 });
  });

  it('數值記錄實際套用量（夾限後）', () => {
    const { state } = setup();
    state.journal.with('測試', () => state.modifyStat('statusStats.stamina', +50));
    expect(texts(state)).toContain('體力 +2');
  });

  it('關鍵選擇記錄選項文字，且不含旗標名稱', () => {
    const { state, encounters } = setup();
    encounters.start('enc_unrest');
    encounters.selectChoice('c_push');

    const choice = journalOf(state).find(e => e.category === 'choice');
    expect(choice?.text).toContain('你選擇了：〈擠過人群〉');
    expect(choice?.text).toContain('這個選擇可能影響後續發展');
    for (const e of journalOf(state)) expect(e.text + (e.source ?? '')).not.toContain('secret_flag_xyz');
  });

  it('擲骰判定記錄骰值、修正、DC 與成敗；遭遇開始與結束都有紀錄', () => {
    const { state, encounters } = setup();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // d20 → 11
    encounters.start('enc_unrest');
    encounters.selectChoice('c_check');
    encounters.conclude('success');

    const t = texts(state);
    expect(t).toContain('遭遇：動盪不安');
    // 力量 5 → 修正 floor((5-8)/3) = -1；11 - 1 = 10 ≥ DC 10
    expect(t).toContain('力量判定：擲出 11，力量修正 -1，合計 10 / DC 10 → 成功');
    expect(t).toContain('遭遇結束：動盪不安（成功）');
  });
});

describe('日誌：聲望好感、任務、物品、情報、狀態、地點', () => {
  it('聲望與好感顯示陣營／NPC 名稱與增減', () => {
    const { state } = setup();
    state.modifyReputation('f_guild', 3);
    state.modifyAffinity('npc_kach', -2);
    expect(texts(state)).toEqual(expect.arrayContaining(['工會聲望 +3', '凱奇好感 -2']));
    expect(journalOf(state).filter(e => e.category === 'social')).toHaveLength(2);
  });

  it('任務接取、目標、完成', () => {
    const { state, quests } = setup();
    quests.grantQuest('q_test');
    state.flags.set('found_target');
    quests.checkObjectives();
    expect(texts(state)).toEqual(expect.arrayContaining([
      '接取任務：送信', '目標完成：送信', '任務完成：送信',
    ]));
  });

  it('任務失敗、放棄、背棄（含背叛）文字各自區分', () => {
    const { state, quests } = setup();
    quests.grantQuest('q_test');
    state.failQuest('q_test', { recordAsCompleted: false });
    expect(texts(state)).toContain('任務失敗：送信');

    delete state.getState().activeQuests['q_test'];
    quests.grantQuest('q_test');
    quests.abandonQuest('q_test');
    expect(texts(state)).toContain('放棄任務：送信');

    delete state.getState().activeQuests['q_test'];
    state.getState().completedQuestIds.length = 0;
    quests.grantQuest('q_test');
    state.ditchQuest('q_test', { beneficiaryFactionId: 'f_guild', reputationChanges: { f_guild: 5 } });
    expect(texts(state)).toEqual(expect.arrayContaining(['背棄任務：送信（背叛）', '工會聲望 +5']));
  });

  it('物品獲得、使用、過期、失去', () => {
    const { state } = setup();
    state.addItem('bread', 0);
    const inst = state.getState().player.inventory[0];
    state.consumeItem(inst.instanceId, { statusChanges: { stamina: 1 } }, () => undefined);
    state.addItem('bread', 0);
    state.getState().time.totalMinutes = 60;
    state.tickItemExpiry(() => 30);
    state.addItem('bread', 60);
    state.revokeItem('bread');
    expect(texts(state)).toEqual(expect.arrayContaining(['獲得：麵包', '使用：麵包', '過期：麵包', '失去：麵包']));
  });

  it('取得新情報只記一次', () => {
    const { state } = setup();
    state.grantIntel('intel_a');
    state.grantIntel('intel_a');
    expect(texts(state).filter(t => t === '取得情報：倉庫的密道')).toHaveLength(1);
  });

  it('狀態效果獲得與解除；隱藏狀態不記錄', () => {
    const { state, lore } = setup();
    const get = (id: string) => lore.getCondition(id);
    state.addCondition('cond_bleed', get);
    state.addCondition('cond_mind', get);
    state.removeCondition('cond_bleed');
    state.removeCondition('cond_mind');
    expect(texts(state)).toEqual(['陷入狀態：流血', '解除狀態：流血']);
  });

  it('只記首次到訪', () => {
    const { state } = setup();
    state.movePlayer('loc_b');
    state.movePlayer('loc_a');
    state.movePlayer('loc_b');
    expect(texts(state).filter(t => t.startsWith('首次抵達'))).toEqual(['首次抵達：碼頭']);
  });
});

describe('日誌：事件', () => {
  it('會通知的事件記錄名稱並作為數值來源', () => {
    const ev: GameEvent = {
      id: 'ev_riot', name: '暴動', description: '', condition: {}, isRepeatable: false, notification: true,
      outcomes: [{ id: 'o', description: '', statChanges: { 'statusStats.stress': 3 } }],
    };
    const { state, events } = setup({ events: [ev] });
    events.checkAndApply('loc_a');
    expect(texts(state)).toContain('事件：暴動');
    const stat = journalOf(state).find(e => e.category === 'stats');
    expect(stat?.text).toBe('壓力 +3');
    expect(stat?.source).toBe('事件「暴動」');
  });

  it('notification: false 的事件不洩漏名稱', () => {
    const ev: GameEvent = {
      id: 'ev_silent', name: '密談', description: '', condition: {}, isRepeatable: false, notification: false,
      outcomes: [{ id: 'o', description: '', statChanges: { 'statusStats.stress': 1 } }],
    };
    const { state, events } = setup({ events: [ev] });
    events.checkAndApply('loc_a');
    expect(texts(state)).toEqual(['壓力 +1']);
    for (const e of journalOf(state)) expect(e.text + (e.source ?? '')).not.toContain('密談');
  });

  it('沉默事件（未設 notification）不洩漏名稱', () => {
    const ev: GameEvent = {
      id: 'ev_hidden', name: '暗中監視', description: '', condition: {}, isRepeatable: false,
      outcomes: [{ id: 'o', description: '', statChanges: { 'statusStats.stress': 1 } }],
    };
    const { state, events } = setup({ events: [ev] });
    events.checkAndApply('loc_a');
    expect(journalOf(state).length).toBeGreaterThan(0);
    for (const e of journalOf(state)) {
      expect(e.text + (e.source ?? '')).not.toContain('暗中監視');
      expect(e.text + (e.source ?? '')).not.toContain('ev_hidden');
    }
  });
});

describe('日誌：上限與存讀檔', () => {
  it('超過 200 筆只保留最近 200 筆', () => {
    const { state } = setup();
    for (let i = 0; i < 230; i++) state.journal.log('event', `紀錄 ${i}`);
    const j = journalOf(state);
    expect(j).toHaveLength(200);
    expect(j[0].text).toBe('紀錄 30');
    expect(j[199].text).toBe('紀錄 229');
    expect(j[199].id).toBe(230);
  });

  it('存讀檔往返保留日誌；舊存檔沒有 journal 時為空陣列', async () => {
    const { state } = setup();
    state.modifyReputation('f_guild', 1);
    const code = await SaveCodec.encode(state.getState(), state.flags.toArray());
    const { state: restored } = await SaveCodec.decode(code);
    expect(restored.journal).toEqual(state.getState().journal);

    // 模擬舊存檔：快照中完全沒有 journal 欄位
    const { snapshot } = await SaveCodec.decode(code);
    delete (snapshot as Partial<typeof snapshot>).journal;
    const { state: legacyRestored } = await SaveCodec.decode(await encodeRawSnapshot(snapshot));
    expect(legacyRestored.journal).toEqual([]);
  });
});

// ── GameController 整合：休息、UI 鏡像、未讀與存檔指紋 ─────────────────────

describe('日誌：GameController 整合', () => {
  function makeController(): GameController {
    const controller = new GameController();
    controller.loadLore({ locations: { loc_a: LOCATION }, regions: { crambell: { ...REGION, id: 'crambell' } } });
    return controller;
  }

  it('休息記錄實際時長與品質，數值變化合併且來源為休息', () => {
    const controller = makeController();
    const result = controller.executeRest(60);
    const j = controller.getState().journal ?? [];
    const rest = j.find(e => e.category === 'rest');
    expect(rest?.text).toMatch(/^休息 (\d+ 小時( \d+ 分)?|\d+ 分)（品質：.+）/);
    expect(result.actualMinutes).toBeGreaterThan(0);
    const stats = j.filter(e => e.category === 'stats');
    expect(stats.length).toBeLessThanOrEqual(1);
    if (stats[0]) expect(stats[0].source).toBe('休息');
  });

  it('新條目同步到 UI store 並標記未讀；開關日誌不影響存檔指紋', () => {
    const controller = makeController();
    journalOpen.set(false);
    journalUnread.set(false);
    controller.markSaved();
    const sm = (controller as unknown as { state: StateManager }).state;
    sm.modifyReputation('f_any', 1);
    expect(get(journalEntries).at(-1)?.text).toContain('聲望 +1');
    expect(get(journalUnread)).toBe(true);
    expect(controller.hasUnsavedChanges()).toBe(true);

    controller.markSaved();
    journalOpen.set(true);
    journalUnread.set(false);
    journalOpen.set(false);
    expect(controller.hasUnsavedChanges()).toBe(false);
  });

  it('新遊戲清空日誌', () => {
    const controller = makeController();
    const sm = (controller as unknown as { state: StateManager }).state;
    sm.modifyReputation('f_any', 1);
    controller.resetForNewGame();
    expect(controller.getState().journal).toEqual([]);
    expect(get(journalEntries)).toEqual([]);
  });
});
