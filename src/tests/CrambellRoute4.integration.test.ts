// CrambellRoute4.integration.test.ts
//
// Integration test for Route 4 (Kane/Government path).
// Flow:
//   1a. crambell_kach first_meeting dialogue fires; player agrees to hang out (kach_hangout_accepted + crambell_kach_met).
//   1b. Day boundary crossed at 06:00 → crambell_kach_second_meeting_unlock fires → crambell_kach_second_meeting_ready.
//   1c. crambell_kach second_meeting dialogue fires; player routed to kach_invite_forest (has kach_hangout_accepted).
//       → crambell_kach_test1_briefed set.
//   1d. Move to delth_forest_clearing at rest → crambell_kach_forest_walk event triggers.
//       → Player accepts → crambell_kach_test1 granted, started.
//   1.5. crambell_kane first_meeting dialogue fires; cooperative → kane_pass_check.
//       → crambell_kane_met set, affinity +1.
//   2.  crambell_survey event fires (kach_test1 active); player covers for Kach.
//       → cover_for_kach objective complete, treffen_lead_known + kane_intel_ready set.
//   3.  crambell_kane_offer event triggers (met + affinity + kane_intel_ready).
//   4.  Encounter: Kane makes initial approach. Player considers → crambell_kane_approached + double_agent quest (pending_intel stage).
//   4.5 Dialogue: kane_intel_offer node fires. Player selects give_kach → kane_deliver_kach → confirm.
//       → crambell_kane_intel_delivered + crambell_kach_betrayed_kane set.
//       → Quest advances: pending_intel → meet_for_handoff.
//   5.  Assert: intel flags set, quest at correct stage.
//   6.  Move to delth_forest_clearing at rest time.
//   7.  crambell_kane_forest_handoff event triggers (needs crambell_kane_intel_delivered) → starts handoff encounter.
//   8.  Player proceeds → receives transit_pass:wyar.
//   9.  Assert inventory contains the transit pass.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../lib/engine/EventBus';
import { EncounterEngine } from '../lib/engine/EncounterEngine';
import { EventEngine } from '../lib/engine/EventEngine';
import { QuestEngine } from '../lib/engine/QuestEngine';
import { StateManager } from '../lib/engine/StateManager';
import { TimeManager } from '../lib/engine/TimeManager';
import { DialogueManager } from '../lib/engine/DialogueManager';
import { LoreVault } from '../lib/lore/LoreVault';
import type { EncounterDefinition } from '../lib/types/encounter';
import type { GameState } from '../lib/types/game';
import type { GameEvent, LocationNode, RegionIndex, RegionSchedule } from '../lib/types/world';
import type { QuestDefinition } from '../lib/types/quest';
import type { DialogueProfile } from '../lib/types/dialogue';

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
    attemptCooldowns: {},
    propFlags: {},
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
      'delth_mining_shafts',
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
      delth_mining_shafts:  readJson<LocationNode>('lore/world/regions/crambell/locations/delth_mining_shafts.json'),
    },
    regions:   { crambell: region },
    schedules: { crambell: schedule },
    events: {
      crambell_kach_second_meeting_unlock: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kach_second_meeting_unlock.json'),
      crambell_kach_forest_walk:           readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kach_forest_walk.json'),
      crambell_survey:                     readJson<GameEvent>('lore/world/regions/crambell/events/crambell_survey.json'),
      crambell_kane_offer:                 readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kane_offer.json'),
      crambell_kane_forest_handoff:        readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kane_forest_handoff.json'),
    },
    quests: {
      crambell_kach_test1:         readJson<QuestDefinition>('lore/world/regions/crambell/quests/crambell_kach_test1.json'),
      crambell_kane_double_agent:  readJson<QuestDefinition>('lore/world/regions/crambell/quests/crambell_kane_double_agent.json'),
    },
    encounters: {
      crambell_enc_kach_forest_walk:    readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kach_forest_walk.json'),
      crambell_enc_survey:              readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_survey.json'),
      crambell_enc_kane_offer:          readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kane_offer.json'),
      crambell_enc_kane_forest_handoff: readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kane_forest_handoff.json'),
    },
    dialogues: {
      crambell_kach_default: readJson<DialogueProfile>('lore/world/regions/crambell/dialogues/crambell_kach_default.json'),
      crambell_kane_default: readJson<DialogueProfile>('lore/world/regions/crambell/dialogues/crambell_kane_default.json'),
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
  quests.checkObjectives();

  return { resolved: resolved!, pending };
}

describe('Crambell route4 integration — Kane/Government path', () => {
  it('player delivers Kach intel to Kane and receives transit_pass:wyar', () => {
    const { lore, schedule } = loadRoute4Lore();
    const bus        = new EventBus();
    const state      = new StateManager(makeState(), bus);
    const time       = new TimeManager();
    const events     = new EventEngine(lore, state, time, schedule);
    const quests     = new QuestEngine(lore, state);
    const encounters = new EncounterEngine(lore, state);
    const dialogueMgr = new DialogueManager(lore, state);

    // Guarantee luck check always passes
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

    try {
      // ── Step 1a: Kach first meeting dialogue (day 12, work) ───────────────────
      const kachFirst = dialogueMgr.checkScriptedTrigger(
        'crambell_kach', 'crambell_kach_default', state.flags, 0,
      );
      expect(kachFirst).not.toBeNull();
      expect(kachFirst!.nodeId).toBe('first_meeting');

      // friendly_agree → kach_intro_follow_up (affinity +1)
      const agreeChoice = dialogueMgr.filterChoices(kachFirst!.node.choices, state.flags)
        .find(c => c.id === 'friendly_agree')!;
      dialogueMgr.applyChoiceEffects('crambell_kach', agreeChoice.effects);

      // kach_intro_follow_up → accept (sets kach_hangout_accepted + crambell_kach_met)
      const followUpNode = dialogueMgr.getNode('crambell_kach', 'crambell_kach_default', 'kach_intro_follow_up')!;
      const acceptChoice = dialogueMgr.filterChoices(followUpNode.choices, state.flags)
        .find(c => c.id === 'accept')!;
      dialogueMgr.applyChoiceEffects('crambell_kach', acceptChoice.effects);

      expect(state.flags.has('crambell_kach_met')).toBe(true);
      expect(state.flags.has('kach_hangout_accepted')).toBe(true);

      // ── Step 1b: Advance to next day 06:00 → second_meeting_unlock fires ──────
      state.advanceTime(
        { year: 1498, month: 6, day: 13, hour: 6, minute: 0, totalMinutes: 1200 },
        'work',
      );

      // triggerHours: [6] — cross hour 6 when calling checkAndApply
      const unlockResults = events.checkAndApply('delth_patrol_zone', [6]);
      expect(unlockResults.some(t => t.event.id === 'crambell_kach_second_meeting_unlock')).toBe(true);
      expect(state.flags.has('crambell_kach_second_meeting_ready')).toBe(true);

      // ── Step 1c: Kach second meeting dialogue (interactionCount = 1) ──────────
      const kachSecond = dialogueMgr.checkScriptedTrigger(
        'crambell_kach', 'crambell_kach_default', state.flags, 1,
      );
      expect(kachSecond).not.toBeNull();
      expect(kachSecond!.nodeId).toBe('second_meeting');

      // Has kach_hangout_accepted → listen_forest is available, listen_mine is filtered out
      const filteredSecond = dialogueMgr.filterChoices(kachSecond!.node.choices, state.flags);
      expect(filteredSecond.find(c => c.id === 'listen_forest')).toBeDefined();
      expect(filteredSecond.find(c => c.id === 'listen_mine')).toBeUndefined();

      // Navigate to kach_invite_forest → agree (sets crambell_kach_test1_briefed)
      const forestInviteNode = dialogueMgr.getNode(
        'crambell_kach', 'crambell_kach_default', 'kach_invite_forest',
      )!;
      const inviteAgree = forestInviteNode.choices.find(c => c.id === 'agree')!;
      dialogueMgr.applyChoiceEffects('crambell_kach', inviteAgree.effects);
      expect(state.flags.has('crambell_kach_test1_briefed')).toBe(true);

      // ── Step 1d: Forest walk encounter (rest, delth_forest_clearing) ──────────
      state.advanceTime(
        { year: 1498, month: 6, day: 13, hour: 22, minute: 0, totalMinutes: 1440 },
        'rest',
      );
      state.getState().player.currentLocationId = 'delth_forest_clearing';

      const forestWalkResults = events.checkAndApply('delth_forest_clearing');
      const forestWalkTrigger = forestWalkResults.find(t => t.event.id === 'crambell_kach_forest_walk');
      expect(forestWalkTrigger).toBeDefined();
      expect(forestWalkTrigger!.startEncounterId).toBe('crambell_enc_kach_forest_walk');

      const forestWalkStart = encounters.start('crambell_enc_kach_forest_walk');
      expect(forestWalkStart?.kind).toBe('node');
      if (forestWalkStart?.kind !== 'node') return;
      expect(forestWalkStart.resolved.node.id).toBe('walk_start');

      resolveChoice(encounters, quests, 'accept_no_question');
      expect(state.getState().activeQuests['crambell_kach_test1']).toBeDefined();
      expect(state.getState().activeQuests['crambell_kach_test1']?.currentStageId).toBe('cover_for_kach');

      // ── Step 1.5: Kane first meeting dialogue (day 14, work, patrol zone) ─────
      state.advanceTime(
        { year: 1498, month: 6, day: 14, hour: 10, minute: 0, totalMinutes: 1680 },
        'work',
      );
      state.getState().player.currentLocationId = 'delth_patrol_zone';

      const kaneFirst = dialogueMgr.checkScriptedTrigger(
        'crambell_kane', 'crambell_kane_default', state.flags, 0,
      );
      expect(kaneFirst).not.toBeNull();
      expect(kaneFirst!.nodeId).toBe('first_meeting');

      // cooperative → kane_pass_check → end (affinity +1, crambell_kane_met)
      const kanePassNode = dialogueMgr.getNode(
        'crambell_kane', 'crambell_kane_default', 'kane_pass_check',
      )!;
      const kanePassEnd = kanePassNode.choices.find(c => c.id === 'end')!;
      dialogueMgr.applyChoiceEffects('crambell_kane', kanePassEnd.effects);

      expect(state.flags.has('crambell_kane_met')).toBe(true);
      expect(state.getState().player.externalStats.affinity['crambell_kane']).toBe(1);

      // ── Step 2: Survey fires (kach_test1 active); player covers for Kach ──────
      state.getState().player.currentLocationId = 'delth_mine_worksite';
      const surveyResults = events.checkAndApply('delth_mine_worksite');
      const surveyTrigger = surveyResults.find(t => t.event.id === 'crambell_survey');
      expect(surveyTrigger).toBeDefined();
      expect(surveyTrigger!.startEncounterId).toBe('crambell_enc_survey');

      const surveyStart = encounters.start('crambell_enc_survey');
      expect(surveyStart?.kind).toBe('node');
      if (surveyStart?.kind !== 'node') return;
      expect(surveyStart.resolved.node.id).toBe('inspector_arrives');

      resolveChoice(encounters, quests, 'answer_straight_kach_absent');
      resolveChoice(encounters, quests, 'cover_inside');

      quests.checkObjectives();
      expect(state.getState().activeQuests['crambell_kach_test1']?.currentStageId).toBe('report_back');
      expect(state.flags.has('crambell_kach_test1_completed')).toBe(true);
      expect(state.flags.has('crambell_treffen_lead_known')).toBe(true);
      // Unified bridge flag for Kane offer
      expect(state.flags.has('crambell_kane_intel_ready')).toBe(true);

      // ── Step 3: kane_offer event fires at delth_patrol_zone (work period) ─────
      state.getState().player.currentLocationId = 'delth_patrol_zone';
      const offerResults = events.checkAndApply('delth_patrol_zone');
      const offerTrigger = offerResults.find(t => t.event.id === 'crambell_kane_offer');
      expect(offerTrigger).toBeDefined();
      expect(offerTrigger!.startEncounterId).toBe('crambell_enc_kane_offer');

      // ── Step 4: Encounter — Kane makes initial approach; player considers ──────
      const offerStart = encounters.start('crambell_enc_kane_offer');
      expect(offerStart?.kind).toBe('node');
      if (offerStart?.kind !== 'node') return;
      expect(offerStart.resolved.node.id).toBe('kane_approach');

      // follow_kane → kane_proposition
      resolveChoice(encounters, quests, 'follow_kane');
      // consider → kane_agreed_end (sets crambell_kane_approached, grants double_agent quest)
      const { pending: offerPending } = resolveChoice(encounters, quests, 'consider');
      expect(offerPending.outcomeType).toBe('success');

      expect(state.flags.has('crambell_kane_approached')).toBe(true);
      expect(state.getState().activeQuests['crambell_kane_double_agent']).toBeDefined();
      expect(state.getState().activeQuests['crambell_kane_double_agent']?.currentStageId).toBe('pending_intel');
      // Kach quest still active — not ditched at this stage
      expect(state.getState().activeQuests['crambell_kach_test1']).toBeDefined();

      // ── Step 4.5: Deliver Kach intel via Kane's dialogue node ─────────────────
      const kaneIntelTrigger = dialogueMgr.checkScriptedTrigger(
        'crambell_kane', 'crambell_kane_default', state.flags, 1,
      );
      expect(kaneIntelTrigger).not.toBeNull();
      expect(kaneIntelTrigger!.nodeId).toBe('kane_intel_offer');

      // give_kach choice should be visible (crambell_treffen_lead_known is set)
      const filteredIntel = dialogueMgr.filterChoices(kaneIntelTrigger!.node.choices, state.flags);
      expect(filteredIntel.find(c => c.id === 'give_kach')).toBeDefined();

      // Navigate to kane_deliver_kach → confirm
      const deliverNode = dialogueMgr.getNode(
        'crambell_kane', 'crambell_kane_default', 'kane_deliver_kach',
      )!;
      const confirmChoice = deliverNode.choices.find(c => c.id === 'confirm')!;
      dialogueMgr.applyChoiceEffects('crambell_kane', confirmChoice.effects);

      expect(state.flags.has('crambell_kane_intel_delivered')).toBe(true);
      expect(state.flags.has('crambell_kach_betrayed_kane')).toBe(true);
      expect(state.getState().player.externalStats.affinity['crambell_kane']).toBe(3);

      // Quest flag sweep advances pending_intel → meet_for_handoff
      quests.checkObjectives();
      expect(state.getState().activeQuests['crambell_kane_double_agent']?.currentStageId).toBe('meet_for_handoff');

      // ── Step 6: Move to forest clearing at rest time ──────────────────────────
      state.advanceTime(
        { year: 1498, month: 6, day: 14, hour: 22, minute: 0, totalMinutes: 1920 },
        'rest',
      );
      state.getState().player.currentLocationId = 'delth_forest_clearing';

      const handoffResults = events.checkAndApply('delth_forest_clearing');
      const handoffTrigger = handoffResults.find(t => t.event.id === 'crambell_kane_forest_handoff');
      expect(handoffTrigger).toBeDefined();
      expect(handoffTrigger!.startEncounterId).toBe('crambell_enc_kane_forest_handoff');

      // ── Step 7: Start handoff encounter ──────────────────────────────────────
      const handoffStart = encounters.start('crambell_enc_kane_forest_handoff');
      expect(handoffStart?.kind).toBe('node');
      if (handoffStart?.kind !== 'node') return;
      expect(handoffStart.resolved.node.id).toBe('kane_waiting');

      // proceed → statCheck auto-resolves (luck=8, mock roll=0.99 passes DC10)
      const { pending: handoffPending } = resolveChoice(encounters, quests, 'proceed');

      // ── Step 8: Assert transit pass received ─────────────────────────────────
      expect(handoffPending.outcomeType).toBe('success');
      const inv = state.getState().player.inventory;
      const pass = inv.find(i => i.itemId === 'transit_pass' && i.variantId === 'wyar');
      expect(pass).toBeDefined();
      expect(state.flags.has('crambell_kane_pass_received')).toBe(true);
      expect(state.flags.has('crambell_player_allied_government')).toBe(true);

      // ── Step 9: Quest objective complete (pass received) ─────────────────────
      quests.checkObjectives();
      expect(state.getState().activeQuests['crambell_kane_double_agent']?.isCompleted).toBe(true);

      // ── Step 10: Transit hub access at correct time ───────────────────────────
      state.advanceTime(
        { year: 1498, month: 6, day: 15, hour: 4, minute: 30, totalMinutes: 2190 },
        'rest',
      );
      state.getState().player.currentLocationId = 'delth_patrol_zone';
      expect(state.getState().player.inventory.some(
        i => i.itemId === 'transit_pass' && i.variantId === 'wyar' && !i.isExpired
      )).toBe(true);

    } finally {
      randomSpy.mockRestore();
    }
  });
});
