import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiceEngine } from '../lib/engine/DiceEngine';
import type { RollContext } from '../lib/engine/DiceEngine';

// ── statModifier ──────────────────────────────────────────────────────────────

describe('DiceEngine.statModifier()', () => {
  it('stat=8 → 0（基準值）', () => {
    expect(DiceEngine.statModifier(8)).toBe(0);
  });

  it('stat=11 → +1', () => {
    expect(DiceEngine.statModifier(11)).toBe(1);
  });

  it('stat=5 → -1', () => {
    expect(DiceEngine.statModifier(5)).toBe(-1);
  });

  it('stat=20 → +4', () => {
    expect(DiceEngine.statModifier(20)).toBe(4);
  });

  it('stat=14 → +2', () => {
    // floor((14-8)/3) = floor(2) = 2
    expect(DiceEngine.statModifier(14)).toBe(2);
  });

  it('stat=2 → -2', () => {
    // floor((2-8)/3) = floor(-2) = -2
    expect(DiceEngine.statModifier(2)).toBe(-2);
  });
});

// ── rollDie ───────────────────────────────────────────────────────────────────

describe('DiceEngine.rollDie()', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Math.random=0 → 最小值 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(DiceEngine.rollDie(20)).toBe(1);
  });

  it('Math.random≈1 → 最大值等於 sides', () => {
    // floor(0.9999 * 20) + 1 = 19 + 1 = 20
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    expect(DiceEngine.rollDie(20)).toBe(20);
  });

  it('sides=6: Math.random=0.5 → 4', () => {
    // floor(0.5 * 6) + 1 = 3 + 1 = 4
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(DiceEngine.rollDie(6)).toBe(4);
  });
});

// ── rollDice ──────────────────────────────────────────────────────────────────

describe('DiceEngine.rollDice()', () => {
  afterEach(() => vi.restoreAllMocks());

  it('count=1, sides=20, Math.random=0 → 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(DiceEngine.rollDice({ count: 1, sides: 20 })).toBe(1);
  });

  it('count=3, sides=6, Math.random=0 → 3（三顆最小值）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(DiceEngine.rollDice({ count: 3, sides: 6 })).toBe(3);
  });

  it('count=2, sides=6, Math.random=0.5 → 8（兩顆都是 4）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(DiceEngine.rollDice({ count: 2, sides: 6 })).toBe(8);
  });
});

// ── roll — normal ─────────────────────────────────────────────────────────────

describe('DiceEngine.roll() — 普通骰點', () => {
  afterEach(() => vi.restoreAllMocks());

  it('回傳結構包含 rolls, chosenRoll, statModifier, externalModifier, total', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const ctx: RollContext = {
      dice: { count: 1, sides: 20 },
      baseStat: 8,
      modifiers: [],
    };
    const result = DiceEngine.roll(ctx);
    expect(result).toHaveProperty('rolls');
    expect(result).toHaveProperty('chosenRoll');
    expect(result).toHaveProperty('statModifier');
    expect(result).toHaveProperty('externalModifier');
    expect(result).toHaveProperty('total');
  });

  it('無優劣勢 — rolls 長度為 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const ctx: RollContext = {
      dice: { count: 1, sides: 20 },
      baseStat: 8,
      modifiers: [],
    };
    const result = DiceEngine.roll(ctx);
    expect(result.rolls).toHaveLength(1);
  });

  it('total = chosenRoll + statModifier + externalModifier', () => {
    // Math.random=0 → rollDie(20)=1
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ctx: RollContext = {
      dice: { count: 1, sides: 20 },
      baseStat: 14,           // statModifier = +2
      modifiers: [{ label: 'test', value: 3 }],
    };
    const result = DiceEngine.roll(ctx);
    expect(result.chosenRoll).toBe(1);
    expect(result.statModifier).toBe(2);
    expect(result.externalModifier).toBe(3);
    expect(result.total).toBe(6);   // 1 + 2 + 3
  });

  it('多個 modifier 正確加總', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ctx: RollContext = {
      dice: { count: 1, sides: 20 },
      baseStat: 8,
      modifiers: [{ label: 'a', value: 2 }, { label: 'b', value: -1 }],
    };
    const result = DiceEngine.roll(ctx);
    expect(result.externalModifier).toBe(1);
  });
});

// ── roll — advantage / disadvantage ──────────────────────────────────────────

describe('DiceEngine.roll() — 優勢/劣勢', () => {
  afterEach(() => vi.restoreAllMocks());

  it('advantage — rolls 長度為 2', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const ctx: RollContext = {
      dice: { count: 1, sides: 20 },
      baseStat: 8,
      modifiers: [],
      advantage: true,
    };
    expect(DiceEngine.roll(ctx).rolls).toHaveLength(2);
  });

  it('advantage — chosenRoll 取較大值', () => {
    // 第一顆 Math.random=0 → 1; 第二顆 Math.random=0.9 → floor(0.9*20)+1=19
    const spy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.9);
    const ctx: RollContext = {
      dice: { count: 1, sides: 20 },
      baseStat: 8,
      modifiers: [],
      advantage: true,
    };
    const result = DiceEngine.roll(ctx);
    expect(result.chosenRoll).toBe(19);
    spy.mockRestore();
  });

  it('disadvantage — chosenRoll 取較小值', () => {
    const spy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)       // → 1
      .mockReturnValueOnce(0.9);    // → 19
    const ctx: RollContext = {
      dice: { count: 1, sides: 20 },
      baseStat: 8,
      modifiers: [],
      disadvantage: true,
    };
    const result = DiceEngine.roll(ctx);
    expect(result.chosenRoll).toBe(1);
    spy.mockRestore();
  });

  it('disadvantage — rolls 長度為 2', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const ctx: RollContext = {
      dice: { count: 1, sides: 20 },
      baseStat: 8,
      modifiers: [],
      disadvantage: true,
    };
    expect(DiceEngine.roll(ctx).rolls).toHaveLength(2);
  });
});

// ── passes ────────────────────────────────────────────────────────────────────

describe('DiceEngine.passes()', () => {
  afterEach(() => vi.restoreAllMocks());

  it('total >= dc → true', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const ctx: RollContext = { dice: { count: 1, sides: 20 }, baseStat: 8, modifiers: [] };
    const result = DiceEngine.roll(ctx);
    // result.total = 19 + 0 + 0 = 19
    expect(DiceEngine.passes(result, 10)).toBe(true);
  });

  it('total < dc → false', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);  // roll = 1
    const ctx: RollContext = { dice: { count: 1, sides: 20 }, baseStat: 8, modifiers: [] };
    const result = DiceEngine.roll(ctx);
    // result.total = 1
    expect(DiceEngine.passes(result, 10)).toBe(false);
  });

  it('total = dc → true（等於剛好過）', () => {
    // need total=10: roll must be 10 with baseStat=8 (mod=0), no external
    // Math.random = 9/20 = 0.45 → floor(0.45*20)+1 = 9+1 = 10
    vi.spyOn(Math, 'random').mockReturnValue(0.45);
    const ctx: RollContext = { dice: { count: 1, sides: 20 }, baseStat: 8, modifiers: [] };
    const result = DiceEngine.roll(ctx);
    expect(DiceEngine.passes(result, result.total)).toBe(true);
  });
});
