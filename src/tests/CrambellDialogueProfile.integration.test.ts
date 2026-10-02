// CrambellDialogueProfile.integration.test.ts
//
// 對話 profile 與凱奇測試線的整合回歸：
//   A. getDialogueProfile 找不到 dialogueRules 指向的檔案時，退回 NPC 預設 profile
//   B. 預設 profile 的 persistent trigger 在切換 profile 後仍會觸發
//   C. 勘查中揭發凱奇 → crambell_kach_test1 透過階段 failCondition 失敗（不重複扣聲望）
//   D. test2 被 ditch 後，test2_report 不再觸發
//   E. 賣情報給凱恩：ditchSkipConsequences 與 affinityChanges

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { activeScriptedDialogue, inputDisabled } from '../lib/stores/gameStore';
import type { ILLMClient, ChatMessage } from '../lib/ai/ILLMClient';
import type { StateManager } from '../lib/engine/StateManager';
import type { QuestEngine } from '../lib/engine/QuestEngine';
import type { EncounterEngine } from '../lib/engine/EncounterEngine';
import type { DialogueManager } from '../lib/engine/DialogueManager';
import type { TriggeredEvent } from '../lib/engine/EventEngine';
import type { LoreVault } from '../lib/lore/LoreVault';
import type { DialogueProfile } from '../lib/types/dialogue';
import type { EncounterDefinition } from '../lib/types/encounter';
import type { QuestDefinition } from '../lib/types/quest';
import type { NPCNode, RegionIndex } from '../lib/types/world';

const REPO_ROOT = new URL('../../', import.meta.url);
const CRAMBELL  = 'lore/world/regions/crambell';

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
  encounterMgr: EncounterEngine;
  dialogueMgr:  DialogueManager;
  checkQuestFailConditions: (crossedHours: number[]) => TriggeredEvent[];
}

const NPC_IDS     = ['crambell_kach', 'crambell_kane', 'crambell_mildore'] as const;
const DIALOGUE_IDS = [
  'crambell_kach_default', 'crambell_kach_treffen', 'crambell_kach_deep',
  'crambell_kane_default', 'crambell_mildore_plaza',
] as const;
const QUEST_IDS   = ['crambell_kach_test1', 'crambell_kach_test2', 'crambell_kach_test3'] as const;

function makeController(overrides?: { npcs?: Record<string, NPCNode> }): { gc: GameController; i: Internals } {
  const client = new NoopClient();
  const gc = new GameController({ dm: client, regulator: client });

  const region: RegionIndex = {
    id: 'crambell', name: 'Crambell', theme: 'dialogue-profile-test',
    locationIds: [], npcIds: [...NPC_IDS], questIds: [...QUEST_IDS], factionIds: [],
  };

  const npcs: Record<string, NPCNode> = {};
  for (const id of NPC_IDS) npcs[id] = readJson<NPCNode>(`${CRAMBELL}/npcs/${id}.json`);
  Object.assign(npcs, overrides?.npcs);

  const dialogues: Record<string, DialogueProfile> = {};
  for (const id of DIALOGUE_IDS) dialogues[id] = readJson<DialogueProfile>(`${CRAMBELL}/dialogues/${id}.json`);

  const quests: Record<string, QuestDefinition> = {};
  for (const id of QUEST_IDS) quests[id] = readJson<QuestDefinition>(`${CRAMBELL}/quests/${id}.json`);

  gc.loadLore({
    regions: { crambell: region },
    npcs, dialogues, quests,
    encounters: {
      crambell_enc_survey: readJson<EncounterDefinition>(`${CRAMBELL}/encounters/crambell_enc_survey.json`),
    },
  });

  const i = gc as unknown as Internals;
  i.checkQuestFailConditions = (gc as unknown as Internals).checkQuestFailConditions.bind(gc);
  return { gc, i };
}

const affinity = (s: StateManager, npcId: string) => s.getState().player.externalStats.affinity[npcId] ?? 0;
const reputation = (s: StateManager, fid: string) => s.getState().player.externalStats.reputation[fid] ?? 0;

/** 以 GameController.selectDialogueChoice 走完凱恩情報交付的單一選項（endAfterScript 避免 LLM opener）。 */
async function deliverToKane(gc: GameController, i: Internals, nodeId: string, choiceId: string): Promise<void> {
  const node = i.dialogueMgr.getNode('crambell_kane', 'crambell_kane_default', nodeId)!;
  const choices = i.dialogueMgr.filterChoices(node.choices, i.state.flags);
  expect(choices.map(c => c.id)).toEqual([choiceId]);
  activeScriptedDialogue.set({
    npcId: 'crambell_kane', npcName: '凱恩', dialogueId: 'crambell_kane_default',
    currentNodeId: nodeId, currentChoices: choices, collectedNarrative: '', endAfterScript: true,
  });
  await gc.selectDialogueChoice(choiceId);
  expect(get(activeScriptedDialogue)).toBeNull();
}

describe('LoreVault.getDialogueProfile fallback (A)', () => {
  it('falls back to the NPC default profile when the rule target is missing, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { i } = makeController();
      const profile = i.lore.getDialogueProfile('crambell_kach', 'crambell_kach_missing_variant');
      expect(profile?.id).toBe('crambell_kach_default');
      expect(warn).toHaveBeenCalledTimes(1);

      // 連預設 profile 都沒有時回 undefined，同樣 warn
      expect(i.lore.getDialogueProfile('no_such_npc', 'no_such_dialogue')).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(2);

      // 正常命中不 warn
      expect(i.lore.getDialogueProfile('crambell_kach', 'crambell_kach_treffen')?.id).toBe('crambell_kach_treffen');
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('scripted triggers still resolve when a dialogueRule points to a missing file', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const kach = readJson<NPCNode>(`${CRAMBELL}/npcs/crambell_kach.json`);
      kach.dialogueRules = [{ id: 'rule_missing', label: '測試：指向不存在的檔案', condition: 'crambell_treffen_trust_gained', dialogueId: 'crambell_kach_missing', priority: 99 }];
      const { i } = makeController({ npcs: { crambell_kach: kach } });
      i.state.flags.set('crambell_treffen_trust_gained');
      i.state.flags.set('crambell_kach_second_meeting_ready');

      const npc = i.lore.resolveNPC('crambell_kach', i.state.flags);
      expect(npc?.activeDialogueId).toBe('crambell_kach_missing');
      const r = i.dialogueMgr.checkScriptedTrigger('crambell_kach', npc!.activeDialogueId, i.state.flags, 3);
      expect(r?.nodeId).toBe('second_meeting');
      expect(r?.dialogueId).toBe('crambell_kach_default');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('persistent dialogue triggers (B) / test2_report gating (D)', () => {
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0.99); }); // 讓機率型閒聊 trigger 不觸發
  afterEach(() => { vi.restoreAllMocks(); });

  it('test2_report still fires after Kach switches to the kach_treffen profile', () => {
    const { i } = makeController();
    i.state.flags.set('crambell_treffen_trust_gained');
    expect(i.quests.grantQuest('crambell_kach_test2')).toBe(true);
    i.state.flags.set('crambell_kach_test2_document_obtained');

    const npc = i.lore.resolveNPC('crambell_kach', i.state.flags);
    expect(npc?.activeDialogueId).toBe('crambell_kach_treffen');

    const r = i.dialogueMgr.checkScriptedTrigger('crambell_kach', npc!.activeDialogueId, i.state.flags, 5);
    expect(r?.nodeId).toBe('test2_report');
    // 對話以擁有該 node 的預設 profile 執行，後續 nodes 可解析
    expect(r?.dialogueId).toBe('crambell_kach_default');
    for (const c of r!.node.choices) {
      if (c.nextNodeId) expect(i.dialogueMgr.getNode('crambell_kach', r!.dialogueId, c.nextNodeId)).not.toBeNull();
    }
  });

  it('inherited persistent triggers are evaluated before active profile triggers', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // 機率閒聊 trigger 必中，仍應讓劇情 trigger 先觸發
    const { i } = makeController();
    i.state.flags.set('crambell_treffen_trust_gained');
    expect(i.quests.grantQuest('crambell_kach_test2')).toBe(true);
    i.state.flags.set('crambell_kach_test2_document_obtained');

    const first = i.dialogueMgr.checkScriptedTrigger('crambell_kach', 'crambell_kach_treffen', i.state.flags, 5);
    expect(first?.nodeId).toBe('test2_report');
    expect(first?.dialogueId).toBe('crambell_kach_default');
    const second = i.dialogueMgr.checkScriptedTrigger(
      'crambell_kach', 'crambell_kach_treffen', i.state.flags, 5, new Set(['test2_report']),
    );
    expect(second?.nodeId).toBe('kach_treffen_check');
    expect(second?.dialogueId).toBe('crambell_kach_treffen');
  });

  it('non-persistent default triggers are not inherited', () => {
    const { i } = makeController();
    // first_meeting（未標 persistent）在切換後不應被繼承
    const r = i.dialogueMgr.checkScriptedTrigger('crambell_kach', 'crambell_kach_treffen', i.state.flags, 0);
    expect(r).toBeNull();
  });

  it('test2_report does not fire once test2 has been ditched', () => {
    const { i } = makeController();
    expect(i.quests.grantQuest('crambell_kach_test2')).toBe(true);
    i.state.flags.set('crambell_kach_test2_document_obtained');
    expect(i.dialogueMgr.checkScriptedTrigger('crambell_kach', 'crambell_kach_default', i.state.flags, 5)?.nodeId)
      .toBe('test2_report');

    expect(i.quests.ditchQuest('crambell_kach_test2', { skipConsequences: true })).toBe(true);
    expect(i.state.flags.has('crambell_kach_betrayed')).toBe(false);
    expect(i.dialogueMgr.checkScriptedTrigger('crambell_kach', 'crambell_kach_default', i.state.flags, 5)).toBeNull();
  });
});

describe('survey exposes Kach → test1 fails (C)', () => {
  it('kach_exposed fails crambell_kach_test1 via stage failCondition without double penalties', () => {
    const { i } = makeController();
    const { state, quests, encounterMgr } = i;

    expect(quests.grantQuest('crambell_kach_test1')).toBe(true);
    state.flags.set('crambell_kach_test1_started');

    const start = encounterMgr.start('crambell_enc_survey');
    expect(start?.kind).toBe('node');
    expect(encounterMgr.selectChoice('answer_straight_kach_absent')).not.toBeNull();
    expect(encounterMgr.selectChoice('expose_kach')).not.toBeNull();
    const pending = encounterMgr.flushPendingEffects();
    expect(pending.outcomeType).toBe('failure');
    if (pending.outcomeType !== undefined) encounterMgr.conclude(pending.outcomeType);
    quests.checkObjectives();

    expect(state.flags.has('crambell_kach_cover_blown')).toBe(true);
    const kachAff = affinity(state, 'crambell_kach');
    const govRep  = reputation(state, 'crambell_government');
    expect(kachAff).toBe(-10);
    expect(govRep).toBe(2);
    expect(state.getState().activeQuests['crambell_kach_test1']?.isFailed).toBeFalsy();

    i.checkQuestFailConditions([]);
    const inst = state.getState().activeQuests['crambell_kach_test1'];
    expect(inst?.isFailed).toBe(true);
    expect(inst?.isDitched).toBeFalsy();
    expect(state.getState().completedQuestIds).toContain('crambell_kach_test1');
    expect(state.flags.has('crambell_kach_test1:active')).toBe(false);
    // onFail 只做結構結果
    expect(affinity(state, 'crambell_kach')).toBe(kachAff);
    expect(reputation(state, 'crambell_government')).toBe(govRep);
    expect(state.flags.has('crambell_kach_betrayed')).toBe(false);
    expect(quests.grantQuest('crambell_kach_test1')).toBe(false);
  });
});

describe('selling intel to Kane (E)', () => {
  beforeEach(() => {
    inputDisabled.set(false);
    activeScriptedDialogue.set(null);
  });

  it('selling alliance intel during test1 ditches test1 without Kach betrayal consequences', async () => {
    const { gc, i } = makeController();
    const { state, quests } = i;
    expect(quests.grantQuest('crambell_kach_test1')).toBe(true);

    const treffenBefore = reputation(state, 'crambell_treffen');
    const govBefore     = reputation(state, 'crambell_government');
    const kachBefore    = affinity(state, 'crambell_kach');
    const mildoreBefore = affinity(state, 'crambell_mildore');

    await deliverToKane(gc, i, 'kane_deliver_alliance', 'confirm');

    expect(state.getState().activeQuests['crambell_kach_test1']).toBeUndefined();
    expect(state.flags.has('crambell_kach_test1:active')).toBe(false);
    expect(reputation(state, 'crambell_treffen')).toBe(treffenBefore);
    expect(reputation(state, 'crambell_government')).toBe(govBefore); // 階段 onDitch 也不套用
    expect(affinity(state, 'crambell_kach')).toBe(kachBefore);
    expect(state.flags.has('crambell_kach_betrayed')).toBe(false);
    expect(state.flags.has('crambell_treffen_betrayed_early')).toBe(false);
    expect(affinity(state, 'crambell_mildore')).toBe(mildoreBefore - 15);
    expect(reputation(state, 'crambell_peoples_alliance')).toBe(-20);
    expect(state.flags.has('crambell_peoples_alliance_betrayed')).toBe(true);
  });

  it('selling Kach intel during test2 deducts Kach affinity exactly once', async () => {
    const { gc, i } = makeController();
    const { state, quests } = i;
    expect(quests.grantQuest('crambell_kach_test2')).toBe(true);
    state.flags.set('crambell_treffen_lead_known');

    const kachBefore = affinity(state, 'crambell_kach');
    await deliverToKane(gc, i, 'kane_deliver_kach', 'confirm_ditch_test2');

    expect(state.getState().activeQuests['crambell_kach_test2']).toBeUndefined();
    expect(affinity(state, 'crambell_kach')).toBe(kachBefore - 15);
    expect(affinity(state, 'crambell_kane')).toBe(2);
    expect(state.flags.has('crambell_kach_betrayed_kane')).toBe(true);
  });

  it('selling Kach intel during test1 keeps the test1 ditchConsequences (no extra affinityChanges)', async () => {
    const { gc, i } = makeController();
    const { state, quests } = i;
    expect(quests.grantQuest('crambell_kach_test1')).toBe(true);
    state.flags.set('crambell_treffen_lead_known');

    await deliverToKane(gc, i, 'kane_deliver_kach', 'confirm');

    expect(affinity(state, 'crambell_kach')).toBe(-15);
    expect(state.flags.has('crambell_kach_betrayed')).toBe(true);
    expect(state.getState().completedQuestIds).toContain('crambell_kach_test1');
  });
});

describe('route 5 lockout after siding with the government (decision 1)', () => {
  const GRANT_ENCOUNTERS = ['crambell_enc_kach_forest_walk', 'crambell_enc_kach_mine_invite'] as const;
  const GATE_FLAGS = ['crambell_peoples_alliance_betrayed', 'crambell_player_allied_government'] as const;

  function loadEncounter(i: Internals, id: string): void {
    i.lore.load({ encounters: { [id]: readJson<EncounterDefinition>(`${CRAMBELL}/encounters/${id}.json`) } });
  }

  it('after selling alliance intel during test1, talking to Kach cannot re-grant test1', async () => {
    inputDisabled.set(false);
    activeScriptedDialogue.set(null);
    const { gc, i } = makeController();
    for (const id of GRANT_ENCOUNTERS) loadEncounter(i, id);
    const { state, quests, encounterMgr, dialogueMgr } = i;

    expect(quests.grantQuest('crambell_kach_test1')).toBe(true);
    await deliverToKane(gc, i, 'kane_deliver_alliance', 'confirm');
    expect(state.getState().activeQuests['crambell_kach_test1']).toBeUndefined();
    expect(state.getState().completedQuestIds).not.toContain('crambell_kach_test1');

    // 即使邀請旗標被重置，second_meeting 也不再觸發
    state.flags.unset('crambell_kach_test1_invited');
    state.flags.set('crambell_kach_second_meeting_ready');
    expect(dialogueMgr.checkScriptedTrigger('crambell_kach', 'crambell_kach_default', state.flags, 5)).toBeNull();

    // 授予 test1 的遭遇中，所有通往 kach_grateful 的接受選項都被隱藏
    for (const id of GRANT_ENCOUNTERS) {
      const start = encounterMgr.start(id);
      if (start?.kind !== 'node') throw new Error(`encounter ${id} did not start`);
      const entryVisible = start.resolved.visibleChoices.map(c => c.id);
      expect(entryVisible).toContain('decline');
      expect(entryVisible).not.toContain('accept_no_question');
      const evasive = encounterMgr.selectChoice('ask_what_for');
      expect(evasive?.visibleChoices.map(c => c.id)).toEqual(['decline']);
      encounterMgr.selectChoice('decline');
      encounterMgr.flushPendingEffects();
      encounterMgr.conclude('neutral');
    }
    expect(state.getState().activeQuests['crambell_kach_test1']).toBeUndefined();
  });

  it('every test1 grant path excludes both government-side flags', () => {
    for (const id of GRANT_ENCOUNTERS) {
      const def = readJson<EncounterDefinition>(`${CRAMBELL}/encounters/${id}.json`);
      for (const n of Object.values(def.nodes ?? {})) {
        for (const c of n.choices ?? []) {
          if (c.nextNodeId !== 'kach_grateful') continue;
          for (const f of GATE_FLAGS) expect(c.condition).toContain(`!${f}`);
        }
      }
    }
    for (const ev of ['crambell_kach_forest_walk', 'crambell_kach_mine_invite', 'crambell_kach_second_meeting_unlock']) {
      const e = readJson<{ condition: { notFlags?: string[] } }>(`${CRAMBELL}/events/${ev}.json`);
      for (const f of GATE_FLAGS) expect(e.condition.notFlags).toContain(f);
    }
    const kach = readJson<DialogueProfile>(`${CRAMBELL}/dialogues/crambell_kach_default.json`);
    const second = kach.triggers.find(t => t.nodeId === 'second_meeting')!;
    for (const f of GATE_FLAGS) expect(second.condition).toContain(`!${f}`);
  });
});
