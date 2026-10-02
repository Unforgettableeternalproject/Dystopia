// GameController.unsavedChanges.test.ts
//
// 關閉視窗的未儲存提示：只有「上次存檔之後狀態有變更」才提示。
// 基準時機：手動存檔、自動存檔、讀檔完成、新遊戲開場完成。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameController } from '../lib/engine/GameController';
import type { StateManager } from '../lib/engine/StateManager';
import { inputDisabled, thoughts } from '../lib/stores/gameStore';
import type { ChatMessage, ILLMClient } from '../lib/ai/ILLMClient';
import type { LocationNode, RegionIndex } from '../lib/types';

// 以記憶體取代存檔 I/O（測試環境沒有 Tauri 與 localStorage），編解碼沿用真實 SaveCodec
const memSlots = new Map<number, string>();
vi.mock('../lib/utils/SaveManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/utils/SaveManager')>();
  const codec  = await import('../lib/utils/SaveCodec');
  return {
    ...actual,
    saveSlot: async (slotId: number, gs: Parameters<typeof codec.encode>[0], flags: string[]) => {
      memSlots.set(slotId, await codec.encode(gs, flags));
    },
    loadSlot: async (slotId: number) => {
      const data = memSlots.get(slotId);
      if (!data) throw new Error(`Save slot ${slotId} is empty`);
      return codec.decode(data);
    },
  };
});

class StubClient implements ILLMClient {
  async complete(systemPrompt: string): Promise<string> {
    if (systemPrompt.includes('action validator')) {
      return JSON.stringify({ allowed: true, reason: null, modifiedInput: null, actionType: null, targetId: null });
    }
    if (systemPrompt.includes('planning layer')) {
      return JSON.stringify({
        narrativeSummary: 'look', timeMinutes: 5,
        flagsSet: [], flagsUnset: [], encounter: null, suggestions: [],
      });
    }
    if (systemPrompt.includes('You are the Judge')) {
      return JSON.stringify({ move: null, timeMinutes: 1, flagsSet: [], flagsUnset: [], encounter: null, reasoning: '' });
    }
    return JSON.stringify({});
  }

  async *stream(_systemPrompt: string, _messages: ChatMessage[]): AsyncGenerator<string> {
    yield '你環顧四周。';
  }
}

const room: LocationNode = {
  id: 'dorm_room', name: '寢室', regionId: 'crambell', tags: [],
  base: { description: '寢室。', ambience: [], connections: [], npcIds: [], eventIds: [], isAccessible: true },
  localVariants: [],
};

const region: RegionIndex = {
  id: 'crambell', name: 'Crambell', theme: 'test',
  locationIds: ['dorm_room'], npcIds: [], questIds: [], factionIds: [], globalEventIds: [],
};

async function makeController(): Promise<GameController> {
  const client = new StubClient();
  const controller = new GameController({ dm: client, regulator: client });
  controller.loadLore({ locations: { dorm_room: room }, regions: { crambell: region } });
  const sm = (controller as unknown as { state: StateManager }).state;
  sm.movePlayer('dorm_room');
  await controller.start('Tester');
  return controller;
}

describe('關閉提示：上次存檔後是否有變更', () => {
  beforeEach(() => {
    memSlots.clear();
    inputDisabled.set(false);
    thoughts.set([]);
  });

  it('新遊戲開場後未行動 → 不提示', async () => {
    const c = await makeController();
    expect(c.hasUnsavedChanges()).toBe(false);
  });

  it('新遊戲後做一個行動 → 提示', async () => {
    const c = await makeController();
    await c.submitAction('環顧四周');
    expect(c.hasUnsavedChanges()).toBe(true);
  });

  it('手動存檔後無變更 → 不提示；存檔後做一個行動 → 提示', async () => {
    const c = await makeController();
    await c.submitAction('環顧四周');
    await c.save(1);
    expect(c.hasUnsavedChanges()).toBe(false);

    await c.submitAction('再看一次');
    expect(c.hasUnsavedChanges()).toBe(true);
  });

  it('自動存檔後 → 不提示', async () => {
    const c = await makeController();
    await c.submitAction('環顧四周');
    expect(c.hasUnsavedChanges()).toBe(true);
    await c.autoSave();
    expect(memSlots.has(0)).toBe(true);
    expect(c.hasUnsavedChanges()).toBe(false);
  });

  it('讀檔後 → 不提示', async () => {
    const c = await makeController();
    await c.submitAction('環顧四周');
    await c.save(2);
    await c.submitAction('再看一次');
    expect(c.hasUnsavedChanges()).toBe(true);

    await c.load(2);
    expect(c.hasUnsavedChanges()).toBe(false);
  });
});
