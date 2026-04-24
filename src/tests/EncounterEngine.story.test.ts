/**
 * EncounterEngine — story 型別單元測試
 *
 * 涵蓋：
 *   1. start()   批次推進到第一個 pause，逐行套用 effects
 *   2. advanceLine() 推進到第二個 pause，套用該批 effects
 *   3. advanceLine() 到達 script 結尾，套用 result.effects，返回 null
 *   4. pause 之前的 effects 已套用，pause 之後的尚未套用
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../lib/engine/EventBus';
import { EncounterEngine } from '../lib/engine/EncounterEngine';
import { StateManager } from '../lib/engine/StateManager';
import { LoreVault } from '../lib/lore/LoreVault';
import type { EncounterDefinition } from '../lib/types/encounter';
import type { GameState } from '../lib/types/game';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeState(): GameState {
  return {
    player: {
      id: 'story-test-player',
      name: 'Story Tester',
      origin: 'worker',
      currentLocationId: 'loc_start',
      primaryStats: { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
      secondaryStats: { consciousness: 0, mysticism: 0, technology: 0 },
      statusStats: {
        stamina: 10, staminaMax: 10,
        stress: 0,  stressMax: 10,
        endo: 0,    endoMax: 0,
        experience: 0,
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
    time: { year: 1498, month: 6, day: 1, hour: 12, minute: 0, totalMinutes: 0 },
    timePeriod: 'work',
    eventCooldowns: {},
    eventCounters: {},
  };
}

/**
 * 測試用 story 遭遇腳本：
 *
 *   line 0 — narrator "開場白"           (auto)
 *   line 1 — effects: stress+2           (auto)
 *   line 2 — npc    "npc說話", pause     ← 第一個 pause，start() 停在此
 *   line 3 — narrator "第二幕"           (auto)
 *   line 4 — effects: flagsSet mid_flag, pause ← 第二個 pause
 *   line 5 — narrator "尾聲"             (auto)
 *   result  — outcomeType:'success', effects: flagsSet result_flag, stress-1
 */
const STORY_DEF: EncounterDefinition = {
  id:          'test_story_enc',
  name:        '測試劇情',
  type:        'story',
  description: '自動測試用劇情遭遇。',
  script: [
    {
      speaker: 'narrator',
      text:    '開場白。',
    },
    {
      effects: { statChanges: { 'statusStats.stress': 2 } },
    },
    {
      speaker: 'npc_a',
      text:    'npc說話。',
      pause:   true,
    },
    {
      speaker: 'narrator',
      text:    '第二幕。',
    },
    {
      effects: { flagsSet: ['mid_flag'] },
      pause:   true,
    },
    {
      speaker: 'narrator',
      text:    '尾聲。',
    },
  ],
  result: {
    outcomeType: 'success',
    effects: {
      flagsSet:   ['result_flag'],
      statChanges: { 'statusStats.stress': -1 },
    },
  },
};

function setup() {
  const bus       = new EventBus();
  const state     = new StateManager(makeState(), bus);
  const lore      = new LoreVault();
  lore.load({ encounters: { test_story_enc: STORY_DEF } });
  const encounters = new EncounterEngine(lore, state);
  return { state, encounters };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('EncounterEngine — story type', () => {
  it('start() batch-advances to first pause and applies per-line effects', () => {
    const { state, encounters } = setup();

    const result = encounters.start('test_story_enc');

    // 返回 story 類型
    expect(result?.kind).toBe('story');
    if (result?.kind !== 'story') return;

    // 停在第一個 pause（line 2）
    expect(result.currentLineIndex).toBe(2);

    // line 1 的 stress+2 已套用
    expect(state.getState().player.statusStats.stress).toBe(2);

    // line 4 的 mid_flag 尚未套用
    expect(state.flags.has('mid_flag')).toBe(false);

    // 遊戲狀態切換為 event 模式
    expect(state.getState().phase).toBe('event');
  });

  it('advanceLine() advances to second pause and applies only that batch effects', () => {
    const { state, encounters } = setup();
    encounters.start('test_story_enc');

    const result = encounters.advanceLine();

    // 推進到第二個 pause（line 4），返回非 null
    expect(result).not.toBeNull();
    expect(result?.currentLineIndex).toBe(4);

    // line 4 的 mid_flag 已套用
    expect(state.flags.has('mid_flag')).toBe(true);

    // result_flag 尚未套用（result 要到 script 結束才套用）
    expect(state.flags.has('result_flag')).toBe(false);

    // stress 仍為 2（本批無 statChanges）
    expect(state.getState().player.statusStats.stress).toBe(2);
  });

  it('advanceLine() at end applies result effects and returns null', () => {
    const { state, encounters } = setup();
    encounters.start('test_story_enc');
    encounters.advanceLine(); // advance to second pause

    const result = encounters.advanceLine();

    // script 結束，返回 null
    expect(result).toBeNull();

    // result.effects 套用：result_flag set、stress -1（2 - 1 = 1）
    expect(state.flags.has('result_flag')).toBe(true);
    expect(state.getState().player.statusStats.stress).toBe(1);

    // 遭遇結束，phase 回到 exploring
    expect(state.getState().phase).toBe('exploring');
  });

  it('effects from later lines are not applied before their batch is reached', () => {
    const { state, encounters } = setup();

    // 剛 start()：只有 line 0-2 的 batch 執行
    encounters.start('test_story_enc');

    // mid_flag（line 4）與 result_flag（result）都不應存在
    expect(state.flags.has('mid_flag')).toBe(false);
    expect(state.flags.has('result_flag')).toBe(false);
  });
});
