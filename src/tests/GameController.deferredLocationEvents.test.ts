// GameController.deferredLocationEvents.test.ts
//
// Regression test for: location/global events must NOT be evaluated at the
// departure location when the player moves — they must be evaluated at the
// destination AFTER the move completes. Covers both the direct-move path
// (thought candidate, targetId known up front) and the free-text move path
// (DM Phase 1 / Judge resolve the destination).
//
// Bug reproduced: player at delth_dormitory_public_bathroom (source) moves to
// delth_dormitory_room (destination). Source has a triggerChance:1 location
// event with startEncounterId. Before the fix, GameController evaluated this
// event BEFORE runDM ever ran, launched the encounter, and returned early —
// the move (and runDM) never executed, so the player stayed at the source.

import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { inputDisabled, narrativeLines } from '../lib/stores/gameStore';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type {
  EncounterDefinition, GameEvent, GameState, LocationNode, PlayerAction, RegionIndex, Thought,
} from '../lib/types';

const SOURCE_ID = 'delth_dormitory_public_bathroom';
const DEST_ID   = 'delth_dormitory_room';

class ScriptedClient implements ILLMClient {
  /** DM Phase 1 move target to return (free-text path only). */
  phase1Move: string | null = null;
  phase1Calls = 0;

  async complete(systemPrompt: string): Promise<string> {
    if (systemPrompt.includes('action validator')) {
      // Regulator classifies the free-text input as a move (matches real trace from Bernie).
      return JSON.stringify({
        category: 'action', allowed: true, reason: null, modifiedInput: null,
        actionType: 'move', targetId: null, restMinutes: null,
      });
    }
    if (systemPrompt.includes('planning layer')) {
      this.phase1Calls++;
      return JSON.stringify({ narrativeSummary: '(move)', move: this.phase1Move, timeMinutes: 5 });
    }
    if (systemPrompt.includes('You are the Judge')) {
      return JSON.stringify({ move: this.phase1Move, timeMinutes: 5, reasoning: '' });
    }
    return JSON.stringify({});
  }

  async *stream(_systemPrompt: string, messages: { role: 'user' | 'assistant'; content: string }[]): AsyncGenerator<string> {
    const prompt = messages[0]?.content ?? '';
    if (prompt.includes('## World Event')) {
      yield '[event-narration]';
      return;
    }
    yield '[move-narration]';
  }
}

function loc(id: string, name: string, connections: LocationNode['base']['connections'], eventIds: string[] = []): LocationNode {
  return {
    id, name, regionId: 'crambell', tags: [],
    base: { description: name + '。', ambience: [], connections, npcIds: [], eventIds, isAccessible: true },
    localVariants: [],
  };
}

function makeLocations(eventOnSource: boolean, eventOnDest: boolean): Record<string, LocationNode> {
  return {
    [SOURCE_ID]: loc(SOURCE_ID, '公共盥洗空間', [
      { targetLocationId: DEST_ID, description: '回寢室' },
    ], eventOnSource ? ['test_event'] : []),
    [DEST_ID]: loc(DEST_ID, '寢室', [
      { targetLocationId: SOURCE_ID, description: '去盥洗室' },
    ], eventOnDest ? ['test_event'] : []),
  };
}

function makeRegion(): RegionIndex {
  return {
    id: 'crambell', name: 'Crambell', theme: 'test',
    locationIds: [SOURCE_ID, DEST_ID], npcIds: [], questIds: [], factionIds: [],
  };
}

function makeEvent(): GameEvent {
  return {
    id: 'test_event',
    name: '測試事件',
    description: '必觸發的測試事件。',
    condition: { triggerChance: 1 },
    outcomes: [{ id: 'out', description: '觸發。', startEncounterId: 'test_encounter' }],
    isRepeatable: false,
    notification: false,
  };
}

function makeEncounter(): EncounterDefinition {
  return {
    id: 'test_encounter',
    name: '測試遭遇',
    type: 'event',
    description: '測試用遭遇。',
    entryNodeId: 'n1',
    nodes: { n1: { id: 'n1', dmNarrative: '遭遇開場。', isOutcome: true, outcomeType: 'neutral' } },
  };
}

type Internals = {
  state: {
    getState: () => GameState;
    movePlayer: (id: string) => void;
    flags: { set: (id: string) => void };
  };
  buildBaseThoughts: (gs: GameState) => Thought[];
};

async function setup(client: ScriptedClient, eventOnSource: boolean, eventOnDest: boolean) {
  const controller = new GameController({ dm: client, regulator: client });
  controller.loadLore({
    locations: makeLocations(eventOnSource, eventOnDest),
    regions: { crambell: makeRegion() },
    events: { test_event: makeEvent() },
    encounters: { test_encounter: makeEncounter() },
  });
  await controller.start('Tester');
  const internals = controller as unknown as Internals;
  internals.state.movePlayer(SOURCE_ID);
  // Bypass the Day-0 event suppression guard so the location sweep is active.
  internals.state.flags.set('game_day1_started');
  return { controller, internals };
}

describe('GameController deferred location/global events for move actions', () => {
  beforeEach(() => {
    inputDisabled.set(false);
  });

  it('direct move: departure-location event does not intercept the move; player arrives', async () => {
    const client = new ScriptedClient();
    const { controller, internals } = await setup(client, /* eventOnSource */ true, /* eventOnDest */ false);

    const thoughts = internals.buildBaseThoughts(internals.state.getState());
    const toRoom = thoughts.find(t => t.actionType === 'move' && t.targetId === DEST_ID);
    expect(toRoom).toBeTruthy();

    await controller.submitAction(toRoom!.text, toRoom!.actionType, toRoom!.targetId);

    const gs = internals.state.getState();
    expect(gs.player.currentLocationId).toBe(DEST_ID);
    // The departure event must not have fired (no encounter started, flag not consumed).
    expect(gs.activeEncounter).toBeFalsy();
  });

  it('direct move: destination-location event fires after arrival, not before', async () => {
    const client = new ScriptedClient();
    const { controller, internals } = await setup(client, /* eventOnSource */ false, /* eventOnDest */ true);

    const thoughts = internals.buildBaseThoughts(internals.state.getState());
    const toRoom = thoughts.find(t => t.actionType === 'move' && t.targetId === DEST_ID);
    await controller.submitAction(toRoom!.text, toRoom!.actionType, toRoom!.targetId);

    const gs = internals.state.getState();
    expect(gs.player.currentLocationId).toBe(DEST_ID);
    expect(gs.activeEncounter?.encounterId).toBe('test_encounter');
  });

  it('free-text move: departure-location event does not intercept the move; player arrives', async () => {
    const client = new ScriptedClient();
    client.phase1Move = DEST_ID;
    const { controller, internals } = await setup(client, /* eventOnSource */ true, /* eventOnDest */ false);

    await controller.submitAction('返回房間');

    const gs = internals.state.getState();
    expect(gs.player.currentLocationId).toBe(DEST_ID);
    expect(gs.activeEncounter).toBeFalsy();
  });

  it('free-text move: Phase 2 narrates the move before the event is narrated', async () => {
    const client = new ScriptedClient();
    client.phase1Move = DEST_ID;
    const { controller, internals } = await setup(client, /* eventOnSource */ false, /* eventOnDest */ true);

    await controller.submitAction('返回房間');

    const gs = internals.state.getState();
    expect(gs.player.currentLocationId).toBe(DEST_ID);
    expect(gs.activeEncounter?.encounterId).toBe('test_encounter');

    const lines = get(narrativeLines);
    const moveIdx  = lines.findIndex(l => l.text.includes('[move-narration]'));
    const eventIdx = lines.findIndex(l => l.text.includes('[event-narration]'));
    expect(moveIdx).toBeGreaterThanOrEqual(0);
    expect(eventIdx).toBeGreaterThan(moveIdx);
  });
});
