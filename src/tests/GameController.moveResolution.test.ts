import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { inputDisabled, playerUI } from '../lib/stores/gameStore';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type { LocationNode, RegionIndex } from '../lib/types';

class MoveResolutionClient implements ILLMClient {
  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    if (systemPrompt.includes('action validator')) {
      return JSON.stringify({
        allowed: true,
        reason: null,
        modifiedInput: null,
        actionType: null,
        targetId: null,
      });
    }

    if (systemPrompt.includes('planning layer')) {
      if (userMessage.includes('(game start)')) {
        return JSON.stringify({
          narrativeSummary: 'Player wakes up in the dorm room.',
          timeMinutes: 1,
          flagsSet: [],
          flagsUnset: [],
          encounter: null,
        });
      }

      if (userMessage.includes('Destination: [delth_dormitory_gate]')) {
        return JSON.stringify({
          narrativeSummary: 'Player follows the dorm route all the way to the outer gate.',
          move: 'delth_dormitory_gate',
          timeMinutes: 9,
          flagsSet: [],
          flagsUnset: [],
          encounter: null,
        });
      }

      return JSON.stringify({
        narrativeSummary: 'Player heads from the dorm room into the common area.',
        move: 'delth_dormitory_common',
        timeMinutes: 5,
        flagsSet: [],
        flagsUnset: [],
        encounter: null,
      });
    }

    if (systemPrompt.includes('You are the Judge')) {
      if (userMessage.includes('(game start)')) {
        return JSON.stringify({
          move: null,
          timeMinutes: 1,
          flagsSet: [],
          flagsUnset: [],
          encounter: null,
          reasoning: '',
        });
      }

      if (userMessage.includes('delth_dormitory_gate')) {
        return JSON.stringify({
          move: 'delth_dormitory_gate',
          timeMinutes: 9,
          flagsSet: [],
          flagsUnset: [],
          encounter: null,
          reasoning: '',
        });
      }

      return JSON.stringify({
        move: 'delth_dormitory_common',
        timeMinutes: 5,
        flagsSet: [],
        flagsUnset: [],
        encounter: null,
        reasoning: '',
      });
    }

    return JSON.stringify({});
  }

  async *stream(
    _systemPrompt: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
  ): AsyncGenerator<string> {
    const prompt = messages[0]?.content ?? '';
    if (prompt.includes('(game start)')) {
      yield 'You wake in the dorm room.';
      return;
    }

    if (prompt.includes('Dorm Gate')) {
      yield 'You make your way through the dorm block and reach the outer gate.';
      return;
    }

    yield 'You step out of the dorm room and into the shared common area.';
  }
}

function makeDormitory(): LocationNode {
  return {
    id: 'delth_dormitory',
    name: 'Dormitory',
    regionId: 'crambell',
    tags: [],
    locationType: 'area',
    base: {
      description: 'Worker dormitory block.',
      ambience: [],
      connections: [],
      npcIds: [],
      eventIds: [],
      isAccessible: true,
    },
    localVariants: [],
    sublocations: [
      {
        id: 'delth_dormitory_room',
        name: 'Dorm Room',
        regionId: 'crambell',
        tags: [],
        base: {
          description: 'A cramped dorm room.',
          ambience: [],
          connections: [{ targetLocationId: 'delth_dormitory_common', description: 'Common Area', traverseTime: 5 }],
          npcIds: [],
          eventIds: [],
          isAccessible: true,
        },
        localVariants: [],
      },
      {
        id: 'delth_dormitory_common',
        name: 'Dorm Common',
        regionId: 'crambell',
        tags: [],
        base: {
          description: 'A dimly lit shared common area.',
          ambience: [],
          connections: [
            { targetLocationId: 'delth_dormitory_room', description: 'Dorm Room', traverseTime: 5 },
            { targetLocationId: 'delth_dormitory_gate', description: 'Dorm Gate', traverseTime: 4 },
          ],
          npcIds: [],
          eventIds: [],
          isAccessible: true,
        },
        localVariants: [],
      },
      {
        id: 'delth_dormitory_gate',
        name: 'Dorm Gate',
        regionId: 'crambell',
        tags: [],
        base: {
          description: 'The outer gate of the dormitory block.',
          ambience: [],
          connections: [{ targetLocationId: 'delth_dormitory_common', description: 'Dorm Common', traverseTime: 4 }],
          npcIds: [],
          eventIds: [],
          isAccessible: true,
        },
        localVariants: [],
      },
    ],
  };
}

function makeRegion(): RegionIndex {
  return {
    id: 'crambell',
    name: 'Crambell',
    theme: 'test',
    locationIds: ['delth_dormitory'],
    npcIds: [],
    questIds: [],
    factionIds: [],
  };
}

describe('GameController move resolution', () => {
  beforeEach(() => {
    inputDisabled.set(false);
  });

  it('applies a Judge-approved move even when the raw submitted action started as free', async () => {
    const client = new MoveResolutionClient();
    const controller = new GameController({ dm: client, regulator: client });

    controller.loadLore({
      locations: { delth_dormitory: makeDormitory() },
      regions: { crambell: makeRegion() },
    });

    await controller.start('Tester');
    await controller.submitAction('Walk into the common area');

    const state = (controller as unknown as {
      state: { getState: () => { player: { currentLocationId: string } } };
    }).state.getState();

    expect(state.player.currentLocationId).toBe('delth_dormitory_common');

    const miniMap = get(playerUI).miniMap;
    expect(get(playerUI).location).toBe('Dorm Common');
    expect(miniMap?.nodes.find(node => node.id === 'delth_dormitory_common')?.isCurrent).toBe(true);
    expect(miniMap?.nodes.find(node => node.id === 'delth_dormitory_room')?.isCurrent).toBe(false);
  });

  it('builds multi-hop navigation for a raw free-text move to a discovered distant location', async () => {
    const client = new MoveResolutionClient();
    const controller = new GameController({ dm: client, regulator: client });

    controller.loadLore({
      locations: { delth_dormitory: makeDormitory() },
      regions: { crambell: makeRegion() },
    });

    await controller.start('Tester');

    const stateManager = (controller as unknown as {
      state: {
        discoverLocation: (locationId: string) => void;
        getState: () => { player: { currentLocationId: string } };
      };
    }).state;

    stateManager.discoverLocation('delth_dormitory_common');
    stateManager.discoverLocation('delth_dormitory_gate');

    await controller.submitAction('Go to Dorm Gate');

    expect(stateManager.getState().player.currentLocationId).toBe('delth_dormitory_gate');
    expect(get(playerUI).location).toBe('Dorm Gate');
    expect(get(playerUI).miniMap?.nodes.find(node => node.id === 'delth_dormitory_gate')?.isCurrent).toBe(true);
  });
});
