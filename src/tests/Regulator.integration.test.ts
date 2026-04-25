/**
 * Regulator integration tests — 使用本地 Ollama 模型驗證常見遊戲情境。
 *
 * 執行條件：
 *   - .env 中設定 VITE_OLLAMA_MODEL（例如 gemma4:e4b-it-q4_K_M）
 *   - Ollama 服務在 localhost:11434 運行中
 *
 * 沒有模型設定或 Ollama 無回應時全部跳過，不影響一般 CI。
 *
 * 執行方式：npm test
 */

import { describe, it, expect } from 'vitest';
import { Regulator } from '../lib/ai/Regulator';
import { LocalModelClient } from '../lib/ai/LocalModelClient';
import type { PlayerState, PlayerAction } from '../lib/types';

const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL as string | undefined;
const OLLAMA_BASE  = 'http://localhost:11434';

// Top-level await：在測試收集之前確認 Ollama 是否在線
// 必須在 skipIf 條件被評估前完成，所以不能放進 beforeAll
let ollamaReachable = false;
if (OLLAMA_MODEL) {
  try {
    const res = await fetch(OLLAMA_BASE + '/api/tags', { signal: AbortSignal.timeout(3000) });
    ollamaReachable = res.ok;
  } catch {
    ollamaReachable = false;
  }
}

const shouldRun = () => !!OLLAMA_MODEL && ollamaReachable;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRegulator(): Regulator {
  return new Regulator(new LocalModelClient(OLLAMA_MODEL!, OLLAMA_BASE));
}

function makePlayer(
  statusOverrides: Partial<PlayerState['statusStats']> = {},
  secondaryOverrides: Partial<PlayerState['secondaryStats']> = {},
  conditions: PlayerState['conditions'] = [],
): PlayerState {
  return {
    id: 'test',
    name: '測試者',
    origin: 'worker',
    currentLocationId: 'delth_dormitory_room',
    primaryStats:       { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
    primaryStatsExp:    { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
    inclinationTracker: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
    dailyGrantTracker:  { dateKey: '1498-6-12', grantedExp: {} },
    secondaryStats: { consciousness: 2, mysticism: 0, technology: 3, ...secondaryOverrides },
    statusStats: {
      stamina: 10, staminaMax: 10,
      stress:   2, stressMax:  10,
      endo:     0, endoMax:     0,
      experience: 0,
      ...statusOverrides,
      fatigue: statusOverrides.fatigue ?? 0,
    },
    externalStats:  { reputation: {}, affinity: {}, familiarity: {} },
    inventory:      [],
    melphin:        0,
    activeFlags:    new Set(),
    titles:         [],
    conditions,
    knownIntelIds:  [],
  };
}

function action(input: string, type: PlayerAction['type'] = 'free'): PlayerAction {
  return { type, input };
}

// ── 情境測試 ──────────────────────────────────────────────────────────────────

describe('Regulator × Ollama — 常見遊戲情境', () => {

  it.skipIf(!shouldRun())('【允許】基本觀察行動', async () => {
    const result = await makeRegulator().validate(action('我仔細觀察這個房間'), makePlayer());
    expect(result.allowed).toBe(true);
  }, 30_000);

  it.skipIf(!shouldRun())('【允許】與 NPC 對話', async () => {
    const result = await makeRegulator().validate(
      action('我走向凱奇，詢問他今天宿舍有什麼動靜', 'examine'),
      makePlayer(),
    );
    expect(result.allowed).toBe(true);
  }, 30_000);

  it.skipIf(!shouldRun())('【拒絕或降級】mysticism=0 且 endo=0 時嘗試施展魔法', async () => {
    // 玩家完全不懂魔法，也沒有魔素
    const result = await makeRegulator().validate(
      action('我施展火球術燒掉眼前的障礙'),
      makePlayer(),
    );
    // 應該被拒絕，或被降級（modifiedAction 存在表示被降級）
    const isHandled = !result.allowed || result.modifiedAction !== undefined;
    expect(isHandled).toBe(true);
  }, 30_000);

  it.skipIf(!shouldRun())('【允許】mysticism>0 且有 endo 時施展基礎魔法', async () => {
    const player = makePlayer(
      { endo: 10, endoMax: 20 },
      { mysticism: 5 },
    );
    const result = await makeRegulator().validate(
      action('我調動體內的魔素，在手心凝聚一點微弱的光'),
      player,
    );
    expect(result.allowed).toBe(true);
  }, 30_000);

  it.skipIf(!shouldRun())('【拒絕或降級】strength=1 試圖掀起厚重鐵門', async () => {
    const player = makePlayer();
    player.primaryStats.strength = 1;
    const result = await makeRegulator().validate(
      action('我用蠻力把那扇厚重的鐵門整個掀起來'),
      player,
    );
    const isHandled = !result.allowed || result.modifiedAction !== undefined;
    expect(isHandled).toBe(true);
  }, 30_000);

  it.skipIf(!shouldRun())('【拒絕或降級】technology=0 時熟練操作精密儀器', async () => {
    const player = makePlayer({}, { technology: 0 });
    const result = await makeRegulator().validate(
      action('我熟練地拆解這台精密的蒸汽調節器，重新校正它的壓力閥'),
      player,
    );
    const isHandled = !result.allowed || result.modifiedAction !== undefined;
    expect(isHandled).toBe(true);
  }, 30_000);

  it.skipIf(!shouldRun())('【拒絕或降級】帶有手臂受傷 condition 時試圖舉重物', async () => {
    const player = makePlayer({}, {}, [
      {
        id:          'injured_arm',
        label:       '右臂受傷',
        description: '右臂有傷，需要雙臂出力的動作受到嚴重限制',
        isHidden:    false,
      },
    ]);
    const result = await makeRegulator().validate(
      action('我雙手抓住沉重的箱子，把它搬到高架上'),
      player,
    );
    const isHandled = !result.allowed || result.modifiedAction !== undefined;
    expect(isHandled).toBe(true);
  }, 30_000);

});
