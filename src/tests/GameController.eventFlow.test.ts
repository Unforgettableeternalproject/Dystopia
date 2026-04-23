import { describe, expect, it } from 'vitest';
import { GameController } from '../lib/engine/GameController';
import type { ILLMClient } from '../lib/ai/ILLMClient';
import type { GameEvent, LocationNode, QuestDefinition, RegionIndex, RegionSchedule, PropNode } from '../lib/types';

class ScriptedClient implements ILLMClient {
  async complete(systemPrompt: string): Promise<string> {
    // DM Phase 1 (narrateIntent) — return timeMinutes so long sleep crosses hour boundaries.
    // Initial time is 21:23; clamp is 480 min → ends at 05:23, crossing hours 22,23,0,1,2,3,4,5.
    // Event must use one of those hours (e.g. 1) to fire correctly.
    if (systemPrompt.includes('planning layer')) {
      return JSON.stringify({ timeMinutes: 540 });
    }
    // Regulator validation response
    return JSON.stringify({
      allowed: true,
      reason: null,
      modifiedInput: null,
      actionType: null,
      targetId: null,
    });
  }

  async *stream(_systemPrompt: string, messages: { role: 'user' | 'assistant'; content: string }[]): AsyncGenerator<string> {
    const prompt = messages[0]?.content ?? '';

    if (prompt.includes('## World Event')) {
      yield '事件在時段切換後發生。';
      return;
    }

    // Time is now sourced from DM Phase 1 timeMinutes, not stream narration
    yield '你睡過了整個夜晚。';
  }
}

function makeLocation(): LocationNode {
  return {
    id: 'delth_dormitory_room',
    name: 'Dorm Room',
    regionId: 'crambell',
    tags: [],
    base: {
      description: 'A bunk room.',
      ambience: [],
      connections: [],
      npcIds: [],
      eventIds: [],
      propIds: ['dorm_bed'],
      isAccessible: true,
    },
    localVariants: [],
  };
}

function makeRegion(): RegionIndex {
  return {
    id: 'crambell',
    name: 'Crambell',
    theme: 'test',
    locationIds: ['delth_dormitory_room'],
    npcIds: [],
    questIds: ['mvp_event_quest'],
    factionIds: [],
    globalEventIds: ['mvp_shift_change_event'],
  };
}

function makeSchedule(): RegionSchedule {
  return {
    regionId: 'crambell',
    periods: [
      { id: 'work', label: 'Work', startHour: 6, startMinute: 0, endHour: 18, endMinute: 0 },
      { id: 'rest', label: 'Rest', startHour: 18, startMinute: 0, endHour: 6, endMinute: 0 },
    ],
  };
}

function makeQuest(): QuestDefinition {
  return {
    id: 'mvp_event_quest',
    name: 'MVP Event Quest',
    type: 'side',
    source: 'event',
    entryStageId: 'stage_1',
    autoAccept: true,
    stages: {
      stage_1: {
        id: 'stage_1',
        description: 'Granted by a timed event.',
        objectives: [{ id: 'obj_1', type: 'flag_check', description: 'Wait', flag: 'never_set' }],
        onComplete: { nextStageId: null },
      },
    },
  };
}

function makeProp(): PropNode {
  return {
    id: 'dorm_bed',
    name: 'Bunk Bed',
    description: 'A simple bunk bed.',
    restPoint: true,
  };
}

function makeEvent(): GameEvent {
  return {
    id: 'mvp_shift_change_event',
    name: 'Shift Change',
    description: 'Crossing into the next work period grants a quest.',
    condition: { triggerHours: [1] },
    outcomes: [{ id: 'grant_quest', description: 'Quest granted.', grantQuestId: 'mvp_event_quest' }],
    isRepeatable: true,
    notification: false,
  };
}

describe('GameController event flow', () => {
  it('processes delayed timed events after DM-signaled long time jumps', async () => {
    const client = new ScriptedClient();
    const controller = new GameController({ dm: client, regulator: client });

    controller.loadLore({
      locations: { delth_dormitory_room: makeLocation() },
      regions: { crambell: makeRegion() },
      schedules: { crambell: makeSchedule() },
      quests: { mvp_event_quest: makeQuest() },
      events: { mvp_shift_change_event: makeEvent() },
      props: { dorm_bed: makeProp() },
    });

    await controller.submitAction('睡到白天', 'rest');

    const activeQuests = (controller as unknown as { state: { getState: () => { activeQuests: Record<string, unknown> } } })
      .state.getState().activeQuests;

    expect(activeQuests).toHaveProperty('mvp_event_quest');
  });
});
