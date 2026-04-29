// CrambellRoute5.integration.test.ts
//
// Integration test for Route 5 (Kach/Treffen trust path).
// Flow:
//   1. Test 1 completed (cover_for_kach done → report_back stage).
//   2. Morning event at dormitory_room triggers NPC dialogue → Kach briefs test2 → grants crambell_kach_test2.
//   3. Player goes to warehouse → event triggers encounter → meets Orland → obtains document.
//   4. Player reports to Kach (test2_report trigger) → receives modified list → test3 granted.
//   5. Player goes to patrol_zone → Kane handoff event → encounter → old_meeting intel.
//   6. Next morning → mysterious message event → crambell_mysterious_message_known.
//   7. Player goes to warehouse → talks to Orland (final_confirm trigger) → departure.

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
      id: 'route5-player',
      name: 'Route5 Tester',
      origin: 'worker',
      currentLocationId: 'delth_dormitory_room',
      primaryStats:       { strength: 5, knowledge: 6, talent: 5, spirit: 5, luck: 8 },
      primaryStatsExp:    { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      inclinationTracker: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      dailyGrantTracker:  { dateKey: '1498-6-14', grantedExp: {} },
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
    time: { year: 1498, month: 6, day: 14, hour: 22, minute: 0, totalMinutes: 1920 },
    timePeriod: 'rest',
    eventCooldowns: {},
    eventCounters: {},
    attemptCooldowns: {},
    propFlags: {},
  };
}

function loadRoute5Lore() {
  const lore = new LoreVault();
  const schedule = readJson<RegionSchedule>('lore/world/regions/crambell/schedule.json');
  const region: RegionIndex = {
    id: 'crambell',
    name: 'Crambell',
    theme: 'route5-test',
    locationIds: [
      'delth_dormitory',
      'delth_patrol_zone',
      'delth_warehouse',
      'delth_mining_shafts',
    ],
    npcIds: ['crambell_kach', 'crambell_kane', 'crambell_orland'],
    questIds: ['crambell_kach_test1', 'crambell_kach_test2', 'crambell_kach_test3'],
    factionIds: [],
    globalEventIds: [],
  };

  lore.load({
    locations: {
      delth_dormitory:    readJson<LocationNode>('lore/world/regions/crambell/locations/delth_dormitory.json'),
      delth_patrol_zone:  readJson<LocationNode>('lore/world/regions/crambell/locations/delth_patrol_zone.json'),
      delth_warehouse:    readJson<LocationNode>('lore/world/regions/crambell/locations/delth_warehouse.json'),
      delth_mining_shafts: readJson<LocationNode>('lore/world/regions/crambell/locations/delth_mining_shafts.json'),
    },
    regions:   { crambell: region },
    schedules: { crambell: schedule },
    events: {
      crambell_kach_test1_morning_report: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kach_test1_morning_report.json'),
      crambell_kach_test2_warehouse_entry: readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kach_test2_warehouse_entry.json'),
      crambell_kach_test3_kane_contact:   readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kach_test3_kane_contact.json'),
      crambell_kach_test3_message:        readJson<GameEvent>('lore/world/regions/crambell/events/crambell_kach_test3_message.json'),
    },
    quests: {
      crambell_kach_test1: readJson<QuestDefinition>('lore/world/regions/crambell/quests/crambell_kach_test1.json'),
      crambell_kach_test2: readJson<QuestDefinition>('lore/world/regions/crambell/quests/crambell_kach_test2.json'),
      crambell_kach_test3: readJson<QuestDefinition>('lore/world/regions/crambell/quests/crambell_kach_test3.json'),
    },
    encounters: {
      crambell_enc_kach_test2_warehouse:    readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kach_test2_warehouse.json'),
      crambell_enc_kach_test3_kane_handoff: readJson<EncounterDefinition>('lore/world/regions/crambell/encounters/crambell_enc_kach_test3_kane_handoff.json'),
    },
    dialogues: {
      crambell_kach_default:   readJson<DialogueProfile>('lore/world/regions/crambell/dialogues/crambell_kach_default.json'),
      crambell_orland_default: readJson<DialogueProfile>('lore/world/regions/crambell/dialogues/crambell_orland_default.json'),
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

describe('Crambell route5 integration — Kach/Treffen trust path', () => {
  it('player completes Kach tests and departs with Orland', () => {
    const { lore, schedule } = loadRoute5Lore();
    const bus        = new EventBus();
    const state      = new StateManager(makeState(), bus);
    const time       = new TimeManager();
    const events     = new EventEngine(lore, state, time, schedule);
    const quests     = new QuestEngine(lore, state);
    const encounters = new EncounterEngine(lore, state);
    const dialogueMgr = new DialogueManager(lore, state);

    // ── Pre-condition: test1 cover completed, report_back stage active ──────
    // Simulate test1 cover_for_kach completed
    quests.grantQuest('crambell_kach_test1');
    state.flags.set('crambell_kach_cover_held');
    state.flags.set('crambell_kach_test1_completed');
    state.flags.set('crambell_treffen_lead_known');
    state.flags.set('crambell_kach_test1_started');
    state.getState().activeQuests['crambell_kach_test1']!.currentStageId = 'report_back';

    // ── Step 1: Morning event at dormitory_room triggers NPC dialogue ───────
    state.advanceTime(
      { year: 1498, month: 6, day: 15, hour: 6, minute: 0, totalMinutes: 2160 },
      'work',
    );
    state.getState().player.currentLocationId = 'delth_dormitory_room';

    const morningResults = events.checkAndApply('delth_dormitory_room', [6]);
    const morningTrigger = morningResults.find(t => t.event.id === 'crambell_kach_test1_morning_report');
    expect(morningTrigger).toBeDefined();
    expect(morningTrigger!.startNpcDialogue).toBeDefined();
    expect(morningTrigger!.startNpcDialogue!.npcId).toBe('crambell_kach');
    expect(morningTrigger!.startNpcDialogue!.nodeId).toBe('test1_morning_report');

    // Simulate the dialogue: player accepts test2 → sets reported flag
    const morningNode = dialogueMgr.getNode('crambell_kach', 'crambell_kach_default', 'test1_morning_report');
    expect(morningNode).not.toBeNull();

    // Navigate: test1_morning_report → ask_result → kach_morning_success → listen → kach_morning_test2_brief → accept
    const briefNode = dialogueMgr.getNode('crambell_kach', 'crambell_kach_default', 'kach_morning_test2_brief');
    expect(briefNode).not.toBeNull();
    const acceptChoice = briefNode!.choices.find(c => c.id === 'accept')!;
    dialogueMgr.applyChoiceEffects('crambell_kach', acceptChoice.effects);

    expect(state.flags.has('crambell_kach_test1_reported')).toBe(true);
    expect(state.flags.has('crambell_kach_test2_briefed')).toBe(true);

    // Quest checkObjectives: report_back completes → grants test2
    quests.checkObjectives();
    expect(state.getState().activeQuests['crambell_kach_test1']?.isCompleted).toBe(true);
    expect(state.flags.has('crambell_kach_trust_gained')).toBe(true);
    expect(state.getState().activeQuests['crambell_kach_test2']).toBeDefined();
    expect(state.getState().activeQuests['crambell_kach_test2']?.currentStageId).toBe('infiltrate_warehouse');

    // ── Step 2: Warehouse encounter — meet Orland, obtain document ──────────
    state.getState().player.currentLocationId = 'delth_warehouse';
    const warehouseResults = events.checkAndApply('delth_warehouse');
    const warehouseTrigger = warehouseResults.find(t => t.event.id === 'crambell_kach_test2_warehouse_entry');
    expect(warehouseTrigger).toBeDefined();
    expect(warehouseTrigger!.startEncounterId).toBe('crambell_enc_kach_test2_warehouse');

    const warehouseStart = encounters.start('crambell_enc_kach_test2_warehouse');
    expect(warehouseStart?.kind).toBe('node');
    if (warehouseStart?.kind !== 'node') return;
    expect(warehouseStart.resolved.node.id).toBe('warehouse_search');

    // mention_kach → orland_recognizes → take_document → document_received
    resolveChoice(encounters, quests, 'mention_kach');
    resolveChoice(encounters, quests, 'take_document');

    expect(state.flags.has('crambell_kach_test2_orland_met')).toBe(true);
    expect(state.flags.has('crambell_kach_test2_document_obtained')).toBe(true);

    quests.checkObjectives();
    // infiltrate_warehouse and obtain_document should both complete
    expect(state.getState().activeQuests['crambell_kach_test2']?.currentStageId).toBe('report_to_kach');

    // ── Step 3: Report to Kach — test2_report trigger → receives list → test3 ──
    const kachTest2Report = dialogueMgr.checkScriptedTrigger(
      'crambell_kach', 'crambell_kach_default', state.flags, 2,
    );
    expect(kachTest2Report).not.toBeNull();
    expect(kachTest2Report!.nodeId).toBe('test2_report');

    // Navigate: test2_report → ask_next → test3_preview → accept
    const test3PreviewNode = dialogueMgr.getNode('crambell_kach', 'crambell_kach_default', 'test3_preview');
    expect(test3PreviewNode).not.toBeNull();
    const acceptTest3 = test3PreviewNode!.choices.find(c => c.id === 'accept')!;
    dialogueMgr.applyChoiceEffects('crambell_kach', acceptTest3.effects);

    expect(state.flags.has('crambell_kach_test2_reported')).toBe(true);
    expect(state.flags.has('crambell_kach_test3_list_received')).toBe(true);

    quests.checkObjectives();
    // test2 report_to_kach completes → grants test3
    expect(state.getState().activeQuests['crambell_kach_test2']?.isCompleted).toBe(true);
    expect(state.getState().activeQuests['crambell_kach_test3']).toBeDefined();

    quests.checkObjectives();
    // test3 receive_modified_list stage: list_received flag set → completes → contact_kane
    expect(state.getState().activeQuests['crambell_kach_test3']?.currentStageId).toBe('contact_kane');

    // ── Step 4: Kane handoff at patrol_zone ─────────────────────────────────
    state.getState().player.currentLocationId = 'delth_patrol_zone';
    const kaneResults = events.checkAndApply('delth_patrol_zone');
    const kaneTrigger = kaneResults.find(t => t.event.id === 'crambell_kach_test3_kane_contact');
    expect(kaneTrigger).toBeDefined();
    expect(kaneTrigger!.startEncounterId).toBe('crambell_enc_kach_test3_kane_handoff');

    const kaneStart = encounters.start('crambell_enc_kach_test3_kane_handoff');
    expect(kaneStart?.kind).toBe('node');
    if (kaneStart?.kind !== 'node') return;
    expect(kaneStart.resolved.node.id).toBe('approach_kane');

    // hand_over → kane_inspect → ask_more → kane_brief_intel (success)
    resolveChoice(encounters, quests, 'hand_over');
    resolveChoice(encounters, quests, 'ask_more');

    expect(state.flags.has('crambell_kach_test3_kane_handoff_done')).toBe(true);
    expect(state.flags.has('crambell_old_meeting_name_known')).toBe(true);

    quests.checkObjectives();
    // contact_kane completes → wait_for_message
    expect(state.getState().activeQuests['crambell_kach_test3']?.currentStageId).toBe('wait_for_message');

    // ── Step 5: Next morning — mysterious message event ─────────────────────
    state.advanceTime(
      { year: 1498, month: 6, day: 16, hour: 6, minute: 0, totalMinutes: 2880 },
      'work',
    );
    state.getState().player.currentLocationId = 'delth_dormitory_room';

    const messageResults = events.checkAndApply('delth_dormitory_room', [6]);
    const messageTrigger = messageResults.find(t => t.event.id === 'crambell_kach_test3_message');
    expect(messageTrigger).toBeDefined();
    expect(state.flags.has('crambell_mysterious_message_known')).toBe(true);

    quests.checkObjectives();
    // wait_for_message completes → test3 done
    expect(state.getState().activeQuests['crambell_kach_test3']?.isCompleted).toBe(true);
    expect(state.flags.has('crambell_kach_test3_completed')).toBe(true);

    // ── Step 6: Final departure — Orland dialogue ───────────────────────────
    state.getState().player.currentLocationId = 'delth_warehouse';

    // Orland final_confirm trigger should fire
    const orlandTrigger = dialogueMgr.checkScriptedTrigger(
      'crambell_orland', 'crambell_orland_default', state.flags, 1,
    );
    expect(orlandTrigger).not.toBeNull();
    expect(orlandTrigger!.nodeId).toBe('orland_final_confirm');

    // Navigate: orland_final_confirm → follow → orland_departure_prep → get_in → orland_departure_end → thank_and_leave
    const departureEndNode = dialogueMgr.getNode('crambell_orland', 'crambell_orland_default', 'orland_departure_end');
    expect(departureEndNode).not.toBeNull();
    const thankChoice = departureEndNode!.choices.find(c => c.id === 'thank_and_leave')!;
    dialogueMgr.applyChoiceEffects('crambell_orland', thankChoice.effects);

    expect(state.flags.has('crambell_route5_departed')).toBe(true);

    // ── Assertions: Route 5 complete ────────────────────────────────────────
    expect(state.getState().completedQuestIds).toContain('crambell_kach_test1');
    expect(state.getState().completedQuestIds).toContain('crambell_kach_test2');
    expect(state.getState().completedQuestIds).toContain('crambell_kach_test3');
  });
});
