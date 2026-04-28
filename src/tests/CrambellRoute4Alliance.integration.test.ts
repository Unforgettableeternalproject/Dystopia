// CrambellRoute4Alliance.integration.test.ts
//
// Integration test for Route 4 (Kane/Government path) — Alliance intel variant.
//
// Covers the path:
//   Mildore shackles arc → crambell_patrol_schedule_known + crambell_kane_intel_ready
//   → Kane first meeting → Kane offer event → encounter (consider)
//   → kane_intel_offer dialogue node → give_alliance → confirm
//   → crambell_peoples_alliance_betrayed + rep -20 + crambell_kane_intel_delivered
//   → quest pending_intel → meet_for_handoff
//   → forest handoff event can fire (crambell_kane_intel_delivered)
//
// The Mildore arc (dialogue tree, shackles quest, bread delivery encounter) is
// simulated by directly setting the resulting flags, keeping this test focused on
// the Kane side of the Alliance path. The Mildore arc itself is exercised through
// DialogueManager unit coverage.
//
// Note: dialogueMgr.applyChoiceEffects() + quests.checkObjectives() mirrors the
// production path GameController.selectDialogueChoice() → endScriptedDialogue()
// (which now calls checkObjectives after clearing the active dialogue store).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
      id: 'route4-alliance-player',
      name: 'Alliance Tester',
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
  };
}

function loadAllianceLore() {
  const lore = new LoreVault();
  const schedule = readJson<RegionSchedule>('lore/world/regions/crambell/schedule.json');
  const region: RegionIndex = {
    id: 'crambell',
    name: 'Crambell',
    theme: 'route4-alliance-test',
    locationIds: ['delth_patrol_zone', 'delth_forest'],
    npcIds: [],
    questIds: ['crambell_kane_double_agent'],
    factionIds: [],
    globalEventIds: [],
  };

  lore.load({
    locations: {
      delth_patrol_zone: readJson<LocationNode>('lore/world/regions/crambell/locations/delth_patrol_zone.json'),
      delth_forest:      readJson<LocationNode>('lore/world/regions/crambell/locations/delth_forest.json'),
    },
    regions:   { crambell: region },
    schedules: { crambell: schedule },
    events: {
      crambell_kane_offer:          readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kane_offer.json'),
      crambell_kane_forest_handoff: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kane_forest_handoff.json'),
    },
    quests: {
      crambell_kane_double_agent: readJson<QuestDefinition>('lore/world/regions/crambell/quests/crambell_kane_double_agent.json'),
    },
    encounters: {
      crambell_enc_kane_offer:          readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kane_offer.json'),
      crambell_enc_kane_forest_handoff: readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kane_forest_handoff.json'),
    },
    dialogues: {
      crambell_kane_default: readJson<DialogueProfile>('lore/world/regions/crambell/dialogues/crambell_kane_default.json'),
    },
  });

  return { lore, schedule };
}

function resolveChoice(
  encounters: EncounterEngine,
  quests: QuestEngine,
  choiceId: string,
) {
  const resolved = encounters.selectChoice(choiceId);
  expect(resolved).not.toBeNull();

  const pending = encounters.flushPendingEffects();
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

describe('Crambell route4 integration — Alliance intel path', () => {
  it('player delivers Alliance intel to Kane via dialogue, blocking Alliance route', () => {
    const { lore, schedule } = loadAllianceLore();
    const bus        = new EventBus();
    const state      = new StateManager(makeState(), bus);
    const time       = new TimeManager();
    const events     = new EventEngine(lore, state, time, schedule);
    const quests     = new QuestEngine(lore, state);
    const encounters = new EncounterEngine(lore, state);
    const dialogueMgr = new DialogueManager(lore, state);

    // ── Setup: Kane first meeting (cooperative path) ──────────────────────────
    const kaneFirst = dialogueMgr.checkScriptedTrigger(
      'crambell_kane', 'crambell_kane_default', state.flags, 0,
    );
    expect(kaneFirst).not.toBeNull();
    expect(kaneFirst!.nodeId).toBe('first_meeting');

    const kanePassNode = dialogueMgr.getNode('crambell_kane', 'crambell_kane_default', 'kane_pass_check')!;
    const kanePassEnd  = kanePassNode.choices.find(c => c.id === 'end')!;
    dialogueMgr.applyChoiceEffects('crambell_kane', kanePassEnd.effects);

    expect(state.flags.has('crambell_kane_met')).toBe(true);
    expect(state.getState().player.externalStats.affinity['crambell_kane']).toBe(1);

    // ── Simulate Mildore shackles arc completion ──────────────────────────────
    // In production: Mildore bread_fed dialogue sets these flags.
    // Here we set them directly to keep this test focused on the Kane Alliance path.
    state.flags.set('crambell_patrol_schedule_known');
    state.flags.set('crambell_kane_intel_ready');
    state.flags.set('crambell_task_shackles_completed');

    // ── Kane offer event fires ────────────────────────────────────────────────
    state.getState().player.currentLocationId = 'delth_patrol_zone';
    const offerResults = events.checkAndApply('delth_patrol_zone');
    const offerTrigger = offerResults.find(t => t.event.id === 'crambell_kane_offer');
    expect(offerTrigger).toBeDefined();
    expect(offerTrigger!.startEncounterId).toBe('crambell_enc_kane_offer');

    // ── Encounter: initial approach; player considers ─────────────────────────
    const offerStart = encounters.start('crambell_enc_kane_offer');
    expect(offerStart?.kind).toBe('node');
    if (offerStart?.kind !== 'node') return;
    expect(offerStart.resolved.node.id).toBe('kane_approach');

    resolveChoice(encounters, quests, 'follow_kane');
    const { pending: offerPending } = resolveChoice(encounters, quests, 'consider');
    expect(offerPending.outcomeType).toBe('success');

    expect(state.flags.has('crambell_kane_approached')).toBe(true);
    expect(state.getState().activeQuests['crambell_kane_double_agent']).toBeDefined();
    expect(state.getState().activeQuests['crambell_kane_double_agent']?.currentStageId).toBe('pending_intel');

    // ── Dialogue: kane_intel_offer fires (approached + intel_ready + !delivered) ─
    const kaneIntelTrigger = dialogueMgr.checkScriptedTrigger(
      'crambell_kane', 'crambell_kane_default', state.flags, 1,
    );
    expect(kaneIntelTrigger).not.toBeNull();
    expect(kaneIntelTrigger!.nodeId).toBe('kane_intel_offer');

    // Alliance choice visible; Kach choice NOT visible (crambell_treffen_lead_known unset)
    const filteredIntel = dialogueMgr.filterChoices(kaneIntelTrigger!.node.choices, state.flags);
    expect(filteredIntel.find(c => c.id === 'give_alliance')).toBeDefined();
    expect(filteredIntel.find(c => c.id === 'give_kach')).toBeUndefined();

    // Navigate to kane_deliver_alliance → confirm
    const deliverNode  = dialogueMgr.getNode('crambell_kane', 'crambell_kane_default', 'kane_deliver_alliance')!;
    const confirmChoice = deliverNode.choices.find(c => c.id === 'confirm')!;
    dialogueMgr.applyChoiceEffects('crambell_kane', confirmChoice.effects);

    // Alliance betrayal flags + reputation penalty
    expect(state.flags.has('crambell_kane_intel_delivered')).toBe(true);
    expect(state.flags.has('crambell_peoples_alliance_betrayed')).toBe(true);
    expect(state.getState().player.externalStats.reputation['crambell_peoples_alliance']).toBe(-20);
    expect(state.getState().player.externalStats.affinity['crambell_kane']).toBe(3);

    // Kach is NOT betrayed in this path
    expect(state.flags.has('crambell_kach_betrayed_kane')).toBe(false);

    // ── Quest flag sweep: pending_intel → meet_for_handoff ───────────────────
    // Mirrors endScriptedDialogue() calling checkObjectives() in production.
    quests.checkObjectives();
    expect(state.getState().activeQuests['crambell_kane_double_agent']?.currentStageId).toBe('meet_for_handoff');

    // ── kane_intel_offer no longer fires once delivered ───────────────────────
    const triggerAfterDelivery = dialogueMgr.checkScriptedTrigger(
      'crambell_kane', 'crambell_kane_default', state.flags, 2,
    );
    expect(triggerAfterDelivery).toBeNull();

    // ── Forest handoff event fires (needs crambell_kane_intel_delivered) ──────
    state.advanceTime(
      { year: 1498, month: 6, day: 12, hour: 22, minute: 0, totalMinutes: 720 },
      'rest',
    );
    state.getState().player.currentLocationId = 'delth_forest_clearing';

    const handoffResults = events.checkAndApply('delth_forest_clearing');
    const handoffTrigger = handoffResults.find(t => t.event.id === 'crambell_kane_forest_handoff');
    expect(handoffTrigger).toBeDefined();
    expect(handoffTrigger!.startEncounterId).toBe('crambell_enc_kane_forest_handoff');
  });
});
