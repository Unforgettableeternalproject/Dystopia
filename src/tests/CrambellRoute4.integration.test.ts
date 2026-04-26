// CrambellRoute4.integration.test.ts
//
// Integration test for Route 4 (Kane/Ditch path).
// Flow:
//   1. crambell_kach_test1_start event fires; player accepts kach briefing encounter (grants quest).
//   1.5. crambell_survey event fires (guaranteed when kach_test1 active); player covers for Kach → cover_for_kach stage complete.
//   2. crambell_kane_offer event triggers and starts the offer encounter.
//   3. Player navigates through the encounter and confirms betrayal.
//   4. Assert: kach_test1 ditched, reputations changed, kane_double_agent granted.
//   5. Move to delth_forest_clearing at rest time.
//   6. crambell_kane_forest_handoff event triggers and starts the handoff encounter.
//   7. Player proceeds and receives transit_pass:wyar.
//   8. Assert inventory contains the transit pass.

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
      id: 'route4-player',
      name: 'Route4 Tester',
      origin: 'worker',
      currentLocationId: 'delth_patrol_zone',
      primaryStats:       { strength: 5, knowledge: 6, talent: 5, spirit: 5, luck: 8 },
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
  };
}

function loadRoute4Lore() {
  const lore = new LoreVault();
  const schedule = readJson<RegionSchedule>('lore/world/regions/crambell/schedule.json');
  const region: RegionIndex = {
    id: 'crambell',
    name: 'Crambell',
    theme: 'route4-test',
    locationIds: [
      'delth_patrol_zone',
      'delth_forest',
      'delth_transit_hub',
    ],
    npcIds: [],
    questIds: ['crambell_kach_test1', 'crambell_kane_double_agent'],
    factionIds: [],
    globalEventIds: [],
  };

  lore.load({
    locations: {
      delth_patrol_zone:    readJson<LocationNode>('lore/world/regions/crambell/locations/delth_patrol_zone.json'),
      delth_forest:         readJson<LocationNode>('lore/world/regions/crambell/locations/delth_forest.json'),
      delth_transit_hub:    readJson<LocationNode>('lore/world/regions/crambell/locations/delth_transit_hub.json'),
    },
    regions:   { crambell: region },
    schedules: { crambell: schedule },
    events: {
      crambell_kach_test1_start:    readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kach_test1_start.json'),
      crambell_survey:              readJson<GameEvent>('lore/world/regions/crambell/events/crambell_survey.json'),
      crambell_kane_offer:          readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kane_offer.json'),
      crambell_kane_forest_handoff: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kane_forest_handoff.json'),
    },
    quests: {
      crambell_kach_test1:         readJson<QuestDefinition>('lore/world/regions/crambell/quests/crambell_kach_test1.json'),
      crambell_kane_double_agent:  readJson<QuestDefinition>('lore/world/regions/crambell/quests/crambell_kane_double_agent.json'),
    },
    encounters: {
      crambell_enc_kach_briefing:       readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kach_briefing.json'),
      crambell_enc_survey:              readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_survey.json'),
      crambell_enc_kane_offer:          readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kane_offer.json'),
      crambell_enc_kane_forest_handoff: readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kane_forest_handoff.json'),
    },
  });

  return { lore, schedule };
}

/** Navigate a single encounter choice and flush + apply pending effects. */
function resolveChoice(
  encounters: EncounterEngine,
  quests: QuestEngine,
  choiceId: string,
) {
  const resolved = encounters.selectChoice(choiceId);
  expect(resolved).not.toBeNull();

  const pending = encounters.flushPendingEffects();
  // Ditch must run before grant: if ditch fails the dependent grant is suppressed.
  // This mirrors GameController.selectEncounterChoice logic.
  let questGrantAllowed = true;
  if (pending.questDitch) {
    questGrantAllowed = quests.ditchQuest(pending.questDitch);
  }
  if (questGrantAllowed && pending.questGrant) quests.grantQuest(pending.questGrant);
  if (pending.questFail)  quests.applyQuestFail(pending.questFail);
  if (pending.outcomeType !== undefined) encounters.conclude(pending.outcomeType);

  return { resolved: resolved!, pending };
}

describe('Crambell route4 integration — Kane/Ditch path', () => {
  it('player betrays kach_test1 and receives transit_pass:wyar via Kane', () => {
    const { lore, schedule } = loadRoute4Lore();
    const bus      = new EventBus();
    const state    = new StateManager(makeState(), bus);
    const time     = new TimeManager();
    const events   = new EventEngine(lore, state, time, schedule);
    const quests   = new QuestEngine(lore, state);
    const encounters = new EncounterEngine(lore, state);

    // Guarantee luck check always passes
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

    try {
      // ── Step 1: Kach briefing event fires at patrol zone, player accepts ────────
      const briefEvents = events.checkAndApply('delth_patrol_zone');
      const briefTrigger = briefEvents.find(t => t.event.id === 'crambell_kach_test1_start');
      expect(briefTrigger).toBeDefined();
      expect(briefTrigger!.startEncounterId).toBe('crambell_enc_kach_briefing');

      const briefStart = encounters.start('crambell_enc_kach_briefing');
      expect(briefStart?.kind).toBe('node');
      if (briefStart?.kind !== 'node') return;
      expect(briefStart.resolved.node.id).toBe('kach_approach');

      // accept → kach_grateful (grants crambell_kach_test1, sets invited+started flags)
      resolveChoice(encounters, quests, 'accept');
      expect(state.getState().activeQuests['crambell_kach_test1']).toBeDefined();
      expect(state.getState().activeQuests['crambell_kach_test1']?.currentStageId).toBe('cover_for_kach');

      // ── Step 1.5: Survey fires (kach_test1 active, cover not yet given) ────────
      const surveyEvents = events.checkAndApply('delth_patrol_zone');
      const surveyTrigger = surveyEvents.find(t => t.event.id === 'crambell_survey');
      expect(surveyTrigger).toBeDefined();
      expect(surveyTrigger!.startEncounterId).toBe('crambell_enc_survey');

      const surveyStart = encounters.start('crambell_enc_survey');
      expect(surveyStart?.kind).toBe('node');
      if (surveyStart?.kind !== 'node') return;
      expect(surveyStart.resolved.node.id).toBe('inspector_arrives');

      // Inspector asks about Kach → player covers for him
      resolveChoice(encounters, quests, 'answer_straight_kach_absent'); // → kach_question
      resolveChoice(encounters, quests, 'cover_inside');                // → kach_covered (sets crambell_kach_cover_held)

      // cover_for_kach objective complete → advance to report_back, set treffen_lead_known
      quests.checkObjectives();
      expect(state.getState().activeQuests['crambell_kach_test1']?.currentStageId).toBe('report_back');
      expect(state.flags.has('crambell_kach_test1_completed')).toBe(true);
      expect(state.flags.has('crambell_treffen_lead_known')).toBe(true);

      // ── Step 2: kane_offer event fires at delth_patrol_zone (work period) ─────
      state.getState().player.currentLocationId = 'delth_patrol_zone';
      const offerEvents = events.checkAndApply('delth_patrol_zone');
      const offerTrigger = offerEvents.find(t => t.event.id === 'crambell_kane_offer');
      expect(offerTrigger).toBeDefined();
      expect(offerTrigger!.startEncounterId).toBe('crambell_enc_kane_offer');

      // ── Step 3: Start offer encounter and navigate to betrayal ────────────────
      const offerStart = encounters.start('crambell_enc_kane_offer');
      expect(offerStart?.kind).toBe('node');
      if (offerStart?.kind !== 'node') return;
      expect(offerStart.resolved.node.id).toBe('kane_approach');

      // follow_kane → kane_proposition
      resolveChoice(encounters, quests, 'follow_kane');
      // ask_more → kane_clarify
      resolveChoice(encounters, quests, 'ask_more');
      // consider_betrayal → betrayal_warning
      resolveChoice(encounters, quests, 'consider_betrayal');
      // confirm_betrayal → betrayal_committed (effects applied here)
      const { pending: offerPending } = resolveChoice(encounters, quests, 'confirm_betrayal');
      expect(offerPending.outcomeType).toBe('success');

      // ── Step 4: Assert betrayal consequences ──────────────────────────────────
      // kach_test1 should be ditched (removed from activeQuests)
      expect(state.getState().activeQuests['crambell_kach_test1']).toBeUndefined();
      // beneficiaryFactionId is set, so enters completedQuestIds
      expect(state.getState().completedQuestIds).toContain('crambell_kach_test1');
      // betrayal flags set
      expect(state.flags.has('crambell_kach_betrayed')).toBe(true);
      expect(state.flags.has('crambell_treffen_betrayed_early')).toBe(true);
      // treffen rep: -30 from ditchConsequences
      expect(state.getState().player.externalStats.reputation['crambell_treffen']).toBe(-30);
      // government rep: +15 from report_back.onDitch + +20 from ditchConsequences = 35
      expect(state.getState().player.externalStats.reputation['crambell_government']).toBe(35);
      // deal flag set
      expect(state.flags.has('crambell_kane_deal_started')).toBe(true);
      // kane_double_agent quest granted
      expect(state.getState().activeQuests['crambell_kane_double_agent']).toBeDefined();
      expect(state.getState().activeQuests['crambell_kane_double_agent']?.currentStageId).toBe('meet_for_handoff');

      // ── Step 5: Move to forest clearing at rest time ──────────────────────────
      state.advanceTime(
        { year: 1498, month: 6, day: 12, hour: 22, minute: 0, totalMinutes: 720 },
        'rest',
      );
      state.getState().player.currentLocationId = 'delth_forest_clearing';

      const handoffEvents = events.checkAndApply('delth_forest_clearing');
      const handoffTrigger = handoffEvents.find(t => t.event.id === 'crambell_kane_forest_handoff');
      expect(handoffTrigger).toBeDefined();
      expect(handoffTrigger!.startEncounterId).toBe('crambell_enc_kane_forest_handoff');

      // ── Step 6: Start handoff encounter ──────────────────────────────────────
      const handoffStart = encounters.start('crambell_enc_kane_forest_handoff');
      expect(handoffStart?.kind).toBe('node');
      if (handoffStart?.kind !== 'node') return;
      expect(handoffStart.resolved.node.id).toBe('kane_waiting');

      // proceed → statCheck auto-resolves (luck=8, mock roll=0.99 passes DC10)
      const { pending: handoffPending } = resolveChoice(encounters, quests, 'proceed');

      // ── Step 7: Assert transit pass received ─────────────────────────────────
      expect(handoffPending.outcomeType).toBe('success');
      const inv = state.getState().player.inventory;
      const pass = inv.find(i => i.itemId === 'transit_pass' && i.variantId === 'wyar');
      expect(pass).toBeDefined();
      expect(state.flags.has('crambell_kane_pass_received')).toBe(true);
      expect(state.flags.has('crambell_player_allied_government')).toBe(true);

      // ── Step 8: Quest objective complete (pass received) ─────────────────────
      quests.checkObjectives();
      expect(state.getState().activeQuests['crambell_kane_double_agent']?.isCompleted).toBe(true);

      // ── Step 9: Transit hub access at correct time ────────────────────────────
      // delth_transit_hub gate requires timeRange 04:00-05:59 + transit_pass item
      state.advanceTime(
        { year: 1498, month: 6, day: 13, hour: 4, minute: 30, totalMinutes: 870 },
        'rest',
      );
      state.getState().player.currentLocationId = 'delth_patrol_zone';
      // Verify the pass is in inventory (gate check is via location connection access)
      expect(state.getState().player.inventory.some(
        i => i.itemId === 'transit_pass' && i.variantId === 'wyar' && !i.isExpired
      )).toBe(true);

    } finally {
      randomSpy.mockRestore();
    }
  });
});
