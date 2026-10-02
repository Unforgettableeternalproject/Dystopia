// CrambellRouteExclusion.integration.test.ts
//
// 路線四／五互斥：把情報賣給凱恩（kane_deliver_kach / kane_deliver_alliance）時，
// 強制 Ditch 當下進行中的凱奇測試（test1/2/3），並封鎖之後再進入路線五。
//
// 交付節點的 confirm 依 `<questId>:active` 拆成互斥變體，每個變體只 ditch 當下進行中的那一個測試；
// 沒有進行中測試時，沒有 ditchQuestId（避免對已完成任務重複套用 ditch 後果）。
// 本測試比照 GameController.selectDialogueChoice（~1462）：filterChoices → applyChoiceEffects → ditchQuest。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../lib/engine/EventBus';
import { EventEngine } from '../lib/engine/EventEngine';
import { QuestEngine } from '../lib/engine/QuestEngine';
import { StateManager } from '../lib/engine/StateManager';
import { TimeManager } from '../lib/engine/TimeManager';
import { DialogueManager } from '../lib/engine/DialogueManager';
import { FactionTreeEngine } from '../lib/engine/FactionTreeEngine';
import { LoreVault } from '../lib/lore/LoreVault';
import type { GameState } from '../lib/types/game';
import type {
  Faction, GameEvent, LocationNode, RegionIndex, RegionSchedule,
} from '../lib/types/world';
import type { QuestDefinition } from '../lib/types/quest';
import type { DialogueProfile, ScriptedChoice } from '../lib/types/dialogue';

const REPO_ROOT = new URL('../../', import.meta.url);
const C = 'lore/world/regions/crambell';

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, REPO_ROOT), 'utf8')) as T;
}

function makeState(): GameState {
  return {
    player: {
      id: 'excl-player',
      name: 'Exclusion Tester',
      origin: 'worker',
      currentLocationId: 'delth_patrol_zone',
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
    pendingThoughts: [],
    lastNarrative: '',
    history: [],
    discoveredLocationIds: [],
    activeQuests: {},
    completedQuestIds: [],
    npcMemory: {},
    worldPhase: { currentPhase: 'phase_1', appliedPhaseIds: [] },
    time: { year: 1498, month: 6, day: 12, hour: 10, minute: 0, totalMinutes: 0 },
    timePeriod: 'work',
    eventCooldowns: {},
    eventCounters: {},
    attemptCooldowns: {},
    propFlags: {},
  };
}

function setup() {
  const lore = new LoreVault();
  const schedule = readJson<RegionSchedule>(`${C}/schedule.json`);
  const region: RegionIndex = {
    id: 'crambell',
    name: 'Crambell',
    theme: 'route-exclusion-test',
    locationIds: ['delth_patrol_zone', 'delth_forest', 'delth_mining_shafts'],
    npcIds: [],
    questIds: ['crambell_kach_test1', 'crambell_kach_test2', 'crambell_kach_test3'],
    factionIds: ['crambell_government', 'crambell_treffen'],
    globalEventIds: [],
  };
  lore.load({
    locations: {
      delth_patrol_zone:   readJson<LocationNode>(`${C}/locations/delth_patrol_zone.json`),
      delth_forest:        readJson<LocationNode>(`${C}/locations/delth_forest.json`),
      delth_mining_shafts: readJson<LocationNode>(`${C}/locations/delth_mining_shafts.json`),
    },
    regions:   { crambell: region },
    schedules: { crambell: schedule },
    factions: {
      crambell_government: readJson<Faction>(`${C}/factions/crambell_government.json`),
      crambell_treffen:    readJson<Faction>(`${C}/factions/crambell_treffen.json`),
    },
    events: {
      crambell_kach_forest_walk: readJson<GameEvent>(`${C}/events/crambell_kach_forest_walk.json`),
      crambell_kach_mine_invite: readJson<GameEvent>(`${C}/events/crambell_kach_mine_invite.json`),
    },
    quests: {
      crambell_kach_test1: readJson<QuestDefinition>(`${C}/quests/crambell_kach_test1.json`),
      crambell_kach_test2: readJson<QuestDefinition>(`${C}/quests/crambell_kach_test2.json`),
      crambell_kach_test3: readJson<QuestDefinition>(`${C}/quests/crambell_kach_test3.json`),
    },
    dialogues: {
      crambell_kane_default: readJson<DialogueProfile>(`${C}/dialogues/crambell_kane_default.json`),
    },
  });

  const state       = new StateManager(makeState(), new EventBus());
  const events      = new EventEngine(lore, state, new TimeManager(), schedule);
  const quests      = new QuestEngine(lore, state);
  const factionTree = new FactionTreeEngine(lore, state);
  quests.setFactionTree(factionTree);
  const dialogueMgr = new DialogueManager(lore, state);
  return { lore, state, events, quests, dialogueMgr };
}

type Env = ReturnType<typeof setup>;

/** 取得交付節點目前可見的 confirm 變體（必須恰好一個）。 */
function visibleConfirm(env: Env, nodeId: 'kane_deliver_kach' | 'kane_deliver_alliance'): ScriptedChoice {
  const node = env.dialogueMgr.getNode('crambell_kane', 'crambell_kane_default', nodeId)!;
  const visible = env.dialogueMgr.filterChoices(node.choices, env.state.flags);
  expect(visible).toHaveLength(1);
  return visible[0];
}

/** 比照 GameController 對話選項處理：套用效果後若有 ditchQuestId 則 ditch。 */
function applyChoice(env: Env, choice: ScriptedChoice): void {
  env.dialogueMgr.applyChoiceEffects('crambell_kane', choice.effects);
  if (choice.effects?.ditchQuestId) env.quests.ditchQuest(choice.effects.ditchQuestId);
}

/** Ditch 後任務移出 activeQuests，且 `:active` 旗標清除。 */
function expectDitched(env: Env, questId: string): void {
  expect(env.state.getState().activeQuests[questId]).toBeUndefined();
  expect(env.state.flags.has(`${questId}:active`)).toBe(false);
}

/** 走完 test1（掩護 + 兩倍配額 → 回報）並自動取得 test2。 */
function completeTest1(env: Env): void {
  expect(env.quests.grantQuest('crambell_kach_test1')).toBe(true);
  env.state.flags.set('crambell_kach_cover_held');
  env.quests.checkObjectives();
  // 只有掩護還不夠：兩倍配額是並行目標
  expect(env.state.getState().activeQuests['crambell_kach_test1']?.currentStageId).toBe('cover_for_kach');
  env.state.flags.set('crambell_kach_double_quota_done');
  env.quests.checkObjectives();
  expect(env.state.getState().activeQuests['crambell_kach_test1']?.currentStageId).toBe('report_back');
  env.state.flags.set('crambell_kach_test2_briefed');
  env.quests.checkObjectives();
  expect(env.state.getState().activeQuests['crambell_kach_test1']?.isCompleted).toBe(true);
  expect(env.state.getState().activeQuests['crambell_kach_test2']).toBeDefined();
}

describe('Crambell route4/5 exclusion — selling intel to Kane ditches active Kach test', () => {
  it('give_kach while test1 at report_back ditches test1', () => {
    const env = setup();
    env.quests.grantQuest('crambell_kach_test1');
    env.state.flags.set('crambell_kach_cover_held');
    env.state.flags.set('crambell_kach_double_quota_done');
    env.quests.checkObjectives();

    const choice = visibleConfirm(env, 'kane_deliver_kach');
    expect(choice.id).toBe('confirm');
    expect(choice.effects?.ditchQuestId).toBe('crambell_kach_test1');
    applyChoice(env, choice);

    expectDitched(env, 'crambell_kach_test1');
    expect(env.state.getState().completedQuestIds).toContain('crambell_kach_test1');
    expect(env.state.flags.has('crambell_kach_betrayed')).toBe(true);
  });

  it('give_alliance while test2 active ditches test2 only (completed test1 untouched)', () => {
    const env = setup();
    completeTest1(env);
    const affinityBefore = env.state.getState().player.externalStats.affinity['crambell_kach'] ?? 0;

    const choice = visibleConfirm(env, 'kane_deliver_alliance');
    expect(choice.id).toBe('confirm_ditch_test2');
    applyChoice(env, choice);

    expectDitched(env, 'crambell_kach_test2');
    // test1 的 ditchConsequences 不應被重新套用
    expect(env.state.flags.has('crambell_kach_betrayed')).toBe(false);
    expect(env.state.getState().player.externalStats.affinity['crambell_kach'] ?? 0).toBe(affinityBefore);
    expect(env.state.flags.has('crambell_peoples_alliance_betrayed')).toBe(true);
  });

  it('give_kach while test2 active: treffen -30 from dialogue, test1 ditch consequences not reapplied', () => {
    const env = setup();
    completeTest1(env);
    const rep = () => env.state.getState().player.externalStats.reputation;
    const treffenBefore = rep()['crambell_treffen'] ?? 0;
    const govBefore = rep()['crambell_government'] ?? 0;

    const choice = visibleConfirm(env, 'kane_deliver_kach');
    expect(choice.id).toBe('confirm_ditch_test2');
    applyChoice(env, choice);

    expectDitched(env, 'crambell_kach_test2');
    expect(rep()['crambell_treffen'] ?? 0).toBe(treffenBefore - 30);
    expect(rep()['crambell_government'] ?? 0).toBe(govBefore);
    expect(env.state.flags.has('crambell_kach_betrayed')).toBe(false);
  });

  it('give_alliance while test3 active ditches test3', () => {
    const env = setup();
    completeTest1(env);
    env.state.flags.set('crambell_kach_test2_orland_met');
    env.quests.checkObjectives();
    env.state.flags.set('crambell_kach_test2_document_obtained');
    env.quests.checkObjectives();
    env.state.flags.set('crambell_kach_test2_reported');
    env.quests.checkObjectives();
    expect(env.state.getState().activeQuests['crambell_kach_test3']).toBeDefined();

    const choice = visibleConfirm(env, 'kane_deliver_alliance');
    expect(choice.id).toBe('confirm_ditch_test3');
    applyChoice(env, choice);
    expectDitched(env, 'crambell_kach_test3');
  });

  it('give_alliance with no Kach test: no ditch, no credit change, route5 entry blocked afterwards', () => {
    const env = setup();
    const creditBefore = { ...(env.state.getState().player.externalStats.credit ?? {}) };

    // 對照：交付前，路線五入口事件可觸發（森林邀約）
    const probe = setup();
    probe.state.flags.set('crambell_kach_test1_briefed');
    probe.state.flags.set('kach_hangout_accepted');
    probe.state.advanceTime({ year: 1498, month: 6, day: 12, hour: 22, minute: 0, totalMinutes: 720 }, 'rest');
    expect(probe.events.checkAndApply('delth_forest_clearing')
      .some(t => t.event.id === 'crambell_kach_forest_walk')).toBe(true);

    const choice = visibleConfirm(env, 'kane_deliver_alliance');
    expect(choice.id).toBe('confirm_no_kach_test');
    expect(choice.effects?.ditchQuestId).toBeUndefined();
    applyChoice(env, choice);

    expect(env.state.getState().player.externalStats.credit ?? {}).toEqual(creditBefore);
    expect(env.state.flags.has('crambell_peoples_alliance_betrayed')).toBe(true);

    // 安全性：對未持有的任務 ditch 回傳 false，不扣信用
    expect(env.quests.ditchQuest('crambell_kach_test2')).toBe(false);
    expect(env.state.getState().player.externalStats.credit ?? {}).toEqual(creditBefore);

    // 之後兩個路線五入口事件都不再觸發
    env.state.flags.set('crambell_kach_test1_briefed');
    env.state.flags.set('kach_hangout_accepted');
    env.state.advanceTime({ year: 1498, month: 6, day: 12, hour: 22, minute: 0, totalMinutes: 720 }, 'rest');
    expect(env.events.checkAndApply('delth_forest_clearing')
      .some(t => t.event.id === 'crambell_kach_forest_walk')).toBe(false);

    env.state.flags.unset('kach_hangout_accepted');
    env.state.advanceTime({ year: 1498, month: 6, day: 13, hour: 10, minute: 0, totalMinutes: 1440 }, 'work');
    expect(env.events.checkAndApply('delth_mine_storage')
      .some(t => t.event.id === 'crambell_kach_mine_invite')).toBe(false);
  });

  it('route5 entry events are blocked once crambell_player_allied_government is set', () => {
    const env = setup();
    env.state.flags.set('crambell_player_allied_government');
    env.state.flags.set('crambell_kach_test1_briefed');
    env.state.advanceTime({ year: 1498, month: 6, day: 12, hour: 10, minute: 0, totalMinutes: 0 }, 'work');
    expect(env.events.checkAndApply('delth_mine_storage')
      .some(t => t.event.id === 'crambell_kach_mine_invite')).toBe(false);

    // 對照：未設旗標時礦坑邀約可觸發
    const probe = setup();
    probe.state.flags.set('crambell_kach_test1_briefed');
    expect(probe.events.checkAndApply('delth_mine_storage')
      .some(t => t.event.id === 'crambell_kach_mine_invite')).toBe(true);
  });
});
