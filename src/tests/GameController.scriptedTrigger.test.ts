// GameController.scriptedTrigger.test.ts
//
// Regression test for the pre-DM scripted trigger activation path.
//
// Flow under test:
//   Player input → Regulator returns type="interact" + targetId
//   → GameController fires checkScriptedTrigger BEFORE normal DM pipeline
//   → Matching trigger activates scripted node
//   → Normal DM pipeline (planning layer / Judge / stream) is NOT called

import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { activeScriptedDialogue, inputDisabled } from '../lib/stores/gameStore';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type { LocationNode, NPCNode, RegionIndex } from '../lib/types';
import type { DialogueProfile } from '../lib/types/dialogue';

const NPC_ID      = 'test_npc';
const DIALOGUE_ID = 'test_npc_dialogue';
const NODE_ID     = 'intro';
const LOCATION_ID = 'delth_dormitory_room';

// ── Mock LLM client ───────────────────────────────────────────────────────────
// Regulator returns interact + targetId → scripted trigger should short-circuit
// the pipeline before planning layer / Judge / stream are ever called.

class ScriptedTriggerClient implements ILLMClient {
  planningLayerCalled = false;
  judgeCalled         = false;
  streamCalled        = false;

  async complete(systemPrompt: string): Promise<string> {
    if (systemPrompt.includes('action validator')) {
      return JSON.stringify({
        allowed:       true,
        reason:        null,
        modifiedInput: null,
        actionType:    'interact',
        targetId:      NPC_ID,
      });
    }
    if (systemPrompt.includes('planning layer')) {
      this.planningLayerCalled = true;
    }
    if (systemPrompt.includes('You are the Judge')) {
      this.judgeCalled = true;
    }
    return JSON.stringify({});
  }

  async *stream(): AsyncGenerator<string> {
    this.streamCalled = true;
    yield '';
  }
}

// ── Lore helpers ─────────────────────────────────────────────────────────────

function makeLocation(): LocationNode {
  return {
    id:           LOCATION_ID,
    name:         'Dorm Room',
    regionId:     'crambell',
    tags:         [],
    locationType: 'area',
    base: {
      description: 'A cramped dorm room.',
      ambience:    [],
      connections: [],
      npcIds:      [NPC_ID],
      eventIds:    [],
      isAccessible: true,
    },
    localVariants: [],
  };
}

function makeNpc(): NPCNode {
  return {
    id:                NPC_ID,
    name:              'Test NPC',
    dialogueId:        DIALOGUE_ID,
    defaultLocationId: LOCATION_ID,
    publicDescription: 'A test NPC.',
  };
}

function makeDialogueProfile(): DialogueProfile {
  return {
    id:             DIALOGUE_ID,
    npcId:          NPC_ID,
    defaultContext: 'A generic NPC.',
    nodes: {
      [NODE_ID]: {
        lines: [
          { speaker: 'npc', text: 'Hello, traveller.' },
        ],
        choices: [],  // no choices → auto-ends after display
      },
    },
    triggers: [
      {
        nodeId:           NODE_ID,
        firstMeetingOnly: true,
      },
    ],
  };
}

function makeRegion(): RegionIndex {
  return {
    id:          'crambell',
    name:        'Crambell',
    theme:       'test',
    locationIds: [LOCATION_ID],
    npcIds:      [NPC_ID],
    questIds:    [],
    factionIds:  [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GameController scripted trigger activation', () => {
  beforeEach(() => {
    inputDisabled.set(false);
    activeScriptedDialogue.set(null);
  });

  it('fires scripted trigger and skips DM pipeline when interact+targetId matches a scene NPC', async () => {
    const client     = new ScriptedTriggerClient();
    const controller = new GameController({ dm: client, regulator: client });

    controller.loadLore({
      locations: { [LOCATION_ID]: makeLocation() },
      npcs:      { [NPC_ID]: makeNpc() },
      dialogues: { [DIALOGUE_ID]: makeDialogueProfile() },
      regions:   { crambell: makeRegion() },
    });

    await controller.start('Tester');
    // Reset tracking — start() uses stream() for opening narration
    client.planningLayerCalled = false;
    client.judgeCalled         = false;
    client.streamCalled        = false;

    // Player types something; Regulator mock returns interact + targetId
    await controller.submitAction('和測試NPC說話');

    // Scripted trigger should have fired — DM pipeline was NOT invoked
    expect(client.planningLayerCalled).toBe(false);
    expect(client.judgeCalled).toBe(false);
    expect(client.streamCalled).toBe(false);

    // activeScriptedDialogue is set by activateScriptedNode
    const dialogue = get(activeScriptedDialogue);
    expect(dialogue).not.toBeNull();
    expect(dialogue?.npcId).toBe(NPC_ID);
    expect(dialogue?.currentNodeId).toBe(NODE_ID);
  });

  it('falls through to DM pipeline when no scripted trigger matches', async () => {
    const client     = new ScriptedTriggerClient();
    const controller = new GameController({ dm: client, regulator: client });

    // Same setup but NPC has already been met (interactionCount > 0 would skip firstMeetingOnly)
    // Simulate by using a dialogue profile with no triggers at all
    const profileNoTriggers: DialogueProfile = {
      ...makeDialogueProfile(),
      triggers: [],
    };

    controller.loadLore({
      locations: { [LOCATION_ID]: makeLocation() },
      npcs:      { [NPC_ID]: makeNpc() },
      dialogues: { [DIALOGUE_ID]: profileNoTriggers },
      regions:   { crambell: makeRegion() },
    });

    await controller.start('Tester');
    client.planningLayerCalled = false;

    await controller.submitAction('和測試NPC說話');

    // No scripted trigger → DM pipeline should have been invoked
    expect(client.planningLayerCalled).toBe(true);
  });
});
