import { describe, expect, it } from 'vitest';
import { LoreVault } from '../lib/lore/LoreVault';
import { StateManager } from '../lib/engine/StateManager';
import { EventBus } from '../lib/engine/EventBus';
import { GameController } from '../lib/engine/GameController';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type { GameState, ItemNode, InventoryItem } from '../lib/types';
import { parseItemGrantString } from '../lib/utils/itemGrantParser';

function makeBaseItem(): ItemNode {
  return {
    id: 'generic_note',
    name: '字條',
    description: '一張折起來的紙條。',
    type: 'info',
    content: '',
    isTemplate: true,
  };
}

function makeState(): GameState {
  return {
    player: {
      id: 'test', name: 'Tester', origin: 'worker',
      currentLocationId: 'loc_a',
      primaryStats:       { strength: 1, knowledge: 1, talent: 1, spirit: 1, luck: 1 },
      primaryStatsExp:    { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      inclinationTracker: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
      dailyGrantTracker:  { dateKey: '1498-6-12', grantedExp: {} },
      secondaryStats: { consciousness: 0, mysticism: 0, technology: 0 },
      statusStats: { stamina: 10, staminaMax: 10, stress: 0, stressMax: 10, endo: 0, endoMax: 0, experience: 0, fatigue: 0 },
      externalStats: { reputation: {}, affinity: {}, familiarity: {} },
      inventory: [], melphin: 0, activeFlags: new Set(), titles: [], conditions: [], knownIntelIds: [],
    },
    turn: 1, phase: 'exploring',
    worldPhase: { currentPhase: 'phase_1', appliedPhaseIds: [] },
    pendingThoughts: [], lastNarrative: '', history: [],
    discoveredLocationIds: ['loc_a'], activeQuests: {}, completedQuestIds: [],
    npcMemory: {},
    time: { year: 1498, month: 6, day: 12, hour: 21, minute: 23, totalMinutes: 100 },
    timePeriod: 'rest', eventCooldowns: {}, eventCounters: {}, attemptCooldowns: {},
    propFlags: {},
  };
}

describe('Item Template (isTemplate)', () => {
  it('resolveItemDisplay: overrides take priority over base', () => {
    const vault = new LoreVault();
    vault.load({ items: { generic_note: makeBaseItem() } });

    const inv: InventoryItem = {
      instanceId: 'note_1',
      itemId: 'generic_note',
      itemOverrides: {
        name: '夾在床板下的字條',
        content: '不要在換班鐘響後留在走廊。',
      },
      obtainedAtMinute: 100,
      quantity: 1,
      isExpired: false,
    };

    const display = vault.resolveItemDisplay(inv);
    expect(display.name).toBe('夾在床板下的字條');
    expect(display.description).toBe('一張折起來的紙條。'); // fallback to base
    expect(display.content).toBe('不要在換班鐘響後留在走廊。');
  });

  it('two instances from same base item have different content', () => {
    const vault = new LoreVault();
    vault.load({ items: { generic_note: makeBaseItem() } });

    const inv1: InventoryItem = {
      instanceId: 'a', itemId: 'generic_note',
      itemOverrides: { content: '內容 A' },
      obtainedAtMinute: 10, quantity: 1, isExpired: false,
    };
    const inv2: InventoryItem = {
      instanceId: 'b', itemId: 'generic_note',
      itemOverrides: { content: '內容 B' },
      obtainedAtMinute: 20, quantity: 1, isExpired: false,
    };

    expect(vault.resolveItemDisplay(inv1).content).toBe('內容 A');
    expect(vault.resolveItemDisplay(inv2).content).toBe('內容 B');
  });

  it('non-template item without overrides resolves from base', () => {
    const vault = new LoreVault();
    vault.load({ items: { generic_note: makeBaseItem() } });

    const inv: InventoryItem = {
      instanceId: 'plain', itemId: 'generic_note',
      obtainedAtMinute: 50, quantity: 1, isExpired: false,
    };

    const display = vault.resolveItemDisplay(inv);
    expect(display.name).toBe('字條');
    expect(display.content).toBe('');
  });

  it('addTemplateItem creates unique instances with overrides', () => {
    const sm = new StateManager(makeState(), new EventBus());

    sm.addTemplateItem('generic_note', { content: 'Note A' }, 100);
    sm.addTemplateItem('generic_note', { content: 'Note B' }, 100);

    const inv = sm.getState().player.inventory;
    expect(inv).toHaveLength(2);
    expect(inv[0].itemId).toBe('generic_note');
    expect(inv[1].itemId).toBe('generic_note');
    expect(inv[0].itemOverrides?.content).toBe('Note A');
    expect(inv[1].itemOverrides?.content).toBe('Note B');
    expect(inv[0].instanceId).not.toBe(inv[1].instanceId);
  });

  it('grantTemplateItem rejects non-template base item', () => {
    const client: ILLMClient = {
      complete: async () => '{}',
      stream: async function* () { yield ''; },
    };
    const controller = new GameController({ dm: client, regulator: client });
    controller.loadLore({
      items: {
        generic_note: makeBaseItem(),
        regular_key: { id: 'regular_key', name: 'Key', description: 'A key', type: 'key' } as ItemNode,
      },
    });

    // Template item should succeed
    const ok = controller.grantTemplateItem('generic_note', { content: 'test' });
    expect(ok).toBe(true);

    // Non-template item should be rejected
    const rejected = controller.grantTemplateItem('regular_key', { name: 'Hacked Key' });
    expect(rejected).toBe(false);

    // Key item marked as template should still be rejected
    controller.loadLore({
      items: { key_tmpl: { id: 'key_tmpl', name: 'Key Template', description: '', type: 'key', isTemplate: true } as ItemNode },
    });
    const keyRejected = controller.grantTemplateItem('key_tmpl', { name: 'Fake Key' });
    expect(keyRejected).toBe(false);
  });
});

describe('parseItemGrantString', () => {
  it('plain item ID returns no overrides', () => {
    const result = parseItemGrantString('crambell_work_permit');
    expect(result.itemId).toBe('crambell_work_permit');
    expect(result.overrides).toBeUndefined();
  });

  it('inline overrides are parsed correctly', () => {
    const result = parseItemGrantString('generic_note|name:字條 A|desc:描述|content:內文');
    expect(result.itemId).toBe('generic_note');
    expect(result.overrides?.name).toBe('字條 A');
    expect(result.overrides?.description).toBe('描述');
    expect(result.overrides?.content).toBe('內文');
  });

  it('content with colons is preserved', () => {
    const result = parseItemGrantString('generic_note|content:時間：午夜');
    expect(result.overrides?.content).toBe('時間：午夜');
  });
});
