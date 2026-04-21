import { describe, it, expect, beforeEach } from 'vitest';
import { FlagSystem } from '../lib/engine/FlagSystem';
import { EventBus } from '../lib/engine/EventBus';

function makeFlags(initial: string[] = []): FlagSystem {
  return new FlagSystem(new EventBus(), initial);
}

// ── 基礎操作 ─────────────────────────────────────────────────────────────────

describe('FlagSystem — 基礎操作', () => {
  let flags: FlagSystem;

  beforeEach(() => { flags = makeFlags(); });

  it('set() / has() — 設置後可查詢', () => {
    flags.set('flag_a');
    expect(flags.has('flag_a')).toBe(true);
  });

  it('unset() — 移除後 has() 回傳 false', () => {
    flags.set('flag_a');
    flags.unset('flag_a');
    expect(flags.has('flag_a')).toBe(false);
  });

  it('set() — 重複設置不重複儲存（idempotent）', () => {
    flags.set('flag_a');
    flags.set('flag_a');
    expect(flags.toArray().filter(f => f === 'flag_a').length).toBe(1);
  });

  it('unset() — 對未存在旗標不報錯', () => {
    expect(() => flags.unset('nonexistent')).not.toThrow();
  });

  it('hasAll() — 全有回傳 true', () => {
    flags.set('a'); flags.set('b');
    expect(flags.hasAll(['a', 'b'])).toBe(true);
  });

  it('hasAll() — 缺一回傳 false', () => {
    flags.set('a');
    expect(flags.hasAll(['a', 'b'])).toBe(false);
  });

  it('hasAny() — 有一個回傳 true', () => {
    flags.set('a');
    expect(flags.hasAny(['a', 'b'])).toBe(true);
  });

  it('hasAny() — 全無回傳 false', () => {
    expect(flags.hasAny(['a', 'b'])).toBe(false);
  });

  it('constructor initialFlags — 起始旗標正確載入', () => {
    const f = makeFlags(['x', 'y']);
    expect(f.has('x')).toBe(true);
    expect(f.has('y')).toBe(true);
  });

  it('toArray() — 回傳所有旗標', () => {
    flags.set('a'); flags.set('b');
    expect(flags.toArray().sort()).toEqual(['a', 'b']);
  });
});

// ── evaluate() — 基本語法 ─────────────────────────────────────────────────────

describe('FlagSystem.evaluate() — 基本語法', () => {
  let flags: FlagSystem;

  beforeEach(() => {
    flags = makeFlags(['f_a', 'f_b']);
  });

  it('空字串回傳 true', () => {
    expect(flags.evaluate('')).toBe(true);
  });

  it('空白字串回傳 true', () => {
    expect(flags.evaluate('   ')).toBe(true);
  });

  it('單一旗標 — 存在時為 true', () => {
    expect(flags.evaluate('f_a')).toBe(true);
  });

  it('單一旗標 — 不存在時為 false', () => {
    expect(flags.evaluate('f_missing')).toBe(false);
  });

  it('! NOT — 旗標缺席時為 true', () => {
    expect(flags.evaluate('!f_missing')).toBe(true);
  });

  it('! NOT — 旗標存在時為 false', () => {
    expect(flags.evaluate('!f_a')).toBe(false);
  });

  it('& AND — 兩個都有時為 true', () => {
    expect(flags.evaluate('f_a & f_b')).toBe(true);
  });

  it('& AND — 缺一時為 false', () => {
    expect(flags.evaluate('f_a & f_missing')).toBe(false);
  });

  it('| OR — 有一個時為 true', () => {
    expect(flags.evaluate('f_a | f_missing')).toBe(true);
  });

  it('| OR — 兩個都沒有時為 false', () => {
    expect(flags.evaluate('f_missing1 | f_missing2')).toBe(false);
  });

  it('複合 — AND 在 OR 前處理（a | b & c）', () => {
    // a | (b & c) — f_a 存在，結果應為 true
    expect(flags.evaluate('f_a | f_b & f_missing')).toBe(true);
  });

  it('複合 — OR 有任一 AND 分支成立即 true', () => {
    // (f_missing & f_b) | (f_a & f_b)
    expect(flags.evaluate('f_missing & f_b | f_a & f_b')).toBe(true);
  });

  it('複合 — NOT 與 AND 組合', () => {
    // f_a & !f_missing → true & true = true
    expect(flags.evaluate('f_a & !f_missing')).toBe(true);
  });

  it('複合 — NOT 與 AND 組合，有旗標的 NOT 為 false', () => {
    // f_a & !f_b → true & false = false
    expect(flags.evaluate('f_a & !f_b')).toBe(false);
  });
});

// ── evaluate() — AND/OR/NOT 文字運算子（預期不支援的已知 bug）───────────────

describe('FlagSystem.evaluate() — 文字運算子 AND/OR/NOT（已知問題）', () => {
  const flags = makeFlags(['f_a', 'f_b']);

  it('文字 "AND" 不被識別，旗標名稱含 AND 字串，evaluate 結果不是語意 AND', () => {
    // "f_a AND f_b" — 引擎只切 | 和 &，不切 AND；
    // "f_a AND f_b" 會被當成單一 token 查詢，f_a AND f_b 不是旗標，結果為 false
    expect(flags.evaluate('f_a AND f_b')).toBe(false);
  });

  it('文字 "OR" 不被識別，evaluate 結果不是語意 OR', () => {
    // "f_missing OR f_a" 被當成單一 token，不是旗標，結果為 false
    expect(flags.evaluate('f_missing OR f_a')).toBe(false);
  });

  it('文字 "NOT" 前綴不被識別，evaluate 結果不是語意 NOT', () => {
    // "NOT f_missing" 被當成單一 token，不是旗標，結果為 false
    expect(flags.evaluate('NOT f_missing')).toBe(false);
  });
});

// ── EventBus 事件發送 ────────────────────────────────────────────────────────

describe('FlagSystem — EventBus 事件', () => {
  it('set() 發送 flag:set 事件', () => {
    const bus = new EventBus();
    const flags = new FlagSystem(bus);
    let received = '';
    bus.on<{ flagId: string }>('flag:set', ({ flagId }) => { received = flagId; });
    flags.set('my_flag');
    expect(received).toBe('my_flag');
  });

  it('set() 重複設置時不重複發送事件', () => {
    const bus = new EventBus();
    const flags = new FlagSystem(bus);
    let count = 0;
    bus.on('flag:set', () => { count++; });
    flags.set('my_flag');
    flags.set('my_flag');
    expect(count).toBe(1);
  });

  it('unset() 發送 flag:unset 事件', () => {
    const bus = new EventBus();
    const flags = new FlagSystem(bus, ['my_flag']);
    let received = '';
    bus.on<{ flagId: string }>('flag:unset', ({ flagId }) => { received = flagId; });
    flags.unset('my_flag');
    expect(received).toBe('my_flag');
  });

  it('unset() 對不存在旗標不發送事件', () => {
    const bus = new EventBus();
    const flags = new FlagSystem(bus);
    let count = 0;
    bus.on('flag:unset', () => { count++; });
    flags.unset('nonexistent');
    expect(count).toBe(0);
  });
});
