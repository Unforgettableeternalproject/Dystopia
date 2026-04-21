import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../lib/engine/EventBus';
import { EncounterEngine } from '../lib/engine/EncounterEngine';
import { EventEngine } from '../lib/engine/EventEngine';
import { QuestEngine } from '../lib/engine/QuestEngine';
import { StateManager } from '../lib/engine/StateManager';
import { TimeManager } from '../lib/engine/TimeManager';
import { LoreVault } from '../lib/lore/LoreVault';
import type { EncounterDefinition } from '../lib/types/encounter';
import type { GameState } from '../lib/types/game';
import type { GameEvent, LocationNode, RegionIndex, RegionSchedule } from '../lib/types/world';
import type { QuestDefinition } from '../lib/types/quest';

const REPO_ROOT = new URL('../../', import.meta.url);

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, REPO_ROOT), 'utf8')) as T;
}

function makeState(): GameState {
  return {
    player: {
      id: 'route1-player',
      name: 'Route1 Tester',
      origin: 'worker',
      currentLocationId: 'delth_mine_worksite',
      primaryStats: { strength: 6, knowledge: 5, talent: 5, spirit: 5, luck: 3 },
      secondaryStats: { consciousness: 2, mysticism: 0, technology: 3 },
      statusStats: {
        stamina: 10, staminaMax: 10,
        stress: 0, stressMax: 10,
        endo: 0, endoMax: 0,
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
    time: { year: 1498, month: 6, day: 12, hour: 17, minute: 50, totalMinutes: 0 },
    timePeriod: 'work',
    eventCooldowns: {},
    eventCounters: {},
  };
}

function loadRoute1Lore() {
  const lore = new LoreVault();
  const schedule = readJson<RegionSchedule>('lore/world/regions/crambell/schedule.json');
  const region: RegionIndex = {
    id: 'crambell',
    name: 'Crambell',
    theme: 'route1-test',
    locationIds: [
      'delth_mining_shafts',
      'delth_mine_worksite',
      'delth_patrol_zone',
      'delth_quota_post',
      'delth_transit_hub',
    ],
    npcIds: [],
    questIds: ['crambell_transfer_opportunity'],
    factionIds: [],
    globalEventIds: [
      'crambell_work_period_start',
      'crambell_rest_period_start',
      'crambell_quota_failure',
      'crambell_transfer_wait',
    ],
  };

  lore.load({
    locations: {
      delth_mining_shafts: readJson<LocationNode>('lore/world/regions/crambell/locations/delth_mining_shafts.json'),
      delth_patrol_zone: readJson<LocationNode>('lore/world/regions/crambell/locations/delth_patrol_zone.json'),
      delth_transit_hub: readJson<LocationNode>('lore/world/regions/crambell/locations/delth_transit_hub.json'),
    },
    regions: { crambell: region },
    schedules: { crambell: schedule },
    events: {
      crambell_transfer_trigger: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_transfer_trigger.json'),
      crambell_transfer_apply: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_transfer_apply.json'),
      crambell_transfer_collect_permit: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_transfer_collect_permit.json'),
      crambell_transfer_wait: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_transfer_wait.json'),
      crambell_quota_failure: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_quota_failure.json'),
      crambell_work_period_start: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_work_period_start.json'),
      crambell_rest_period_start: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_rest_period_start.json'),
    },
    quests: {
      crambell_transfer_opportunity: readJson<QuestDefinition>('lore/world/regions/crambell/quests/crambell_transfer_opportunity.json'),
    },
    encounters: {
      crambell_enc_transfer_trigger: readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_transfer_trigger.json'),
      crambell_enc_transfer_apply: readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_transfer_apply.json'),
    },
  });

  return { lore, schedule };
}

function setClock(state: StateManager, day: number, hour: number, minute: number, timePeriod: 'work' | 'rest'): void {
  const current = state.getState().time.totalMinutes;
  const dayOffset = day - 12;
  const totalMinutes = dayOffset * 24 * 60 + hour * 60 + minute;
  state.advanceTime(
    { year: 1498, month: 6, day, hour, minute, totalMinutes: Math.max(totalMinutes, current + 1) },
    timePeriod,
  );
}

function crossHour(
  state: StateManager,
  events: EventEngine,
  day: number,
  hour: 6 | 18,
  timePeriod: 'work' | 'rest',
) {
  setClock(state, day, hour, 0, timePeriod);
  return events.checkGlobalEvents('crambell', [hour]);
}

function resolveEncounter(
  encounters: EncounterEngine,
  quests: QuestEngine,
  choiceId: string,
) {
  const resolved = encounters.selectChoice(choiceId);
  expect(resolved).not.toBeNull();

  const pending = encounters.flushPendingEffects();
  if (pending.questGrant) quests.grantQuest(pending.questGrant);
  if (pending.questFail) quests.applyQuestFail(pending.questFail);
  encounters.conclude(pending.outcomeType);

  return resolved!;
}

describe('Crambell route1 integration', () => {
  it('runs the transfer route from trigger chance to morning transit access', () => {
    const { lore, schedule } = loadRoute1Lore();
    const state = new StateManager(makeState(), new EventBus());
    const time = new TimeManager();
    const events = new EventEngine(lore, state, time, schedule);
    const quests = new QuestEngine(lore, state);
    const encounters = new EncounterEngine(lore, state);

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      for (let day = 12; day <= 14; day++) {
        state.flags.set('crambell_quota_met_today');

        const missed = events.checkAndApply('delth_mine_worksite');
        expect(missed).toHaveLength(1);
        expect(missed[0].event.id).toBe('crambell_transfer_trigger');
        expect(missed[0].outcome.id).toBe('no_opportunity_today');
        expect(state.getEventCounter('crambell_transfer_trigger_progress')).toBe(day - 11);

        crossHour(state, events, day, 18, 'rest');
        crossHour(state, events, day + 1, 6, 'work');

        expect(state.flags.has('crambell_quota_met_today')).toBe(false);
        expect(state.flags.has('crambell_transfer_trigger_checked')).toBe(false);
      }

      state.flags.set('crambell_quota_met_today');
      const hit = events.checkAndApply('delth_mine_worksite');
      expect(hit).toHaveLength(1);
      expect(hit[0].outcome.id).toBe('trigger_encounter');
      expect(hit[0].startEncounterId).toBe('crambell_enc_transfer_trigger');
      expect(state.getEventCounter('crambell_transfer_trigger_progress')).toBe(0);

      const triggerStart = encounters.start('crambell_enc_transfer_trigger');
      expect(triggerStart?.node.id).toBe('broadcast');
      const triggerOutcome = resolveEncounter(encounters, quests, 'try');
      expect(triggerOutcome.node.id).toBe('qualified');
      expect(state.getState().activeQuests.crambell_transfer_opportunity?.currentStageId).toBe('apply');

      crossHour(state, events, 15, 18, 'rest');
      state.getState().player.currentLocationId = 'delth_quota_post';
      const applyEvent = events.checkAndApply('delth_quota_post');
      expect(applyEvent).toHaveLength(1);
      expect(applyEvent[0].startEncounterId).toBe('crambell_enc_transfer_apply');

      const applyStart = encounters.start('crambell_enc_transfer_apply');
      expect(applyStart?.node.id).toBe('at_post');
      const applyOutcome = resolveEncounter(encounters, quests, 'apply_formally');
      expect(applyOutcome.node.id).toBe('approved');

      quests.checkObjectives();
      expect(state.getState().activeQuests.crambell_transfer_opportunity?.currentStageId).toBe('day1');
      expect(state.flags.has('crambell_transfer_application_approved')).toBe(true);

      crossHour(state, events, 16, 6, 'work');
      expect(state.flags.has('crambell_quota_met_today')).toBe(false);
      state.flags.set('crambell_quota_met_today');
      const day1Events = crossHour(state, events, 16, 18, 'rest');
      expect(day1Events.some(t => t.event.id === 'crambell_transfer_wait')).toBe(true);
      quests.checkObjectives();
      expect(state.getState().activeQuests.crambell_transfer_opportunity?.currentStageId).toBe('day2');

      crossHour(state, events, 17, 6, 'work');
      state.flags.set('crambell_quota_met_today');
      const day2Events = crossHour(state, events, 17, 18, 'rest');
      expect(day2Events.some(t => t.event.id === 'crambell_transfer_wait')).toBe(true);
      quests.checkObjectives();
      expect(state.getState().activeQuests.crambell_transfer_opportunity?.currentStageId).toBe('day3');

      crossHour(state, events, 18, 6, 'work');
      state.flags.set('crambell_quota_met_today');
      const day3Events = crossHour(state, events, 18, 18, 'rest');
      expect(day3Events.some(t => t.event.id === 'crambell_transfer_wait')).toBe(true);
      quests.checkObjectives();

      // After day3 stage completes, quest advances to collect_permit stage
      expect(state.getState().activeQuests.crambell_transfer_opportunity?.currentStageId).toBe('collect_permit');
      expect(state.flags.has('crambell_transfer_permit_ready')).toBe(true);

      // Advance to next work period and go to quota post to collect permit
      crossHour(state, events, 19, 6, 'work');
      state.getState().player.currentLocationId = 'delth_quota_post';
      const collectEvents = events.checkAndApply('delth_quota_post');
      expect(collectEvents.some(e => e.event.id === 'crambell_transfer_collect_permit')).toBe(true);

      quests.checkObjectives();
      expect(state.getState().activeQuests.crambell_transfer_opportunity).toBeUndefined();
      expect(state.getState().completedQuestIds).toContain('crambell_transfer_opportunity');
      expect(state.flags.has('crambell_transfer_permit_collected')).toBe(true);
      expect(state.flags.has('crambell_transfer_application_approved')).toBe(false);
      expect(state.getState().player.inventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemId: 'transit_pass', variantId: 'wyar', isExpired: false }),
        ]),
      );

      const transitHub = lore.resolveLocation('delth_transit_hub', state.flags);
      expect(transitHub).toBeDefined();
      const wyarConnection = transitHub!.connections.find(c => c.targetLocationId === 'wyar_transit_hub');
      expect(wyarConnection).toBeDefined();

      expect(
        lore.canAccessConnection(
          wyarConnection!,
          state.flags,
          'rest',
          [],
          [],
          { year: 1498, month: 6, day: 19, hour: 5, minute: 30, totalMinutes: 0 },
          state.getState().player.inventory,
        ),
      ).toBe(true);

      expect(
        lore.canAccessConnection(
          wyarConnection!,
          state.flags,
          'work',
          [],
          [],
          { year: 1498, month: 6, day: 19, hour: 6, minute: 0, totalMinutes: 0 },
          state.getState().player.inventory,
        ),
      ).toBe(false);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
