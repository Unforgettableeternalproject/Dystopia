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
      primaryStats:       { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
      primaryStatsExp:    { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      inclinationTracker: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      dailyGrantTracker:  { dateKey: '1498-6-12', grantedExp: {} },
      secondaryStats: { consciousness: 2, mysticism: 0, technology: 3 },
      statusStats: {
        stamina: 10, staminaMax: 10,
        stress:  0,  stressMax: 10,
        endo:    0,  endoMax: 0,
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
    time: { year: 1498, month: 6, day: 12, hour: 17, minute: 50, totalMinutes: 0 },
    timePeriod: 'work',
    eventCooldowns: {},
    eventCounters: {},
    attemptCooldowns: {},
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

  describe('triggerVariants', () => {
    it('first-match: fires the first matching variant, not the second', () => {
      const event: GameEvent = {
        id: 'multi_variant_event',
        description: 'Multi-variant event',
        condition: {},
        triggerVariants: [
          {
            condition: { flags: ['special_flag'] },
            notification: true,
            notificationVariant: 'danger',
          },
          {
            condition: {},
            notification: false,
          },
        ],
        outcomes: [{ id: 'out', description: 'Fired', flagsSet: ['variant_fired'] }],
        isRepeatable: true,
      };

      // With special_flag: first variant matches → danger notification
      const withFlag = makeHarness({ locationEventIds: ['multi_variant_event'], events: [event] });
      withFlag.mgr.flags.set('special_flag');
      const t1 = withFlag.engine.checkAndApply('loc_a');
      expect(t1).toHaveLength(1);
      expect(t1[0].notification).toBe(true);
      expect(t1[0].notificationVariant).toBe('danger');

      // Without special_flag: second variant matches → notification false
      const withoutFlag = makeHarness({ locationEventIds: ['multi_variant_event'], events: [event] });
      const t2 = withoutFlag.engine.checkAndApply('loc_a');
      expect(t2).toHaveLength(1);
      expect(t2[0].notification).toBe(false);
      expect(t2[0].notificationVariant).toBeUndefined();
    });

    it('does not fire when no variant condition matches', () => {
      const event: GameEvent = {
        id: 'gated_variant_event',
        description: 'Gated by variant',
        condition: {},
        triggerVariants: [
          { condition: { flags: ['missing_flag'] } },
        ],
        outcomes: [{ id: 'out', description: 'Fired', flagsSet: ['should_not_fire'] }],
        isRepeatable: true,
      };

      const { engine, mgr } = makeHarness({ locationEventIds: ['gated_variant_event'], events: [event] });
      expect(engine.checkAndApply('loc_a')).toHaveLength(0);
      expect(mgr.flags.has('should_not_fire')).toBe(false);
    });

    it('variant-specific chance controls firing', () => {
      const event: GameEvent = {
        id: 'chance_variant_event',
        description: 'Chance via variant',
        condition: {},
        triggerVariants: [
          { condition: { triggerChance: 0.5 } },
        ],
        outcomes: [{ id: 'out', description: 'Fired', flagsSet: ['chance_fired'] }],
        isRepeatable: true,
      };

      const spy = vi.spyOn(Math, 'random');
      try {
        // random < chance → fires
        spy.mockReturnValue(0.3);
        const hit = makeHarness({ locationEventIds: ['chance_variant_event'], events: [event] });
        expect(hit.engine.checkAndApply('loc_a')).toHaveLength(1);
        expect(hit.mgr.flags.has('chance_fired')).toBe(true);

        // random > chance → does not fire
        spy.mockReturnValue(0.7);
        const miss = makeHarness({ locationEventIds: ['chance_variant_event'], events: [event] });
        expect(miss.engine.checkAndApply('loc_a')).toHaveLength(0);
        expect(miss.mgr.flags.has('chance_fired')).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it('variant-specific cooldown blocks re-trigger within the window', () => {
      const event: GameEvent = {
        id: 'cooldown_variant_event',
        description: 'Cooldown via variant',
        condition: {},
        triggerVariants: [
          { condition: { cooldownMinutes: 60 } },
        ],
        outcomes: [{ id: 'out', description: 'Fired', flagsSet: ['cooldown_fired'] }],
        isRepeatable: true,
      };

      const { engine, mgr } = makeHarness({ locationEventIds: ['cooldown_variant_event'], events: [event] });

      // First trigger succeeds
      expect(engine.checkAndApply('loc_a')).toHaveLength(1);
      expect(mgr.flags.has('cooldown_fired')).toBe(true);

      // Second trigger at same time is blocked by cooldown
      mgr.flags.unset('cooldown_fired');
      expect(engine.checkAndApply('loc_a')).toHaveLength(0);
      expect(mgr.flags.has('cooldown_fired')).toBe(false);

      // Advance time past cooldown → fires again (event was recorded at minute 0)
      (mgr.getState() as GameState).time.totalMinutes = 61;
      const t3 = engine.checkAndApply('loc_a');
      expect(t3).toHaveLength(1);
    });

    it('top-level shared gate still blocks when variant condition matches', () => {
      const event: GameEvent = {
        id: 'gated_shared_event',
        description: 'Shared gate blocks variant',
        condition: { notFlags: ['global_block'] },
        triggerVariants: [
          { condition: {} },
        ],
        outcomes: [{ id: 'out', description: 'Fired', flagsSet: ['shared_gate_fired'] }],
        isRepeatable: true,
      };

      // global_block is set → top-level notFlags gate fails, variant never evaluated
      const { engine, mgr } = makeHarness({ locationEventIds: ['gated_shared_event'], events: [event] });
      mgr.flags.set('global_block');
      expect(engine.checkAndApply('loc_a')).toHaveLength(0);
      expect(mgr.flags.has('shared_gate_fired')).toBe(false);

      // Without the blocking flag → variant fires
      mgr.flags.unset('global_block');
      expect(engine.checkAndApply('loc_a')).toHaveLength(1);
    });

    it('variant without cooldownMinutes does not record cooldown (can re-fire immediately)', () => {
      const event: GameEvent = {
        id: 'no_cooldown_variant_event',
        description: 'No cooldown variant',
        condition: {},
        triggerVariants: [
          { condition: { flags: ['active_flag'] } },
        ],
        outcomes: [{ id: 'out', description: 'Fired', flagsSet: ['no_cooldown_fired'] }],
        isRepeatable: true,
      };

      const { engine, mgr } = makeHarness({ locationEventIds: ['no_cooldown_variant_event'], events: [event] });
      mgr.flags.set('active_flag');

      expect(engine.checkAndApply('loc_a')).toHaveLength(1);
      // No cooldown set → fires again immediately
      expect(engine.checkAndApply('loc_a')).toHaveLength(1);
    });
  });

  it('supports single-event probability curves driven by event counters', () => {
    const transferEvent: GameEvent = {
      id: 'transfer_event',
      description: 'Transfer chance',
      condition: {
        flags: ['quota_met_today'],
        notFlags: ['transfer_checked'],
      },
      outcomes: [
        {
          id: 'miss',
          description: 'No chance today',
          flagsSet: ['transfer_checked'],
          weightByEventCounter: {
            counterId: 'transfer_progress',
            valueWeights: { '0': 3, '1': 2, '2': 1, '3': 0 },
            fallback: 'nearest_lower',
          },
          eventCounterChanges: { transfer_progress: 1 },
        },
        {
          id: 'hit',
          description: 'Chance appears',
          flagsSet: ['transfer_checked'],
          weightByEventCounter: {
            counterId: 'transfer_progress',
            valueWeights: { '0': 1, '1': 2, '2': 3, '3': 1 },
            fallback: 'nearest_lower',
          },
          eventCounterReset: ['transfer_progress'],
          startEncounterId: 'enc_transfer',
        },
      ],
      isRepeatable: true,
    };

    const { engine, mgr } = makeHarness({
      locationEventIds: ['transfer_event'],
      events: [transferEvent],
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
