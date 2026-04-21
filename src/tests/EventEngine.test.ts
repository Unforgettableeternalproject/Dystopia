import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../lib/engine/EventBus';
import { EventEngine } from '../lib/engine/EventEngine';
import { StateManager } from '../lib/engine/StateManager';
import { TimeManager } from '../lib/engine/TimeManager';
import { LoreVault } from '../lib/lore/LoreVault';
import type { GameState, LocationNode, GameEvent, RegionIndex } from '../lib/types';
import type { QuestInstance } from '../lib/types/quest';

function makeState(): GameState {
  return {
    player: {
      id: 'player-1',
      name: 'Tester',
      origin: 'worker',
      currentLocationId: 'loc_a',
      primaryStats:   { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
      secondaryStats: { consciousness: 2, mysticism: 0, technology: 3 },
      statusStats: {
        stamina: 10, staminaMax: 10,
        stress:  0,  stressMax: 10,
        endo:    0,  endoMax: 0,
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

function makeLocation(eventIds: string[] = []): LocationNode {
  return {
    id: 'loc_a',
    name: 'Location A',
    regionId: 'region_a',
    tags: [],
    base: {
      description: 'Test location',
      ambience: [],
      connections: [],
      npcIds: [],
      eventIds,
      isAccessible: true,
    },
    localVariants: [],
  };
}

function makeRegion(globalEventIds: string[] = []): RegionIndex {
  return {
    id: 'region_a',
    name: 'Region A',
    theme: 'test',
    locationIds: ['loc_a'],
    npcIds: [],
    questIds: [],
    factionIds: [],
    globalEventIds,
  };
}

function makeQuestInstance(stageId = 'stage_a'): QuestInstance {
  return {
    questId: 'quest_a',
    source: 'event',
    currentStageId: stageId,
    completedObjectiveIds: [],
    localFlags: [],
    isCompleted: false,
    isFailed: false,
    isDitched: false,
    acceptedAtMinutes: 0,
  };
}

function makeHarness(config: {
  locationEventIds?: string[];
  globalEventIds?: string[];
  events?: GameEvent[];
  activeQuests?: Record<string, QuestInstance>;
}) {
  const lore = new LoreVault();
  lore.load({
    locations: { loc_a: makeLocation(config.locationEventIds ?? []) },
    regions: { region_a: makeRegion(config.globalEventIds ?? []) },
    events: Object.fromEntries((config.events ?? []).map(event => [event.id, event])),
  });

  const state = makeState();
  state.activeQuests = config.activeQuests ?? {};
  const mgr = new StateManager(state, new EventBus());
  const engine = new EventEngine(lore, mgr, new TimeManager());

  return { engine, mgr };
}

describe('EventEngine', () => {
  it('triggers location-bound events mounted on the current node', () => {
    const locationEvent: GameEvent = {
      id: 'location_event',
      description: 'Location event',
      condition: {},
      outcomes: [{ id: 'outcome_a', description: 'Applied', flagsSet: ['location_event_fired'] }],
      isRepeatable: false,
    };

    const { engine, mgr } = makeHarness({
      locationEventIds: ['location_event'],
      events: [locationEvent],
    });

    const triggered = engine.checkAndApply('loc_a');

    expect(triggered).toHaveLength(1);
    expect(triggered[0].event.id).toBe('location_event');
    expect(mgr.flags.has('location_event_fired')).toBe(true);
  });

  it('triggers hour-bound global events only when the matching boundary is crossed', () => {
    const timedEvent: GameEvent = {
      id: 'timed_event',
      description: 'Timed event',
      condition: { triggerHours: [18] },
      outcomes: [{ id: 'outcome_a', description: 'Applied', flagsSet: ['timed_event_fired'] }],
      isRepeatable: true,
    };

    const { engine, mgr } = makeHarness({
      globalEventIds: ['timed_event'],
      events: [timedEvent],
    });

    expect(engine.checkGlobalEvents('region_a', [17])).toHaveLength(0);
    expect(mgr.flags.has('timed_event_fired')).toBe(false);

    const triggered = engine.checkGlobalEvents('region_a', [18]);

    expect(triggered).toHaveLength(1);
    expect(triggered[0].event.id).toBe('timed_event');
    expect(mgr.flags.has('timed_event_fired')).toBe(true);
  });

  it('respects quest-active and quest-stage conditions', () => {
    const questEvent: GameEvent = {
      id: 'quest_event',
      description: 'Quest gated event',
      condition: { questActiveId: 'quest_a', questStageId: 'stage_a' },
      outcomes: [{ id: 'outcome_a', description: 'Applied', flagsSet: ['quest_event_fired'] }],
      isRepeatable: true,
    };

    const missingQuest = makeHarness({
      locationEventIds: ['quest_event'],
      events: [questEvent],
    });
    expect(missingQuest.engine.checkAndApply('loc_a')).toHaveLength(0);

    const wrongStage = makeHarness({
      locationEventIds: ['quest_event'],
      events: [questEvent],
      activeQuests: { quest_a: makeQuestInstance('stage_b') },
    });
    expect(wrongStage.engine.checkAndApply('loc_a')).toHaveLength(0);

    const matchingStage = makeHarness({
      locationEventIds: ['quest_event'],
      events: [questEvent],
      activeQuests: { quest_a: makeQuestInstance('stage_a') },
    });
    const triggered = matchingStage.engine.checkAndApply('loc_a');

    expect(triggered).toHaveLength(1);
    expect(matchingStage.mgr.flags.has('quest_event_fired')).toBe(true);
  });

  it('supports event counter conditions and mutations', () => {
    const counterEvent: GameEvent = {
      id: 'counter_event',
      description: 'Counter gated event',
      condition: {
        minEventCounters: { transfer_progress: 2 },
        maxEventCounters: { transfer_progress: 3 },
      },
      outcomes: [{
        id: 'outcome_a',
        description: 'Applied',
        eventCounterChanges: { transfer_progress: 1 },
        eventCounterSet: { transfer_seen: 1 },
      }],
      isRepeatable: true,
    };

    const tooLow = makeHarness({
      locationEventIds: ['counter_event'],
      events: [counterEvent],
    });
    tooLow.mgr.setEventCounter('transfer_progress', 1);
    expect(tooLow.engine.checkAndApply('loc_a')).toHaveLength(0);

    const inRange = makeHarness({
      locationEventIds: ['counter_event'],
      events: [counterEvent],
    });
    inRange.mgr.setEventCounter('transfer_progress', 2);
    expect(inRange.engine.checkAndApply('loc_a')).toHaveLength(1);
    expect(inRange.mgr.getEventCounter('transfer_progress')).toBe(3);
    expect(inRange.mgr.getEventCounter('transfer_seen')).toBe(1);

    const exactResetEvent: GameEvent = {
      id: 'exact_reset_event',
      description: 'Exact counter event',
      condition: { exactEventCounters: { transfer_progress: 3 } },
      outcomes: [{
        id: 'outcome_b',
        description: 'Reset',
        eventCounterReset: ['transfer_progress'],
      }],
      isRepeatable: true,
    };

    const exactHarness = makeHarness({
      locationEventIds: ['exact_reset_event'],
      events: [exactResetEvent],
    });
    exactHarness.mgr.setEventCounter('transfer_progress', 3);
    expect(exactHarness.engine.checkAndApply('loc_a')).toHaveLength(1);
    expect(exactHarness.mgr.getEventCounter('transfer_progress')).toBe(0);
  });

  it('supports tiered probability events driven by event counters', () => {
    const tier1: GameEvent = {
      id: 'transfer_tier1',
      description: 'Tier 1 transfer chance',
      condition: {
        flags: ['quota_met_today'],
        notFlags: ['transfer_checked'],
        exactEventCounters: { transfer_progress: 0 },
      },
      outcomes: [
        {
          id: 'tier1_miss',
          description: 'No chance today',
          weight: 3,
          flagsSet: ['transfer_checked'],
          eventCounterChanges: { transfer_progress: 1 },
        },
        {
          id: 'tier1_hit',
          description: 'Chance appears',
          weight: 1,
          flagsSet: ['transfer_checked'],
          eventCounterReset: ['transfer_progress'],
          startEncounterId: 'enc_transfer',
        },
      ],
      isRepeatable: true,
    };

    const tier2: GameEvent = {
      id: 'transfer_tier2',
      description: 'Tier 2 transfer chance',
      condition: {
        flags: ['quota_met_today'],
        notFlags: ['transfer_checked'],
        exactEventCounters: { transfer_progress: 1 },
      },
      outcomes: [
        {
          id: 'tier2_miss',
          description: 'Still no chance',
          weight: 2,
          flagsSet: ['transfer_checked'],
          eventCounterChanges: { transfer_progress: 1 },
        },
        {
          id: 'tier2_hit',
          description: 'Chance appears',
          weight: 2,
          flagsSet: ['transfer_checked'],
          eventCounterReset: ['transfer_progress'],
          startEncounterId: 'enc_transfer',
        },
      ],
      isRepeatable: true,
    };

    const tier3: GameEvent = {
      id: 'transfer_tier3',
      description: 'Tier 3 transfer chance',
      condition: {
        flags: ['quota_met_today'],
        notFlags: ['transfer_checked'],
        exactEventCounters: { transfer_progress: 2 },
      },
      outcomes: [
        {
          id: 'tier3_miss',
          description: 'Almost there',
          weight: 1,
          flagsSet: ['transfer_checked'],
          eventCounterChanges: { transfer_progress: 1 },
        },
        {
          id: 'tier3_hit',
          description: 'Chance appears',
          weight: 3,
          flagsSet: ['transfer_checked'],
          eventCounterReset: ['transfer_progress'],
          startEncounterId: 'enc_transfer',
        },
      ],
      isRepeatable: true,
    };

    const tier4: GameEvent = {
      id: 'transfer_tier4',
      description: 'Guaranteed transfer chance',
      condition: {
        flags: ['quota_met_today'],
        notFlags: ['transfer_checked'],
        minEventCounters: { transfer_progress: 3 },
      },
      outcomes: [{
        id: 'tier4_hit',
        description: 'Guaranteed chance',
        flagsSet: ['transfer_checked'],
        eventCounterReset: ['transfer_progress'],
        startEncounterId: 'enc_transfer',
      }],
      isRepeatable: true,
    };

    const { engine, mgr } = makeHarness({
      locationEventIds: ['transfer_tier1', 'transfer_tier2', 'transfer_tier3', 'transfer_tier4'],
      events: [tier1, tier2, tier3, tier4],
    });
    mgr.flags.set('quota_met_today');

    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValue(0);
      expect(engine.checkAndApply('loc_a')).toHaveLength(1);
      expect(mgr.getEventCounter('transfer_progress')).toBe(1);
      expect(mgr.flags.has('transfer_checked')).toBe(true);

      mgr.flags.unset('transfer_checked');
      expect(engine.checkAndApply('loc_a')).toHaveLength(1);
      expect(mgr.getEventCounter('transfer_progress')).toBe(2);

      mgr.flags.unset('transfer_checked');
      expect(engine.checkAndApply('loc_a')).toHaveLength(1);
      expect(mgr.getEventCounter('transfer_progress')).toBe(3);

      mgr.flags.unset('transfer_checked');
      const guaranteed = engine.checkAndApply('loc_a');
      expect(guaranteed).toHaveLength(1);
      expect(guaranteed[0].startEncounterId).toBe('enc_transfer');
      expect(mgr.getEventCounter('transfer_progress')).toBe(0);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
