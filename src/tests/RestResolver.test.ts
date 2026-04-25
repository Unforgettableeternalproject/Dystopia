import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RestResolver } from '../lib/engine/RestResolver';
import type { RestInput } from '../lib/engine/RestResolver';
import type { RestContext } from '../lib/types/prop';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FULL_CTX: RestContext = {
  mode: 'full_available',
  restPointIds: [],
  maxTimeMinutes: Infinity,
  statusEffectScale: 1.0,
};

const SCUFFED_CTX: RestContext = {
  mode: 'scuffed',
  restPointIds: [],
  maxTimeMinutes: 90,
  statusEffectScale: 0.3,
};

/** noise=0 when Math.random()=0.5: (0.5*2-1)*30 = 0 */
function mockZeroNoise() {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
}

/** noise=-30 when Math.random()=0: (0*2-1)*30 = -30 */
function mockNegativeNoise() {
  vi.spyOn(Math, 'random').mockReturnValue(0);
}

afterEach(() => vi.restoreAllMocks());

// ── 品質分級 ──────────────────────────────────────────────────────────────────

describe('RestResolver — 品質分級', () => {
  it('無偏移（balanced stats）→ 成功休息', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    // bias=0, noise=0 → deviation=0 → |0| <= 60 → 成功休息
    expect(result.quality).toBe('full');
    expect(result.deviationMinutes).toBe(0);
  });

  it('|deviation| <= 60 → 成功休息', () => {
    mockZeroNoise();
    // stressRatio=0.3, staminaDeficit=0 → bias = -0.3*180 = -54
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 3, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(Math.abs(result.deviationMinutes)).toBeLessThanOrEqual(60);
    expect(result.quality).toBe('full');
  });

  it('|deviation| = 180（壓力全滿, noise=0）→ 不完整休息', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 10, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    // bias = -180, noise=0 → deviation=-180 → |180| <= 180 → 不完整休息
    expect(result.deviationMinutes).toBe(-180);
    expect(result.quality).toBe('partial');
  });

  it('|deviation| > 180（壓力全滿 + 負noise）→ 喪失時間觀', () => {
    mockNegativeNoise();  // noise = -30
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 10, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    // bias = -180, noise = -30 → deviation = -210 → |210| > 180 → 喪失時間觀
    expect(result.deviationMinutes).toBe(-210);
    expect(result.quality).toBe('disoriented');
  });

  it('低體力正偏移 → 不完整休息', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 0, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    // bias = 1*180 - 0 = +180 → deviation=180 → 不完整休息
    expect(result.deviationMinutes).toBe(180);
    expect(result.quality).toBe('partial');
  });
});

// ── Scuffed 模式 ───────────────────────────────────────────────────────────────

describe('RestResolver — scuffed 模式', () => {
  it('超過 cap → actualMinutes 被截斷為 maxTimeMinutes', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: SCUFFED_CTX,   // cap = 90
      stamina: 10, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    // no bias, no noise → would be 480, capped at 90
    expect(result.actualMinutes).toBe(90);
    expect(result.deviationMinutes).toBe(90 - 480); // -390
  });

  it('scuffed cap 導致偏移 > 180 → 喪失時間觀', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: SCUFFED_CTX,
      stamina: 10, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.quality).toBe('disoriented');
  });

  it('scuffed tag 加入 resultTags', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: SCUFFED_CTX,
      stamina: 10, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.resultTags).toContain('scuffed');
  });

  it('actualMinutes 不可低於 5（最短保障）', () => {
    mockNegativeNoise(); // scuffed noise = (0*2-1)*10 = -10
    const input: RestInput = {
      plannedMinutes: 30,
      restCtx: { ...SCUFFED_CTX, maxTimeMinutes: 20 },
      stamina: 10, staminaMax: 10,
      stress: 10, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    // bias=-180, noise=-10 → deviation=-190 → actual=30-190=-160 → capped at 5
    expect(result.actualMinutes).toBe(5);
  });

  it('scuffed 模式下品質最多為「不完整休息」，不可能是「成功休息」', () => {
    mockZeroNoise();
    // 無偏移情況下 rawQuality 原本會是「成功休息」，但 scuffed 必須蓋掉
    const input: RestInput = {
      plannedMinutes: 30,
      restCtx: { ...SCUFFED_CTX, maxTimeMinutes: 999 }, // no cap
      stamina: 10, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.quality).not.toBe('full');
    expect(result.quality).toBe('partial');
  });
});

// ── 偏移傾向 ──────────────────────────────────────────────────────────────────

describe('RestResolver — 偏移傾向', () => {
  it('高壓力 → 負偏移（睡不夠）', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 8, stressMax: 10,    // stressRatio=0.8 → bias=-144
    };
    const result = RestResolver.resolve(input);
    expect(result.deviationMinutes).toBeLessThan(0);
  });

  it('低體力 → 正偏移（睡過頭）', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 2, staminaMax: 10,  // deficit=0.8 → bias=+144
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.deviationMinutes).toBeGreaterThan(0);
  });

  it('體力體力與壓力平衡（都 50%）→ 偏移=0', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 5, staminaMax: 10,  // deficit=0.5 → +90
      stress: 5, stressMax: 10,    // ratio=0.5 → -90
    };
    const result = RestResolver.resolve(input);
    // bias = 0.5*180 - 0.5*180 = 0
    expect(result.deviationMinutes).toBe(0);
  });
});

// ── 語意標記 ──────────────────────────────────────────────────────────────────

describe('RestResolver — resultTags', () => {
  it('品質標記一定在 resultTags 中', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.resultTags).toContain('full');
  });

  it('high_stress → stressRatio > 0.7 時加入', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 8, stressMax: 10,   // ratio = 0.8 > 0.7
    };
    const result = RestResolver.resolve(input);
    expect(result.resultTags).toContain('high_stress');
  });

  it('high_stress 不加入（stressRatio=0.7 剛好不超過）', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 7, stressMax: 10,   // ratio = 0.7, NOT > 0.7
    };
    const result = RestResolver.resolve(input);
    expect(result.resultTags).not.toContain('high_stress');
  });

  it('low_stamina → staminaDeficit > 0.7 時加入', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 2, staminaMax: 10, // deficit = 0.8 > 0.7
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.resultTags).toContain('low_stamina');
  });

  it('undersleep → deviationMinutes < -60 時加入', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 10, stressMax: 10,  // deviation = -180
    };
    const result = RestResolver.resolve(input);
    expect(result.resultTags).toContain('undersleep');
  });

  it('oversleep → deviationMinutes > 60 時加入', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 0, staminaMax: 10, // deviation = +180
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.resultTags).toContain('oversleep');
  });
});

// ── 回復量計算 ────────────────────────────────────────────────────────────────

describe('RestResolver — 回復量', () => {
  it('staminaDelta 不超過可回復上限（staminaMax - stamina）', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 8, staminaMax: 10,  // headroom = 2
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.staminaDelta).toBeLessThanOrEqual(2);
  });

  it('體力滿的情況下 staminaDelta = 0', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.staminaDelta).toBe(0);
  });

  it('stressDelta 為負值（減輕壓力）', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 5, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    expect(result.stressDelta).toBeLessThanOrEqual(0);
  });

  it('壓力為 0 時 stressDelta = 0', () => {
    mockZeroNoise();
    const input: RestInput = {
      plannedMinutes: 480,
      restCtx: FULL_CTX,
      stamina: 10, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    const result = RestResolver.resolve(input);
    // Use Math.abs to handle -0 === 0 edge case
    expect(Math.abs(result.stressDelta)).toBe(0);
  });

  it('scuffed 模式 statusEffectScale=0.3 回復量低於 full', () => {
    mockZeroNoise();
    const baseInput = {
      stamina: 0, staminaMax: 10,
      stress: 0, stressMax: 10,
    };
    // Use same actualMinutes for fair comparison: pick small planned so scuffed doesn't cap
    const fullResult = RestResolver.resolve({
      ...baseInput,
      plannedMinutes: 60,
      restCtx: FULL_CTX,
    });
    const scuffedResult = RestResolver.resolve({
      ...baseInput,
      plannedMinutes: 60,
      restCtx: { ...SCUFFED_CTX, maxTimeMinutes: 999 },  // no cap
    });
    expect(scuffedResult.staminaDelta).toBeLessThan(fullResult.staminaDelta);
  });
});
