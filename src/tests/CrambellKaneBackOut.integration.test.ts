// CrambellKaneBackOut.integration.test.ts
//
// 路線四（凱恩／政府）拒絕交易分支的整合測試。
// 驗證：玩家在林間交易選 back_out 後，crambell_kane_double_agent 的 meet_for_handoff
// 階段透過 failCondition（crambell_kane_deal_abandoned）失敗，而非永久卡死；
// 凱恩休息時段排程在交易待進行時位於林間空地，結束後回到原位置；
// 政府陣營樹不因此進入不一致狀態（未加入、未完成 checkpoint、未觸發 breakpoint）。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameController } from '../lib/engine/GameController';
import type { ILLMClient, ChatMessage } from '../lib/ai/ILLMClient';
import type { StateManager } from '../lib/engine/StateManager';
import type { QuestEngine } from '../lib/engine/QuestEngine';
import type { EncounterEngine } from '../lib/engine/EncounterEngine';
import type { EventEngine, TriggeredEvent } from '../lib/engine/EventEngine';
import type { FactionTreeEngine } from '../lib/engine/FactionTreeEngine';
import type { LoreVault } from '../lib/lore/LoreVault';
import type { EncounterDefinition } from '../lib/types/encounter';
import type { QuestDefinition } from '../lib/types/quest';
import type {
  Faction, GameEvent, LocationNode, NPCNode, RegionIndex, RegionSchedule,
} from '../lib/types/world';

const REPO_ROOT = new URL('../../', import.meta.url);
const CRAMBELL  = 'lore/world/regions/crambell';
const QUEST_ID  = 'crambell_kane_double_agent';

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, REPO_ROOT), 'utf8')) as T;
}

class NoopClient implements ILLMClient {
  async complete(_sys: string, _msg: string): Promise<string> {
    return JSON.stringify({ allowed: true, reason: null, modifiedInput: null, actionType: null, targetId: null });
  }
  async *stream(_sys: string, _msgs: ChatMessage[]): AsyncGenerator<string> { /* no-op */ }
}

interface Internals {
  lore:         LoreVault;
  state:        StateManager;
  quests:       QuestEngine;
  events:       EventEngine;
  encounterMgr: EncounterEngine;
  factionTree:  FactionTreeEngine;
  checkQuestFailConditions: (crossedHours: number[]) => TriggeredEvent[];
}

function makeController(): { gc: GameController; i: Internals } {
  const client = new NoopClient();
  const gc = new GameController({ dm: client, regulator: client });

  const region: RegionIndex = {
    id: 'crambell',
    name: 'Crambell',
    theme: 'kane-backout-test',
    locationIds: ['delth_patrol_zone', 'delth_forest', 'delth_south_ground'],
    npcIds: ['crambell_kane'],
    questIds: [QUEST_ID],
    factionIds: ['crambell_government'],
    globalEventIds: [],
  };

  gc.loadLore({
    locations: {
      delth_patrol_zone:  readJson<LocationNode>(`${CRAMBELL}/locations/delth_patrol_zone.json`),
      delth_forest:       readJson<LocationNode>(`${CRAMBELL}/locations/delth_forest.json`),
      delth_south_ground: readJson<LocationNode>(`${CRAMBELL}/locations/delth_south_ground.json`),
    },
    regions:   { crambell: region },
    schedules: { crambell: readJson<RegionSchedule>(`${CRAMBELL}/schedule.json`) },
    npcs:      { crambell_kane: readJson<NPCNode>(`${CRAMBELL}/npcs/crambell_kane.json`) },
    factions:  { crambell_government: readJson<Faction>(`${CRAMBELL}/factions/crambell_government.json`) },
    events: {
      crambell_kane_forest_handoff: readJson<GameEvent>(`${CRAMBELL}/events/crambell_kane_forest_handoff.json`),
    },
    quests: {
      [QUEST_ID]: readJson<QuestDefinition>(`${CRAMBELL}/quests/${QUEST_ID}.json`),
    },
    encounters: {
      crambell_enc_kane_forest_handoff:
        readJson<EncounterDefinition>(`${CRAMBELL}/encounters/crambell_enc_kane_forest_handoff.json`),
    },
  });

  const i = gc as unknown as Internals;
  // 私有方法需綁定 this
  i.checkQuestFailConditions = (gc as unknown as Internals).checkQuestFailConditions.bind(gc);
  return { gc, i };
}

describe('Crambell route4 — Kane forest handoff back_out', () => {
  it('back_out fails the double-agent quest instead of deadlocking', () => {
    const { i } = makeController();
    const { lore, state, quests, events, encounterMgr, factionTree } = i;

    // ── 取得任務並交付情報 → meet_for_handoff ─────────────────────────────
    expect(quests.grantQuest(QUEST_ID)).toBe(true);
    expect(state.getState().activeQuests[QUEST_ID]?.currentStageId).toBe('pending_intel');

    state.flags.set('crambell_kane_intel_delivered');
    quests.checkObjectives();
    expect(state.getState().activeQuests[QUEST_ID]?.currentStageId).toBe('meet_for_handoff');

    // ── 排程：交易待進行時，凱恩休息時段在林間空地 ─────────────────────────
    expect(lore.resolveNPCLocation('crambell_kane', state.flags, 'rest')).toBe('delth_forest_clearing');
    expect(lore.resolveNPCLocation('crambell_kane', state.flags, 'work')).toBe('delth_patrol_zone');

    // ── 休息時段前往林間空地 → 交付事件觸發 ───────────────────────────────
    state.advanceTime(
      { year: 1498, month: 6, day: 14, hour: 22, minute: 0, totalMinutes: 1920 },
      'rest',
    );
    state.getState().player.currentLocationId = 'delth_forest_clearing';

    const handoff = events.checkAndApply('delth_forest_clearing')
      .find(t => t.event.id === 'crambell_kane_forest_handoff');
    expect(handoff?.startEncounterId).toBe('crambell_enc_kane_forest_handoff');

    // ── 遭遇：玩家選 back_out ──────────────────────────────────────────────
    const start = encounterMgr.start('crambell_enc_kane_forest_handoff');
    expect(start?.kind).toBe('node');
    expect(encounterMgr.selectChoice('back_out')).not.toBeNull();
    const pending = encounterMgr.flushPendingEffects();
    expect(pending.outcomeType).toBe('failure');
    if (pending.outcomeType !== undefined) encounterMgr.conclude(pending.outcomeType);
    quests.checkObjectives();

    expect(state.flags.has('crambell_kane_deal_abandoned')).toBe(true);
    // failCondition 掃描前，任務仍停在 meet_for_handoff
    expect(state.getState().activeQuests[QUEST_ID]?.isFailed).toBeFalsy();

    // ── GameController failCondition 掃描（每回合 2.5 步驟）→ 任務失敗 ───────
    i.checkQuestFailConditions([]);
    const inst = state.getState().activeQuests[QUEST_ID];
    expect(inst?.isFailed).toBe(true);
    expect(inst?.isCompleted).toBeFalsy();
    expect(state.getState().completedQuestIds).toContain(QUEST_ID);
    expect(state.flags.has('crambell_kane_deal_completed')).toBe(false);

    // 交付事件不再觸發；凱恩休息時段回到排水溝
    state.advanceTime(
      { year: 1498, month: 6, day: 15, hour: 22, minute: 0, totalMinutes: 3360 },
      'rest',
    );
    expect(events.checkAndApply('delth_forest_clearing')
      .some(t => t.event.id === 'crambell_kane_forest_handoff')).toBe(false);
    expect(lore.resolveNPCLocation('crambell_kane', state.flags, 'rest'))
      .toBe('delth_south_ground_drainage_ditch');

    // ── 陣營樹：失敗不走 onQuestComplete/onQuestDitch → 未加入、無 checkpoint、無 breakpoint ─
    const rel = state.getFactionRelation('crambell_government');
    expect(rel?.isJoined ?? false).toBe(false);
    expect(rel?.completedCheckpointIds ?? []).not.toContain('cp_kane_intel');
    expect(rel?.creditBreakpointHit ?? false).toBe(false);
    expect(state.flags.has('crambell_government_cp1_done')).toBe(false);
    expect(factionTree.isEpicQuestAvailable(QUEST_ID)).toBe(true);
    // 已失敗的任務不可重新授予（entry quest 封閉 → 政府 epic 路線關閉，而非卡在進行中）
    expect(quests.grantQuest(QUEST_ID)).toBe(false);
  });
});
