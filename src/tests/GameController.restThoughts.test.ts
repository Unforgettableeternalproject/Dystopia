import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { inputDisabled, restModalOpen, thoughts } from '../lib/stores/gameStore';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type { LocationNode, RegionIndex } from '../lib/types';

/**
 * 模擬 LLM：休息敘述（system prompt 要求 <<THOUGHTS>>）依 restThoughtsLine 回傳候選；
 * 其餘路徑回傳最小合法回應。
 */
class RestClient implements ILLMClient {
  constructor(private restThoughtsLine: string | null) {}

  async complete(systemPrompt: string): Promise<string> {
    if (systemPrompt.includes('action validator')) {
      return JSON.stringify({ allowed: true, reason: null, modifiedInput: null, actionType: null, targetId: null });
    }
    if (systemPrompt.includes('planning layer')) {
      return JSON.stringify({ narrativeSummary: 'start', timeMinutes: 1, flagsSet: [], flagsUnset: [], encounter: null });
    }
    if (systemPrompt.includes('You are the Judge')) {
      return JSON.stringify({ move: null, timeMinutes: 1, flagsSet: [], flagsUnset: [], encounter: null, reasoning: '' });
    }
    return JSON.stringify({});
  }

  async *stream(systemPrompt: string): AsyncGenerator<string> {
    if (systemPrompt.includes('<<THOUGHTS')) {
      yield '你在床鋪上醒來，窗外的燈光已經換了顏色。';
      if (this.restThoughtsLine !== null) yield '\n' + this.restThoughtsLine;
      return;
    }
    yield '你在宿舍裡醒來。';
  }
}

function makeLocations(): Record<string, LocationNode> {
  return {
    dorm: {
      id: 'dorm',
      name: '宿舍',
      regionId: 'crambell',
      tags: [],
      locationType: 'area',
      base: { description: '宿舍區。', ambience: [], connections: [], npcIds: [], eventIds: [], isAccessible: true },
      localVariants: [],
      sublocations: [
        {
          id: 'dorm_room',
          name: '寢室',
          regionId: 'crambell',
          tags: [],
          base: {
            description: '狹窄的寢室。',
            ambience: [],
            connections: [{ targetLocationId: 'dorm_gate', description: '返回宿舍大門', traverseTime: 3 }],
            npcIds: [],
            eventIds: [],
            isAccessible: true,
          },
          localVariants: [],
        },
        {
          id: 'dorm_gate',
          name: '宿舍大門',
          regionId: 'crambell',
          tags: [],
          base: {
            description: '宿舍外門。',
            ambience: [],
            connections: [{ targetLocationId: 'dorm_room', description: '回到寢室', traverseTime: 3 }],
            npcIds: [],
            eventIds: [],
            isAccessible: true,
          },
          localVariants: [],
        },
      ],
    },
  };
}

const region: RegionIndex = {
  id: 'crambell', name: 'Crambell', theme: 'test',
  locationIds: ['dorm'], npcIds: [], questIds: [], factionIds: [],
};

async function makeController(restThoughtsLine: string | null): Promise<GameController> {
  const client = new RestClient(restThoughtsLine);
  const controller = new GameController({ dm: client, regulator: client });
  controller.loadLore({ locations: makeLocations(), regions: { crambell: region } });
  const sm = (controller as unknown as { state: { movePlayer: (id: string) => void } }).state;
  sm.movePlayer('dorm_room');
  await controller.start('Tester');
  return controller;
}

function thoughtTexts(): string[] {
  return get(thoughts).map(t => t.text);
}

describe('休息後的想法候選', () => {
  beforeEach(() => {
    inputDisabled.set(false);
    thoughts.set([]);
    restModalOpen.set(null);
  });

  it('休息敘述完成後，候選來自 LLM 的 <<THOUGHTS>> 訊號', async () => {
    const controller = await makeController('<<THOUGHTS: 起身伸展筋骨 | 看看現在幾點 | 走去公共區>>');
    controller.executeRest(60);
    await controller.narrateRestResult();

    expect(thoughtTexts()).toEqual(['起身伸展筋骨', '看看現在幾點', '走去公共區']);
  });

  it('LLM 未提供 <<THOUGHTS>> 時，fallback 為繁體中文且無英文前綴', async () => {
    const controller = await makeController(null);
    controller.executeRest(60);
    await controller.narrateRestResult();

    const texts = thoughtTexts();
    expect(texts[0]).toBe('觀察四周');
    expect(texts).toContain('前往：返回宿舍大門');
    for (const t of texts) {
      expect(t).not.toMatch(/Observe|Go to|Talk to|Find somewhere/);
    }
  });

  it('<<THOUGHTS>> 格式錯誤（無法解析）時落入中文 fallback', async () => {
    const controller = await makeController('<<THOUGHTS 少了冒號>>');
    controller.executeRest(60);
    await controller.narrateRestResult();

    expect(thoughtTexts()[0]).toBe('觀察四周');
  });

  it('取消休息後，候選同樣來自 LLM', async () => {
    const controller = await makeController('<<THOUGHTS: 坐回床邊 | 整理口袋>>');
    await controller.cancelRest();

    expect(thoughtTexts()).toEqual(['坐回床邊', '整理口袋']);
  });

  it('不會把 <<THOUGHTS>> 訊號寫進敘事歷史', async () => {
    const controller = await makeController('<<THOUGHTS: 起身 | 出門>>');
    controller.executeRest(60);
    await controller.narrateRestResult();

    const history = (controller as unknown as {
      state: { getState: () => { history: { narrative: string }[] } };
    }).state.getState().history;
    expect(history[history.length - 1].narrative).not.toContain('<<');
  });
});

describe('休息 Modal 預填時長', () => {
  beforeEach(() => {
    restModalOpen.set(null);
  });

  function setFatigue(controller: GameController, value: number): void {
    const sm = (controller as unknown as {
      state: { getState: () => { player: { statusStats: { fatigue?: number } } } };
    }).state;
    (sm.getState().player.statusStats as { fatigue?: number }).fatigue = value;
  }

  it('短眠情境下「休息半小時」預填 30 分鐘', async () => {
    const controller = await makeController(null);
    setFatigue(controller, 5);
    expect(controller.openRestModal('休息半小時')).toBe(true);
    expect(get(restModalOpen)?.presetMinutes).toBe(30);
  });

  it('短眠情境下超出上限的「睡五個小時」不預填', async () => {
    const controller = await makeController(null);
    setFatigue(controller, 5);
    controller.openRestModal('繼續睡覺五個小時');
    expect(get(restModalOpen)).not.toBeNull();
    expect(get(restModalOpen)?.presetMinutes).toBeUndefined();
  });

  it('未提供輸入時不預填', async () => {
    const controller = await makeController(null);
    setFatigue(controller, 5);
    controller.openRestModal();
    expect(get(restModalOpen)?.presetMinutes).toBeUndefined();
  });
});
