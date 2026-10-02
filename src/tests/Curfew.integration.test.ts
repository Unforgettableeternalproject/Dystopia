// Curfew.integration.test.ts
//
// 門禁（宵禁）：
// - 雙向：門禁中宿舍出不去、外面進不來（外面可嘗試闖入遭遇）
// - 實際門禁時間由 StateManager 的門禁設定 + 當晚覆寫決定；廣播事件觸發後實際改變、次日回復
// - 所有判斷（通道、事件條件）都讀同一個 activeFlag
// 使用真實 lore（schedule.json、宿舍區四個地點、廣播與宵禁事件）。

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../lib/engine/EventBus';
import { EventEngine } from '../lib/engine/EventEngine';
import { StateManager } from '../lib/engine/StateManager';
import { TimeManager } from '../lib/engine/TimeManager';
import { LoreVault } from '../lib/lore/LoreVault';
import type { GameState, GameTime } from '../lib/types/game';
import type { GameEvent, LocationNode, RegionIndex, RegionSchedule } from '../lib/types/world';
import {
  computeOverrideExpiry,
  getEffectiveCurfew,
  interpolateCurfew,
  isCurfewActive,
} from '../lib/utils/curfew';
import { buildClockBlock } from '../lib/utils/timeContext';

const REPO_ROOT = new URL('../../', import.meta.url);
const C = 'lore/world/regions/crambell';
const FLAG = 'crambell_curfew_active';

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, REPO_ROOT), 'utf8')) as T;
}

const BASE_TIME: GameTime = { year: 1498, month: 6, day: 12, hour: 0, minute: 0, totalMinutes: 0 };
const timeMgr = new TimeManager();
/** 第 day 天（12 = 起始日）hh:mm 的 GameTime */
function at(day: number, hour: number, minute = 0): GameTime {
  return timeMgr.advance(BASE_TIME, (day - 12) * 1440 + hour * 60 + minute);
}

function makeState(locationId: string): GameState {
  return {
    player: {
      id: 'curfew-player', name: 'Curfew Tester', origin: 'worker',
      currentLocationId: locationId,
      primaryStats:       { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
      primaryStatsExp:    { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      inclinationTracker: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      dailyGrantTracker:  { dateKey: '1498-6-12', grantedExp: {} },
      secondaryStats: { consciousness: 2, mysticism: 0, technology: 3 },
      statusStats: {
        stamina: 10, staminaMax: 10, stress: 0, stressMax: 10,
        endo: 0, endoMax: 0, experience: 0, fatigue: 0,
      },
      externalStats: { reputation: {}, affinity: {}, familiarity: {} },
      inventory: [], melphin: 0, activeFlags: new Set(), titles: [], conditions: [], knownIntelIds: [],
    },
    turn: 0, phase: 'exploring', pendingThoughts: [], lastNarrative: '', history: [],
    discoveredLocationIds: [], activeQuests: {}, completedQuestIds: [], npcMemory: {},
    worldPhase: { currentPhase: 'phase_1', appliedPhaseIds: [] },
    time: at(12, 10), timePeriod: 'work',
    eventCooldowns: {}, eventCounters: {}, attemptCooldowns: {}, propFlags: {},
  };
}

function setup(locationId = 'delth_dormitory') {
  const schedule = readJson<RegionSchedule>(`${C}/schedule.json`);
  const region: RegionIndex = {
    id: 'crambell', name: 'Crambell', theme: 'curfew-test',
    locationIds: ['delth_dormitory', 'delth_forest', 'delth_patrol_zone', 'delth_mine_path'],
    npcIds: [], questIds: [], factionIds: [],
    globalEventIds: ['crambell_event_curfew'],
  };
  const lore = new LoreVault();
  lore.load({
    locations: {
      delth_dormitory:   readJson<LocationNode>(`${C}/locations/delth_dormitory.json`),
      delth_forest:      readJson<LocationNode>(`${C}/locations/delth_forest.json`),
      delth_patrol_zone: readJson<LocationNode>(`${C}/locations/delth_patrol_zone.json`),
      delth_mine_path:   readJson<LocationNode>(`${C}/locations/delth_mine_path.json`),
    },
    regions:   { crambell: region },
    schedules: { crambell: schedule },
    events: {
      crambell_delth_broadcast: readJson<GameEvent>(`${C}/events/crambell_broadcast.json`),
      crambell_event_curfew:    readJson<GameEvent>(`${C}/events/crambell_event_curfew.json`),
    },
  });
  const state = new StateManager(makeState(locationId), new EventBus());
  state.setCurfewConfig(schedule.curfew);
  const events = new EventEngine(lore, state, timeMgr, schedule);

  const setTime = (t: GameTime) => {
    state.advanceTime(t, timeMgr.getCurrentPeriod(t, schedule));
  };

  /** 檢查 from → to 通道的存取結果（與地圖、移動驗證同一個入口） */
  const access = (from: string, to: string) => {
    const loc = lore.resolveLocation(from, state.flags)!;
    const conn = loc.connections.find(c => c.targetLocationId === to)!;
    const gs = state.getState();
    const result = lore.getConnectionAccessResult(
      conn, state.flags, gs.timePeriod, [], [], gs.time, [], 0,
      { attemptCooldowns: gs.attemptCooldowns, connectionKey: from + '→' + to },
    );
    return { ...result, lockedMessage: conn.access?.lockedMessage };
  };

  return { lore, state, events, schedule, setTime, access };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('門禁時間計算（純函式）', () => {
  const cfg = { startHour: 23, startMinute: 0, endHour: 4, endMinute: 0, activeFlag: FLAG };

  it('預設 23:00–04:00，跨午夜判斷正確', () => {
    expect(isCurfewActive(cfg, undefined, at(12, 22, 59))).toBe(false);
    expect(isCurfewActive(cfg, undefined, at(12, 23, 0))).toBe(true);
    expect(isCurfewActive(cfg, undefined, at(13, 3, 59))).toBe(true);
    expect(isCurfewActive(cfg, undefined, at(13, 4, 0))).toBe(false);
  });

  it('白天觸發的覆寫於隔天 04:00 失效；凌晨觸發則套用到即將到來的這一晚', () => {
    expect(computeOverrideExpiry(cfg, at(12, 10))).toBe(at(13, 4).totalMinutes);
    expect(computeOverrideExpiry(cfg, at(12, 2))).toBe(at(13, 4).totalMinutes);
    expect(computeOverrideExpiry(cfg, at(12, 4))).toBe(at(13, 4).totalMinutes);
  });

  it('覆寫過期後回到預設開始時間', () => {
    const override = { startHour: 22, startMinute: 15, expiresAtTotalMinutes: at(13, 4).totalMinutes };
    expect(getEffectiveCurfew(cfg, override, at(12, 22).totalMinutes)).toMatchObject({ startHour: 22, startMinute: 15, overridden: true });
    expect(getEffectiveCurfew(cfg, override, at(13, 4).totalMinutes)).toMatchObject({ startHour: 23, startMinute: 0, overridden: false });
  });

  it('{curfewStart} 以實際門禁時間插值', () => {
    const w = getEffectiveCurfew(cfg, { startHour: 22, startMinute: 30, expiresAtTotalMinutes: 99999 }, 0);
    expect(interpolateCurfew('本日宵禁時間提前至{curfewStart}', w)).toBe('本日宵禁時間提前至22:30');
  });
});

describe('門禁雙向封鎖（真實 lore）', () => {
  it('門禁中：宿舍出不去（直接封鎖、給原因），外面進不來（可嘗試闖入）', () => {
    const { state, setTime, access } = setup();

    setTime(at(12, 22, 59));
    expect(state.flags.has(FLAG)).toBe(false);
    expect(access('delth_dormitory', 'delth_forest').allowed).toBe(true);
    expect(access('delth_forest', 'delth_dormitory').allowed).toBe(true);

    setTime(at(12, 23, 0));
    expect(state.flags.has(FLAG)).toBe(true);
    for (const target of ['delth_forest', 'delth_patrol_zone']) {
      const out = access('delth_dormitory', target);
      expect(out.allowed).toBe(false);
      expect(out.attemptEncounterId).toBeUndefined();
      expect(out.lockedMessage).toContain('門禁');
    }
    for (const source of ['delth_forest', 'delth_patrol_zone', 'delth_mine_path']) {
      const inward = access(source, 'delth_dormitory');
      expect(inward.allowed).toBe(false);
      expect(inward.attemptEncounterId).toBe('crambell_enc_dormitory_curfew');
    }

    setTime(at(13, 4, 0));
    expect(state.flags.has(FLAG)).toBe(false);
    expect(access('delth_dormitory', 'delth_forest').allowed).toBe(true);
    expect(access('delth_forest', 'delth_dormitory').allowed).toBe(true);
  });
});

describe('廣播提前門禁：實際改變門禁時間、次日回復', () => {
  it('觸發後當晚門禁提前到抽中的時刻，隔天回到 23:00', () => {
    const { state, events, setTime, access } = setup();
    setTime(at(12, 10, 0));

    // options = [22:00, 22:15, 22:30, 22:45]；0.6 × 4 → index 2 → 22:30
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const fired = events.fireEventById('crambell_delth_broadcast');
    expect(fired?.outcome.id).toBe('broadcast_curfew_warning');
    expect(state.getState().curfewOverride).toMatchObject({ startHour: 22, startMinute: 30 });
    expect(interpolateCurfew(fired!.outcome.description, state.getEffectiveCurfew()))
      .toContain('本日宵禁時間提前至22:30');

    // 同一晚重播不重抽
    vi.spyOn(Math, 'random').mockReturnValue(0);
    events.fireEventById('crambell_delth_broadcast');
    expect(state.getState().curfewOverride).toMatchObject({ startHour: 22, startMinute: 30 });

    setTime(at(12, 22, 29));
    expect(access('delth_dormitory', 'delth_forest').allowed).toBe(true);
    setTime(at(12, 22, 30));
    expect(state.flags.has(FLAG)).toBe(true);
    expect(access('delth_dormitory', 'delth_forest').allowed).toBe(false);
    expect(access('delth_forest', 'delth_dormitory').allowed).toBe(false);

    // 次日 04:00 門禁結束，覆寫失效
    setTime(at(13, 4, 0));
    expect(state.getState().curfewOverride).toBeUndefined();
    expect(state.flags.has(FLAG)).toBe(false);

    // 隔晚回到預設 23:00
    setTime(at(13, 22, 30));
    expect(state.flags.has(FLAG)).toBe(false);
    expect(access('delth_dormitory', 'delth_forest').allowed).toBe(true);
    setTime(at(13, 23, 0));
    expect(state.flags.has(FLAG)).toBe(true);
  });

  it('宵禁事件依同一個旗標觸發：提前後 22:30 在外面就觸發，在宿舍內不觸發', () => {
    const outside = setup('delth_forest');
    outside.setTime(at(12, 10, 0));
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    outside.events.fireEventById('crambell_delth_broadcast');
    outside.setTime(at(12, 22, 0));
    expect(outside.events.checkGlobalEvents('crambell').map(t => t.event.id)).not.toContain('crambell_event_curfew');
    outside.setTime(at(12, 22, 30));
    expect(outside.events.checkGlobalEvents('crambell').map(t => t.event.id)).toContain('crambell_event_curfew');

    const inside = setup('delth_dormitory');
    inside.setTime(at(12, 23, 30));
    expect(inside.events.checkGlobalEvents('crambell').map(t => t.event.id)).not.toContain('crambell_event_curfew');
  });

  it('提供給 LLM 的時間資訊反映實際門禁時間', () => {
    const { state, events, setTime, schedule } = setup();
    setTime(at(12, 10, 0));
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    events.fireEventById('crambell_delth_broadcast');
    setTime(at(12, 21, 0));
    const block = buildClockBlock({
      time: state.getState().time, schedule,
      curfew: state.getEffectiveCurfew(),
      curfewDefaultStart: { hour: 23, minute: 0 },
    });
    expect(block).toContain('Curfew (門禁): 22:30–04:00（今晚臨時調整，預設 23:00 開始）');
    expect(block).toContain('22:30 門禁開始 (+90 min)');
  });
});
