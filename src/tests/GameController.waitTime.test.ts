// GameController.waitTime.test.ts
//
// 等待／時間跳轉：時長由 LLM（DM Phase 1）決定，引擎負責
// - 提供時間資訊（行動開始時刻、時段表、門禁、接下來的時間點）
// - 夾限（≤ 720 分鐘）、格式錯誤退回舊行為
// - 長時間等待跨越定時事件時在觸發點截斷（與休息相同），並把實際起訖時刻交給 Phase 2 敘述
// 休息預填：Regulator（LLM）換算的 restMinutes 優先於確定性解析。

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import type { StateManager } from '../lib/engine/StateManager';
import { TimeManager } from '../lib/engine/TimeManager';
import { inputDisabled, restModalOpen, thoughts } from '../lib/stores/gameStore';
import type { ChatMessage, ILLMClient } from '../lib/ai/ILLMClient';
import { Regulator } from '../lib/ai/Regulator';
import { DM_INTENT_PROMPT } from '../lib/ai/prompts/exploration';
import type { GameEvent, GameTime, LocationNode, RegionIndex, RegionSchedule } from '../lib/types';

const REPO_ROOT = new URL('../../', import.meta.url);
const C = 'lore/world/regions/crambell';
function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, REPO_ROOT), 'utf8')) as T;
}

/** 模擬 LLM：DM Phase 1 依 waitMinutes 回傳時長，並記錄所有 prompt 輸入。 */
class WaitClient implements ILLMClient {
  /** Phase 1 回傳的 timeMinutes 原始值（可為非數字以模擬格式錯誤） */
  waitMinutes: unknown = 10;
  /** Regulator 回傳 */
  regulatorReply: Record<string, unknown> = { allowed: true, reason: null, modifiedInput: null, actionType: null, targetId: null };
  intentMessages: string[] = [];
  regulatorMessages: string[] = [];
  streamMessages: string[] = [];

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    if (systemPrompt.includes('action validator')) {
      this.regulatorMessages.push(userMessage);
      return JSON.stringify(this.regulatorReply);
    }
    if (systemPrompt.includes('planning layer')) {
      this.intentMessages.push(userMessage);
      const isStart = userMessage.includes('input: (game start)');
      return JSON.stringify({
        narrativeSummary: 'wait', timeMinutes: isStart ? 1 : this.waitMinutes,
        flagsSet: [], flagsUnset: [], encounter: null, suggestions: [],
      });
    }
    if (systemPrompt.includes('You are the Judge')) {
      return JSON.stringify({ move: null, timeMinutes: 1, flagsSet: [], flagsUnset: [], encounter: null, reasoning: '' });
    }
    return JSON.stringify({});
  }

  async *stream(_systemPrompt: string, messages: ChatMessage[]): AsyncGenerator<string> {
    this.streamMessages.push(messages.map(m => m.content).join('\n'));
    yield '時間慢慢流逝。';
  }
}

function makeLocations(): Record<string, LocationNode> {
  const sub = (id: string, name: string, target: string): LocationNode => ({
    id, name, regionId: 'crambell', tags: [],
    base: {
      description: name + '。', ambience: [],
      connections: [{ targetLocationId: target, description: '前往' + target, traverseTime: 3 }],
      npcIds: [], eventIds: [], isAccessible: true,
    },
    localVariants: [],
  });
  return {
    dorm: {
      id: 'dorm', name: '宿舍', regionId: 'crambell', tags: [], locationType: 'area',
      base: { description: '宿舍區。', ambience: [], connections: [], npcIds: [], eventIds: [], isAccessible: true },
      localVariants: [],
      sublocations: [sub('dorm_room', '寢室', 'dorm_gate'), sub('dorm_gate', '宿舍大門', 'dorm_room')],
    },
  };
}

const region: RegionIndex = {
  id: 'crambell', name: 'Crambell', theme: 'test',
  locationIds: ['dorm'], npcIds: [], questIds: [], factionIds: [],
  globalEventIds: ['crambell_work_period_start'],
};

const timeMgr = new TimeManager();

async function makeController(): Promise<{ controller: GameController; client: WaitClient; sm: StateManager }> {
  const client = new WaitClient();
  const controller = new GameController({ dm: client, regulator: client });
  controller.loadLore({
    locations: makeLocations(),
    regions:   { crambell: region },
    schedules: { crambell: readJson<RegionSchedule>(`${C}/schedule.json`) },
    events:    { crambell_work_period_start: readJson<GameEvent>(`${C}/events/crambell_work_period_start.json`) },
  });
  const sm = (controller as unknown as { state: StateManager }).state;
  sm.movePlayer('dorm_room');
  await controller.start('Tester');
  sm.flags.set('game_day1_started');
  return { controller, client, sm };
}

/** 把時鐘設到隔天 hh:mm（避開起始日） */
function setClock(sm: StateManager, hour: number, minute = 0): GameTime {
  const now = sm.getState().time;
  const target = timeMgr.jumpToHour(now, hour, minute);
  sm.advanceTime(target, hour >= 6 && hour < 18 ? 'work' : 'rest');
  return target;
}

function clock(sm: StateManager): string {
  const t = sm.getState().time;
  return String(t.hour).padStart(2, '0') + ':' + String(t.minute).padStart(2, '0');
}

describe('等待：LLM 決定時長，引擎提供時間資訊與夾限', () => {
  beforeEach(() => {
    inputDisabled.set(false);
    thoughts.set([]);
    restModalOpen.set(null);
  });

  it('Phase 1 prompt 含行動開始時刻、時段表、門禁與接下來的時間點', async () => {
    const { controller, client, sm } = await makeController();
    setClock(sm, 4, 0);
    client.waitMinutes = 120;
    await controller.submitAction('等到六點的工作廣播');

    const msg = client.intentMessages.at(-1)!;
    expect(msg).toContain('Action started at: 04:00');
    expect(msg).toContain('Schedule: 作業時段 06:00–18:00 | 休息時段 18:00–06:00');
    expect(msg).toContain('Curfew (門禁): 23:00–04:00');
    expect(msg).toContain('06:00 作業時段開始 (+120 min)');
  });

  it('04:00「等到六點的工作廣播」→ LLM 回 120 → 時間到 06:00，06:00 事件觸發', async () => {
    const { controller, client, sm } = await makeController();
    setClock(sm, 4, 0);
    client.waitMinutes = 120;
    await controller.submitAction('等到六點的工作廣播');

    expect(clock(sm)).toBe('06:00');
    expect(sm.flags.has('crambell_work_period_active')).toBe(true);
    expect(client.streamMessages.some(m => m.includes('04:00 → 06:00'))).toBe(true);
  });

  it('等待跨越定時事件時在觸發點截斷（480 分鐘 → 停在 06:00），敘述得知實際結束時刻', async () => {
    const { controller, client, sm } = await makeController();
    setClock(sm, 4, 0);
    client.waitMinutes = 480;
    await controller.submitAction('等八個小時');

    expect(clock(sm)).toBe('06:00');
    expect(sm.flags.has('crambell_work_period_active')).toBe(true);
    const narrated = client.streamMessages.find(m => m.includes('## Resolved Time'))!;
    expect(narrated).toContain('04:00 → 06:00');
    expect(narrated).toContain('cut short');
  });

  it('「等十分鐘」→ LLM 回 10 → 推進 10 分鐘', async () => {
    const { controller, client, sm } = await makeController();
    setClock(sm, 9, 0);
    client.waitMinutes = 10;
    await controller.submitAction('等十分鐘');
    expect(clock(sm)).toBe('09:10');
  });

  it('超過上限夾到 720 分鐘', async () => {
    const { controller, client, sm } = await makeController();
    setClock(sm, 7, 0);
    client.waitMinutes = 2000;
    await controller.submitAction('等二十個小時');
    expect(clock(sm)).toBe('19:00');
  });

  it('格式錯誤 → 退回舊行為（預設推進 10 分鐘）', async () => {
    const { controller, client, sm } = await makeController();
    setClock(sm, 9, 0);
    client.waitMinutes = 'two hours';
    await controller.submitAction('等一下');
    expect(clock(sm)).toBe('09:10');
  });
});

describe('休息預填：Regulator（LLM）換算值優先', () => {
  beforeEach(() => {
    inputDisabled.set(false);
    restModalOpen.set(null);
  });

  it('Regulator 收到時間資訊；回傳 restMinutes 時預填採用它', async () => {
    const { controller, client, sm } = await makeController();
    setClock(sm, 4, 0);
    sm.modifyStat('statusStats.fatigue', 4);
    client.regulatorReply = { allowed: true, reason: null, modifiedInput: null, actionType: 'rest', targetId: null, restMinutes: 60 };
    // 確定性解析會得到 300（簡陋休息無此選項 → 不預填），LLM 的 60 應被採用
    await controller.submitAction('睡五個小時');

    expect(client.regulatorMessages.at(-1)).toContain('Curfew (門禁)');
    expect(get(restModalOpen)?.presetMinutes).toBe(60);
  });

  it('Regulator 未提供 restMinutes 時退回確定性解析', async () => {
    const { controller, client, sm } = await makeController();
    setClock(sm, 4, 0);
    sm.modifyStat('statusStats.fatigue', 4);
    client.regulatorReply = { allowed: true, reason: null, modifiedInput: null, actionType: 'rest', targetId: null };
    await controller.submitAction('睡一個小時');
    expect(get(restModalOpen)?.presetMinutes).toBe(60);
  });
});

describe('prompt 與夾限', () => {
  it('DM Phase 1 prompt 要求照辦明確時長、上限 720，並附 few-shot', () => {
    expect(DM_INTENT_PROMPT).toContain('you MUST comply');
    expect(DM_INTENT_PROMPT).toContain('Cap: 720 min');
    expect(DM_INTENT_PROMPT).toContain('Action started at 04:00, "等到六點的工作廣播" → 120');
  });

  it('Regulator restMinutes：只在休息意圖採用，夾在 1–720，格式錯誤忽略', async () => {
    const reply = (extra: Record<string, unknown>) => ({
      complete: async () => JSON.stringify({ allowed: true, reason: null, modifiedInput: null, targetId: null, ...extra }),
      // eslint-disable-next-line require-yield
      stream: async function* () { return; },
    }) as ILLMClient;
    const player = (await makeController()).sm.getState().player;
    const act = { type: 'free' as const, input: '睡到中午' };

    expect((await new Regulator(reply({ actionType: 'rest', restMinutes: 5000 })).validate(act, player)).restMinutes).toBe(720);
    expect((await new Regulator(reply({ actionType: 'rest', restMinutes: '兩小時' })).validate(act, player)).restMinutes).toBeUndefined();
    expect((await new Regulator(reply({ actionType: 'free', restMinutes: 60 })).validate(act, player)).restMinutes).toBeUndefined();
  });
});
