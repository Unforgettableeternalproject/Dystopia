// GameController.questSummary.test.ts
//
// Tests for canDitch / ditchBeneficiaryFactionId surfaced in PlayerUIState
// via GameController.syncUIState().
// Covers:
//   - canDitch=false (default) quest shows canDitch:false in summary
//   - canDitch=true quest shows canDitch:true in summary
//   - ditchBeneficiaryFactionId propagates when present
//   - ditchBeneficiaryFactionId absent when not set

import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { playerUI } from '../lib/stores/gameStore';
import type { ILLMClient, ChatMessage } from '../lib/ai/ILLMClient';
import type { LocationNode, RegionIndex } from '../lib/types';
import type { QuestDefinition } from '../lib/types/quest';
import type { StateManager } from '../lib/engine/StateManager';

// ── Minimal no-op LLM client ─────────────────────────────────────────────────

class NoopClient implements ILLMClient {
  async complete(_sys: string, _msg: string): Promise<string> {
    return JSON.stringify({ allowed: true, reason: null, modifiedInput: null, actionType: null, targetId: null });
  }
  async *stream(_sys: string, _msgs: ChatMessage[]): AsyncGenerator<string> { /* no-op */ }
}

// ── Minimal lore fixtures ─────────────────────────────────────────────────────

function makeLocation(): LocationNode {
  return {
    id: 'test_loc',
    name: 'Test Location',
    regionId: 'test_region',
    tags: [],
    base: {
      description: 'A test room.',
      ambience: [],
      connections: [],
      npcIds: [],
      eventIds: [],
      propIds: [],
      isAccessible: true,
    },
    localVariants: [],
  };
}

function makeRegion(): RegionIndex {
  return {
    id: 'test_region',
    name: 'Test Region',
    theme: 'test',
    locationIds: ['test_loc'],
    npcIds: [],
    questIds: [],
    factionIds: [],
    globalEventIds: [],
  };
}

// ── Quest fixtures ────────────────────────────────────────────────────────────

const QUEST_NO_DITCH: QuestDefinition = {
  id: 'q_no_ditch', name: '普通任務', type: 'side', source: 'npc',
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '普通目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '完成旗標', flag: 'done' }],
      onComplete: { nextStageId: null },
    },
  },
};

const QUEST_DITCH_NO_BENEFICIARY: QuestDefinition = {
  id: 'q_ditch_plain', name: '可背叛任務', type: 'side', source: 'npc',
  canDitch: true,
  ditchConsequences: { reputationChanges: { faction_x: -15 } },
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '背叛目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '完成旗標', flag: 'done' }],
      onComplete: { nextStageId: null },
    },
  },
};

const QUEST_DITCH_WITH_BENEFICIARY: QuestDefinition = {
  id: 'q_ditch_betray', name: '可出賣任務', type: 'side', source: 'npc',
  canDitch: true,
  ditchConsequences: {
    reputationChanges: { faction_resistance: -30 },
    beneficiaryFactionId: 'faction_gov',
  },
  entryStageId: 's1',
  stages: {
    s1: {
      id: 's1', description: '出賣目標',
      objectives: [{ id: 'obj1', type: 'flag_check', description: '完成旗標', flag: 'done' }],
      onComplete: { nextStageId: null },
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeController(quests: QuestDefinition[] = []): GameController {
  const client = new NoopClient();
  const gc = new GameController({ dm: client, regulator: client });
  gc.loadLore({
    locations: { test_loc: makeLocation() },
    regions:   { test_region: makeRegion() },
    quests:    Object.fromEntries(quests.map(q => [q.id, q])),
  });
  return gc;
}

function stateOf(gc: GameController): StateManager {
  return (gc as unknown as { state: StateManager }).state;
}

function questsOf(gc: GameController): { grantQuest: (id: string) => boolean } {
  return (gc as unknown as { quests: { grantQuest: (id: string) => boolean } }).quests;
}

function syncUI(gc: GameController): void {
  const gs = stateOf(gc).getState();
  (gc as unknown as { syncUIState: (gs: unknown) => void }).syncUIState(gs);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GameController quest summary canDitch', () => {
  it('canDitch 未設定的任務 — summary 中 canDitch 為 false', () => {
    const gc = makeController([QUEST_NO_DITCH]);
    questsOf(gc).grantQuest('q_no_ditch');
    syncUI(gc);

    const summaries = get(playerUI).allActiveQuestSummaries ?? [];
    const summary = summaries.find(s => s.questId === 'q_no_ditch');
    expect(summary).toBeDefined();
    expect(summary!.canDitch).toBe(false);
    expect(summary!.ditchBeneficiaryFactionId).toBeUndefined();
  });

  it('canDitch=true 的任務 — summary 中 canDitch 為 true', () => {
    const gc = makeController([QUEST_DITCH_NO_BENEFICIARY]);
    questsOf(gc).grantQuest('q_ditch_plain');
    syncUI(gc);

    const summaries = get(playerUI).allActiveQuestSummaries ?? [];
    const summary = summaries.find(s => s.questId === 'q_ditch_plain');
    expect(summary).toBeDefined();
    expect(summary!.canDitch).toBe(true);
    expect(summary!.ditchBeneficiaryFactionId).toBeUndefined();
  });

  it('有 beneficiaryFactionId — ditchBeneficiaryFactionId 出現在 summary', () => {
    const gc = makeController([QUEST_DITCH_WITH_BENEFICIARY]);
    questsOf(gc).grantQuest('q_ditch_betray');
    syncUI(gc);

    const summaries = get(playerUI).allActiveQuestSummaries ?? [];
    const summary = summaries.find(s => s.questId === 'q_ditch_betray');
    expect(summary).toBeDefined();
    expect(summary!.canDitch).toBe(true);
    expect(summary!.ditchBeneficiaryFactionId).toBe('faction_gov');
  });
});
