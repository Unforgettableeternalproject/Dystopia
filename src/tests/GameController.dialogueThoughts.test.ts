// GameController.dialogueThoughts.test.ts
//
// Regression tests for three dialogue bugs reported from real-device play:
//
//   Bug A (來源 + 分流) — exploration-flavoured thoughts must never remain shown/clickable
//     while an NPC dialogue is active, and if a non-conversational action is submitted
//     anyway (stale thought click), the dialogue must be closed first instead of the
//     input being shoved into the dialogue LLM as player speech.
//   Bug B (重入) — a single logical dialogue turn must never produce two NPC speech
//     bubbles (one empty, one filled) when handleDialogueInput races with itself.
//   Bug C (結束後想法) — ending a dialogue restores the pre-dialogue exploration
//     thoughts snapshot when nothing changed; calls a lightweight LLM only when game
//     state changed meaningfully during the conversation; falls back to the snapshot
//     if that LLM call fails.

import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { activeNpcUI, activeScriptedDialogue, inputDisabled, narrativeLines, thoughts } from '../lib/stores/gameStore';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type { LocationNode, NPCNode, RegionIndex } from '../lib/types';
import type { DialogueProfile } from '../lib/types/dialogue';

const NPC_ID      = 'kach';
const DIALOGUE_ID = 'kach_default';
// 與 start() 未指定 world.startLocationId 時的預設起始地點一致（見 GameController 的測試 fallback）
const LOCATION_ID = 'delth_dormitory_room';

function makeLocation(): LocationNode {
  return {
    id: LOCATION_ID, name: '公用長廳', regionId: 'crambell', tags: [], locationType: 'area',
    base: {
      description: '一間公用長廳，長桌上堆著物資。', ambience: [],
      connections: [{ targetLocationId: LOCATION_ID, description: '原地', traverseTime: 1 }],
      npcIds: [NPC_ID], eventIds: [], isAccessible: true,
    },
    localVariants: [],
  };
}

function makeNpc(): NPCNode {
  return {
    id: NPC_ID, name: '凱奇·巴頓', dialogueId: DIALOGUE_ID,
    defaultLocationId: LOCATION_ID, publicDescription: '一名礦工。',
  };
}

function makeDialogueProfile(): DialogueProfile {
  return {
    id: DIALOGUE_ID, npcId: NPC_ID, defaultContext: '凱奇說話直接。',
    nodes: {}, triggers: [],   // no scripted triggers — always falls through to LLM
  };
}

function makeRegion(): RegionIndex {
  return {
    id: 'crambell', name: 'Crambell', theme: 'test',
    locationIds: [LOCATION_ID], npcIds: [NPC_ID], questIds: [], factionIds: [],
  };
}

function loadLore(controller: GameController): void {
  controller.loadLore({
    locations: { [LOCATION_ID]: makeLocation() },
    npcs:      { [NPC_ID]: makeNpc() },
    dialogues: { [DIALOGUE_ID]: makeDialogueProfile() },
    regions:   { crambell: makeRegion() },
  });
}

/** Deferred promise helper for controlling when the dialogue intent call resolves. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

class DialogueTestClient implements ILLMClient {
  exitThoughtsCalled    = 0;
  dialogueIntentCalled  = 0;
  dialogueNarrateCalled = 0;
  /** When set, the FIRST dialogue-intent call awaits this before resolving (for the reentrancy test). */
  gateFirstDialogueIntent: { promise: Promise<void>; resolve: () => void } | null = null;
  exitThoughtsShouldFail = false;
  exitThoughtsLine = '<<THOUGHTS: 前往大門 | 觀察四周>>';
  dialogueSuggestions: string[] = ['跟他談談礦工自治聯盟', '問他今天的配額'];

  async complete(systemPrompt: string, userMessage?: string): Promise<string> {
    if (systemPrompt.includes('action validator')) {
      return JSON.stringify({ allowed: true, reason: null, modifiedInput: null, actionType: null, targetId: null });
    }
    if (systemPrompt.includes('just ended an NPC dialogue')) {
      this.exitThoughtsCalled++;
      if (this.exitThoughtsShouldFail) throw new Error('exit-thoughts LLM failed');
      return this.exitThoughtsLine;
    }
    if (systemPrompt.includes('dialogue encounter') && systemPrompt.includes('planning layer')) {
      // DM Phase 1 — dialogue intent
      const isFirstCall = this.dialogueIntentCalled === 0;
      this.dialogueIntentCalled++;
      if (isFirstCall && this.gateFirstDialogueIntent) {
        await this.gateFirstDialogueIntent.promise;
      }
      return JSON.stringify({
        endEncounter: false, npcState: { attitude: 'neutral', topic: 'chat' },
        flagsSet: [], flagsUnset: [], timeMinutes: 2, questSignals: [],
        suggestions: this.dialogueSuggestions,
      });
    }
    if (systemPrompt.includes('dialogue encounter turn')) {
      // Judge — dialogue
      return JSON.stringify({ endEncounter: false, timeMinutes: 2, flagsSet: [], flagsUnset: [] });
    }
    if (systemPrompt.includes('planning layer')) {
      // DM Phase 1 — exploration. If the player's action was classified as interacting
      // (the only NPC in this scene is NPC_ID), decide to start a dialogue encounter
      // (mirrors a real DM deciding encounter:{type:'dialogue'} for an interact action).
      const targetsNpc = (userMessage ?? '').includes('type: interact');
      return JSON.stringify({
        narrativeSummary: 'explore', timeMinutes: 1, flagsSet: [], flagsUnset: [],
        encounter: targetsNpc ? { type: 'dialogue', npcId: NPC_ID } : null,
        suggestions: [],
      });
    }
    if (systemPrompt.includes('You are the Judge')) {
      const targetsNpc = (userMessage ?? '').includes(`"type": "dialogue"`);
      return JSON.stringify({
        move: null, timeMinutes: 1, flagsSet: [], flagsUnset: [],
        encounter: targetsNpc ? { type: 'dialogue', npcId: NPC_ID } : null,
        reasoning: '',
      });
    }
    return JSON.stringify({});
  }

  /** 對話敘述串流末尾附加的 <<THOUGHTS>> 訊號；null 代表 LLM 這輪沒給。 */
  dialogueNarrateThoughtsLine: string | null = '<<THOUGHTS: 跟他談談礦工自治聯盟 | 問他今天的配額>>';

  async *stream(systemPrompt: string): AsyncGenerator<string> {
    if (systemPrompt.includes('voicing a single NPC')) {
      this.dialogueNarrateCalled++;
      yield '聽起來不錯啊。';
      if (this.dialogueNarrateThoughtsLine !== null) yield '\n' + this.dialogueNarrateThoughtsLine;
      return;
    }
    yield '你環顧四周。';
  }
}

async function makeController(client: DialogueTestClient): Promise<GameController> {
  const controller = new GameController({ dm: client, regulator: client });
  loadLore(controller);
  await controller.start('Tester');
  return controller;
}

async function openDialogue(controller: GameController): Promise<void> {
  await controller.submitAction('和凱奇說話', 'interact', NPC_ID);
}

describe('對話中的想法候選與結束後還原', () => {
  beforeEach(() => {
    inputDisabled.set(false);
    activeScriptedDialogue.set(null);
    activeNpcUI.set(null);
    thoughts.set([]);
    narrativeLines.set([]);
  });

  it('Bug A 來源：進入對話後 thoughts 不含探索類候選（actionType 皆為對話建議）', async () => {
    const client     = new DialogueTestClient();
    const controller = await makeController(client);

    // Entering dialogue should immediately clear any pre-existing exploration thoughts,
    // then refill with dialogue-flavoured suggestions once the opener resolves.
    await openDialogue(controller);

    const current = get(thoughts);
    expect(current.length).toBeGreaterThan(0);
    for (const t of current) {
      expect(t.actionType).toBe('free');
      expect(['move', 'examine', 'rest'].includes(t.actionType)).toBe(false);
    }
  });

  it('對話候選來自敘述串流末尾的 <<THOUGHTS>> 訊號，固定附加「結束對話」，訊號不洩入顯示文字', async () => {
    const client     = new DialogueTestClient();
    const controller = await makeController(client);
    await openDialogue(controller);

    const current = get(thoughts);
    expect(current.map(t => t.text)).toEqual(['跟他談談礦工自治聯盟', '問他今天的配額', '結束對話']);
    expect(current.find(t => t.id === 'end_dialogue')).toBeTruthy();

    const dialogueLine = get(narrativeLines).find(l => l.type === 'dialogue');
    expect(dialogueLine?.text).not.toContain('<<THOUGHTS');
    expect(dialogueLine?.text).not.toContain('<<');
  });

  it('LLM 這輪沒給 <<THOUGHTS>> 時，對話候選只顯示「結束對話」', async () => {
    const client = new DialogueTestClient();
    client.dialogueNarrateThoughtsLine = null;
    const controller = await makeController(client);
    await openDialogue(controller);

    expect(get(thoughts).map(t => t.id)).toEqual(['end_dialogue']);
  });

  it('點選「結束對話」會直接退出對話，不當成一般動作送出', async () => {
    const client     = new DialogueTestClient();
    const controller = await makeController(client);
    await openDialogue(controller);

    controller.exitDialogue();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(get(activeNpcUI)).toBeNull();
    const lines = get(narrativeLines);
    expect(lines.some(l => l.text.includes('結束了與'))).toBe(true);
  });

  it('Bug A 分流：對話中點選非對話類候選（examine）會先結束對話，不會送進對話 LLM', async () => {
    const client     = new DialogueTestClient();
    const controller = await makeController(client);
    await openDialogue(controller);

    const dialogueCallsBefore = client.dialogueIntentCalled;

    // Simulate clicking a stale exploration thought while in dialogue.
    await controller.submitAction('檢查公用長桌上的物資', 'examine');

    // Dialogue must have been force-closed — not treated as dialogue input.
    expect(get(activeNpcUI)).toBeNull();
    expect(client.dialogueIntentCalled).toBe(dialogueCallsBefore); // no extra dialogue-intent call

    // The player line should use the normal '>' prefix, not the dialogue '「」' format.
    const lines = get(narrativeLines);
    const playerLine = lines.find(l => l.text.includes('檢查公用長桌上的物資'));
    expect(playerLine?.type).toBe('player');
    expect(playerLine?.text.startsWith('>')).toBe(true);
  });

  it('Bug B 重入：同一回合不會因併發觸發而產生兩個 NPC 發言框', async () => {
    const client     = new DialogueTestClient();
    const controller = await makeController(client);
    await openDialogue(controller);
    narrativeLines.set([]); // clear opener's line, focus on the next turn

    const gate = deferred<void>();
    client.gateFirstDialogueIntent = { promise: gate.promise, resolve: gate.resolve };

    // First call starts and blocks inside DM Phase 1 (dialogue intent).
    const first = controller.submitAction('聊聊礦工自治聯盟');
    // Second call fires while the first is still in flight — must be ignored by the
    // _dialogueInputBusy re-entrancy guard rather than racing to push a second bubble.
    const second = controller.submitAction('聊聊礦工自治聯盟');

    gate.resolve();
    await Promise.all([first, second]);

    const dialogueLines = get(narrativeLines).filter(l => l.type === 'dialogue');
    expect(dialogueLines.length).toBe(1);
    expect(dialogueLines[0].text.trim().length).toBeGreaterThan(0);
    expect(dialogueLines[0].isStreaming).toBe(false);
  });

  it('Bug C 無變化：結束對話還原進入前的快照，不呼叫 LLM', async () => {
    const client     = new DialogueTestClient();
    const controller = await makeController(client);

    await openDialogue(controller);
    // snapshotThoughtsBeforeDialogue() captured whatever the exploration turn that opened
    // this encounter had just produced — read it back via the private field to assert
    // the exact same array is restored (not regenerated) on close.
    const snapshotBefore = (controller as unknown as { _thoughtsSnapshot: unknown })._thoughtsSnapshot;
    expect(snapshotBefore).not.toBeNull();

    await controller.submitAction('聊聊今天天氣如何');
    await controller.forceCloseDialogue(NPC_ID);

    expect(client.exitThoughtsCalled).toBe(0);
    expect(get(thoughts)).toEqual(snapshotBefore);
  });

  it('Bug C 有變化：對話期間旗標變化後結束，呼叫一次輕量 LLM 取得新候選', async () => {
    const client     = new DialogueTestClient();
    const controller = await makeController(client);

    await openDialogue(controller);

    // Mutate game state mid-dialogue (flags) so the snapshot fingerprint no longer matches.
    const sm = (controller as unknown as { state: { flags: { set: (id: string) => void } } }).state;
    sm.flags.set('crambell_test_flag_changed');

    await controller.forceCloseDialogue(NPC_ID);

    expect(client.exitThoughtsCalled).toBe(1);
    expect(get(thoughts).map(t => t.text)).toEqual(['前往大門', '觀察四周']);
  });

  it('Bug C LLM 失敗：退回快照', async () => {
    const client     = new DialogueTestClient();
    client.exitThoughtsShouldFail = true;
    const controller = await makeController(client);

    await openDialogue(controller);
    const snapshot = (controller as unknown as { _thoughtsSnapshot: unknown })._thoughtsSnapshot;
    expect(snapshot).not.toBeNull();

    const sm = (controller as unknown as { state: { flags: { set: (id: string) => void } } }).state;
    sm.flags.set('crambell_test_flag_changed');

    await controller.forceCloseDialogue(NPC_ID);

    expect(client.exitThoughtsCalled).toBe(1);
    expect(get(thoughts)).toEqual(snapshot);
  });
});
