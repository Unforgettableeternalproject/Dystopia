// 想法候選的移動：帶 targetId 時由引擎直接移動，不經 DM Phase 1 / Judge 猜目的地。
// 回歸情境：在宿舍公共區點「回到寢室」偶爾被 LLM 帶到大門。
import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { inputDisabled, narrativeLines } from '../lib/stores/gameStore';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type { GameState, LocationNode, PlayerAction, RegionIndex, Thought } from '../lib/types';

class CountingClient implements ILLMClient {
  phase1Calls = 0;
  judgeCalls  = 0;

  async complete(systemPrompt: string): Promise<string> {
    if (systemPrompt.includes('action validator')) {
      return JSON.stringify({ allowed: true, reason: null, modifiedInput: null, actionType: null, targetId: null });
    }
    if (systemPrompt.includes('planning layer')) {
      this.phase1Calls++;
      // 模擬 LLM 猜錯：一律導向大門
      return JSON.stringify({ narrativeSummary: 'wrong guess', move: 'delth_dormitory', timeMinutes: 5 });
    }
    if (systemPrompt.includes('You are the Judge')) {
      this.judgeCalls++;
      return JSON.stringify({ move: 'delth_dormitory', timeMinutes: 5, reasoning: '' });
    }
    return JSON.stringify({});
  }

  async *stream(): AsyncGenerator<string> {
    yield '你移動了。';
  }
}

function loc(id: string, name: string, connections: LocationNode['base']['connections'], extra: Partial<LocationNode> = {}): LocationNode {
  return {
    id, name, regionId: 'crambell', tags: [],
    base: { description: name + '。', ambience: [], connections, npcIds: [], eventIds: [], isAccessible: true },
    localVariants: [],
    ...extra,
  };
}

function makeLocations(): Record<string, LocationNode> {
  const dormitory = loc('delth_dormitory', '綜合宿舍區', [
    { targetLocationId: 'street_a', description: '沿街往東', traverseTime: 5 },
    { targetLocationId: 'street_b', description: '沿街往西', traverseTime: 5 },
    { targetLocationId: 'market',   description: '前往市場', traverseTime: 5 },
  ], {
    locationType: 'area',
    sublocations: [
      loc('delth_dormitory_room', '寢室', [
        { targetLocationId: 'delth_dormitory_common', description: '公共區', traverseTime: 2 },
      ]),
      loc('delth_dormitory_common', '公共區', [
        { targetLocationId: 'delth_dormitory_room', description: '回到寢室', traverseTime: 2 },
        {
          targetLocationId: 'delth_dormitory_washroom', description: '盥洗室', traverseTime: 2,
          access: { flag: 'washroom_open', lockedMessage: '盥洗室的門鎖著。' },
        },
      ]),
      loc('delth_dormitory_washroom', '盥洗室', []),
    ],
  });
  // base.name 覆寫：有效顯示名為「宿舍大門」
  dormitory.base.name = '宿舍大門';

  const market = loc('market', '中央市集區', [
    { targetLocationId: 'delth_dormitory', description: '回宿舍', traverseTime: 5 },
  ], { locationType: 'area' });
  market.base.name = '市場入口';

  return {
    delth_dormitory: dormitory,
    street_a: loc('street_a', '東街', [{ targetLocationId: 'delth_dormitory', description: '回宿舍', traverseTime: 5 }]),
    street_b: loc('street_b', '西街', [{ targetLocationId: 'delth_dormitory', description: '回宿舍', traverseTime: 5 }]),
    market,
  };
}

function makeRegion(): RegionIndex {
  return {
    id: 'crambell', name: 'Crambell', theme: 'test',
    locationIds: ['delth_dormitory', 'street_a', 'street_b', 'market'],
    npcIds: [], questIds: [], factionIds: [],
  };
}

type Internals = {
  state: {
    getState: () => GameState;
    movePlayer: (id: string) => void;
    discoverLocation: (id: string) => void;
  };
  buildBaseThoughts: (gs: GameState) => Thought[];
  buildNavHint: (action: PlayerAction) => string;
};

async function setup() {
  const client = new CountingClient();
  const controller = new GameController({ dm: client, regulator: client });
  controller.loadLore({ locations: makeLocations(), regions: { crambell: makeRegion() } });
  await controller.start('Tester');
  const internals = controller as unknown as Internals;
  return { client, controller, internals };
}

describe('GameController direct move from thought candidates', () => {
  beforeEach(() => {
    inputDisabled.set(false);
  });

  it('moves straight to the thought targetId without calling DM Phase 1 or Judge', async () => {
    const { client, controller, internals } = await setup();
    internals.state.movePlayer('delth_dormitory_common');

    const thoughts = internals.buildBaseThoughts(internals.state.getState());
    const backToRoom = thoughts.find(t => t.actionType === 'move' && t.targetId === 'delth_dormitory_room');
    expect(backToRoom?.text).toBe('前往：回到寢室');

    client.phase1Calls = 0;
    client.judgeCalls  = 0;
    await controller.submitAction(backToRoom!.text, backToRoom!.actionType, backToRoom!.targetId);

    expect(internals.state.getState().player.currentLocationId).toBe('delth_dormitory_room');
    expect(client.phase1Calls).toBe(0);
    expect(client.judgeCalls).toBe(0);
  });

  it('blocks a gated targetId with the connection lockedMessage and does not move', async () => {
    const { client, controller, internals } = await setup();
    internals.state.movePlayer('delth_dormitory_common');
    const before = internals.state.getState().time.totalMinutes;

    client.phase1Calls = 0;
    await controller.submitAction('前往：盥洗室', 'move', 'delth_dormitory_washroom');

    expect(internals.state.getState().player.currentLocationId).toBe('delth_dormitory_common');
    expect(internals.state.getState().time.totalMinutes).toBe(before);
    expect(client.phase1Calls).toBe(0);
    const last = get(narrativeLines).at(-1);
    expect(last?.type).toBe('rejected');
    expect(last?.text).toBe('盥洗室的門鎖著。');
  });

  it('keeps free-text moves on the LLM path', async () => {
    const { client, controller } = await setup();
    client.phase1Calls = 0;
    await controller.submitAction('走去公共區');
    expect(client.phase1Calls).toBe(1);
  });

  it('buildNavHint matches and lists locations by effective display name', async () => {
    const { internals } = await setup();
    internals.state.discoverLocation('delth_dormitory');
    internals.state.discoverLocation('market');

    const hint = internals.buildNavHint({ type: 'move', input: '我要去市場入口' });
    expect(hint).toContain('Destination: [market] 市場入口');
    expect(hint).toContain('宿舍大門');
    expect(hint).not.toContain('綜合宿舍區');
    expect(hint).not.toContain('中央市集區');
  });

  it('at the dorm gate, move candidates include entries into the indoor sublocations', async () => {
    const { internals } = await setup();
    internals.state.movePlayer('delth_dormitory');

    const moves = internals.buildBaseThoughts(internals.state.getState()).filter(t => t.actionType === 'move');
    const targets = moves.map(t => t.targetId);
    expect(targets).toEqual(expect.arrayContaining([
      'delth_dormitory_room', 'delth_dormitory_common', 'delth_dormitory_washroom',
    ]));
    expect(moves.length).toBeLessThanOrEqual(4);
    expect(moves.every(t => !!t.targetId)).toBe(true);
  });
});
