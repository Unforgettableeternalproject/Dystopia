import { describe, it, expect, beforeEach } from 'vitest';
import { LoreVault } from '../lib/lore/LoreVault';
import { FlagSystem } from '../lib/engine/FlagSystem';
import { EventBus } from '../lib/engine/EventBus';
import type { LocationNode, LocationConnection } from '../lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFlags(initial: string[] = []): FlagSystem {
  return new FlagSystem(new EventBus(), initial);
}

type ConnSpec = Omit<LocationConnection, 'description'> & { description?: string };

function makeLocation(id: string, connections: ConnSpec[] = []): LocationNode {
  return {
    id,
    name: id + '_name',
    regionId: 'test_region',
    tags: [],
    base: {
      description: '',
      ambience: [],
      connections: connections.map(c => ({ description: '→' + c.targetLocationId, ...c })),
      npcIds: [],
      eventIds: [],
      isAccessible: true,
    },
    localVariants: [],
  };
}

const BASE_ACCESS_CTX = { timePeriod: 'rest' as const, knownIntelIds: [] };

// ── findPath ─────────────────────────────────────────────────────────────────

describe('LoreVault.findPath — 基礎', () => {
  let vault: LoreVault;
  let flags: FlagSystem;

  beforeEach(() => {
    vault = new LoreVault();
    flags = makeFlags();
  });

  it('起點 = 終點 → 回傳長度 1 路徑，耗時 0', () => {
    vault.load({ locations: { a: makeLocation('a') } });
    const result = vault.findPath('a', 'a', flags, BASE_ACCESS_CTX, new Set(['a']));
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(['a']);
    expect(result!.totalTime).toBe(0);
    expect(result!.segments).toHaveLength(0);
  });

  it('相鄰地點 → 直接單跳路徑', () => {
    vault.load({ locations: {
      a: makeLocation('a', [{ targetLocationId: 'b', traverseTime: 8 }]),
      b: makeLocation('b'),
    }});
    const result = vault.findPath('a', 'b', flags, BASE_ACCESS_CTX, new Set(['a', 'b']));
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(['a', 'b']);
    expect(result!.totalTime).toBe(8);
    expect(result!.usedBypass).toBe(false);
  });

  it('traverseTime 省略 → 預設 5 分鐘', () => {
    vault.load({ locations: {
      a: makeLocation('a', [{ targetLocationId: 'b' }]),
      b: makeLocation('b'),
    }});
    const result = vault.findPath('a', 'b', flags, BASE_ACCESS_CTX, new Set(['a', 'b']));
    expect(result!.totalTime).toBe(5);
  });

  it('多跳導航：A → B → C（A 未直接連接 C）', () => {
    vault.load({ locations: {
      a: makeLocation('a', [{ targetLocationId: 'b', traverseTime: 5 }]),
      b: makeLocation('b', [{ targetLocationId: 'c', traverseTime: 7 }]),
      c: makeLocation('c'),
    }});
    const result = vault.findPath('a', 'c', flags, BASE_ACCESS_CTX, new Set(['a', 'b', 'c']));
    expect(result!.path).toEqual(['a', 'b', 'c']);
    expect(result!.totalTime).toBe(12);
    expect(result!.segments).toHaveLength(2);
  });

  it('無連通路徑 → 回傳 null', () => {
    vault.load({ locations: {
      a: makeLocation('a'),
      b: makeLocation('b'),
    }});
    const result = vault.findPath('a', 'b', flags, BASE_ACCESS_CTX, new Set(['a', 'b']));
    expect(result).toBeNull();
  });

  it('中間地點未發現 → 路徑不可行', () => {
    vault.load({ locations: {
      a: makeLocation('a', [{ targetLocationId: 'b' }]),
      b: makeLocation('b', [{ targetLocationId: 'c' }]),
      c: makeLocation('c'),
    }});
    // b 未被發現，不能作為中繼點
    const result = vault.findPath('a', 'c', flags, BASE_ACCESS_CTX, new Set(['a', 'c']));
    expect(result).toBeNull();
  });
});

// ── findPath — Dijkstra 權重 ──────────────────────────────────────────────────

describe('LoreVault.findPath — 最短耗時路徑（Dijkstra）', () => {
  let vault: LoreVault;
  let flags: FlagSystem;

  beforeEach(() => {
    vault = new LoreVault();
    flags = makeFlags();
  });

  it('兩條相同跳數的路徑 → 選耗時更短的', () => {
    // A → B → C : 3 + 3 = 6 min
    // A → D → C : 10 + 10 = 20 min
    vault.load({ locations: {
      a: makeLocation('a', [
        { targetLocationId: 'b', traverseTime: 3 },
        { targetLocationId: 'd', traverseTime: 10 },
      ]),
      b: makeLocation('b', [{ targetLocationId: 'c', traverseTime: 3 }]),
      d: makeLocation('d', [{ targetLocationId: 'c', traverseTime: 10 }]),
      c: makeLocation('c'),
    }});
    const result = vault.findPath('a', 'c', flags, BASE_ACCESS_CTX, new Set(['a', 'b', 'c', 'd']));
    expect(result!.path).toEqual(['a', 'b', 'c']);
    expect(result!.totalTime).toBe(6);
  });

  it('較多跳數但耗時更短的路徑 → 優先選用', () => {
    // A → B → C → D : 2 + 2 + 2 = 6 min（3 跳）
    // A → E → D     : 20 + 20 = 40 min（2 跳）
    vault.load({ locations: {
      a: makeLocation('a', [
        { targetLocationId: 'b', traverseTime: 2 },
        { targetLocationId: 'e', traverseTime: 20 },
      ]),
      b: makeLocation('b', [{ targetLocationId: 'c', traverseTime: 2 }]),
      c: makeLocation('c', [{ targetLocationId: 'd', traverseTime: 2 }]),
      e: makeLocation('e', [{ targetLocationId: 'd', traverseTime: 20 }]),
      d: makeLocation('d'),
    }});
    const result = vault.findPath('a', 'd', flags, BASE_ACCESS_CTX, new Set(['a', 'b', 'c', 'd', 'e']));
    expect(result!.path).toEqual(['a', 'b', 'c', 'd']);
    expect(result!.totalTime).toBe(6);
  });
});

// ── findPath — Access 與 Bypass 優先度 ────────────────────────────────────────

describe('LoreVault.findPath — access 優先於 bypass', () => {
  let vault: LoreVault;

  beforeEach(() => { vault = new LoreVault(); });

  it('access 路徑與 bypass 路徑並存 → 選 access 路徑', () => {
    // A 有兩條出口通往 C：
    //   A → bypass_mid → C  (需要 bypass flag)
    //   A → access_mid → C  (永遠開放)
    const flags = makeFlags(['bypass_key']);
    vault.load({ locations: {
      a: makeLocation('a', [
        { targetLocationId: 'bypass_mid', traverseTime: 5, access: {
          flag: 'required_flag_not_set',
          bypass: { flag: 'bypass_key' },
        }},
        { targetLocationId: 'access_mid', traverseTime: 5 },
      ]),
      bypass_mid: makeLocation('bypass_mid', [{ targetLocationId: 'c', traverseTime: 5 }]),
      access_mid: makeLocation('access_mid', [{ targetLocationId: 'c', traverseTime: 5 }]),
      c: makeLocation('c'),
    }});
    const discovered = new Set(['a', 'bypass_mid', 'access_mid', 'c']);
    const result = vault.findPath('a', 'c', flags, BASE_ACCESS_CTX, discovered);
    expect(result).not.toBeNull();
    expect(result!.usedBypass).toBe(false);
    expect(result!.path).toContain('access_mid');
    expect(result!.path).not.toContain('bypass_mid');
  });

  it('無 access 路徑時 fallback 使用 bypass（預設 +20% 耗時）', () => {
    const flags = makeFlags(['bypass_key']);
    vault.load({ locations: {
      a: makeLocation('a', [{ targetLocationId: 'b', traverseTime: 10, access: {
        flag: 'required_not_set',
        bypass: { flag: 'bypass_key' },
      }}]),
      b: makeLocation('b'),
    }});
    const result = vault.findPath('a', 'b', flags, BASE_ACCESS_CTX, new Set(['a', 'b']));
    expect(result).not.toBeNull();
    expect(result!.usedBypass).toBe(true);
    expect(result!.totalTime).toBe(Math.ceil(10 * 1.2));  // 12 min
  });

  it('bypass 指定 timePenaltyMinutes → 套用絕對懲罰', () => {
    const flags = makeFlags(['bypass_key']);
    vault.load({ locations: {
      a: makeLocation('a', [{ targetLocationId: 'b', traverseTime: 10, access: {
        flag: 'required_not_set',
        bypass: { flag: 'bypass_key', timePenaltyMinutes: 5 },
      }}]),
      b: makeLocation('b'),
    }});
    const result = vault.findPath('a', 'b', flags, BASE_ACCESS_CTX, new Set(['a', 'b']));
    expect(result!.totalTime).toBe(15);  // 10 base + 5 penalty
  });

  it('access 條件不滿足且無 bypass → 路徑封鎖，回傳 null', () => {
    const flags = makeFlags();  // 無任何旗標
    vault.load({ locations: {
      a: makeLocation('a', [{ targetLocationId: 'b', access: { flag: 'required_not_set' } }]),
      b: makeLocation('b'),
    }});
    const result = vault.findPath('a', 'b', flags, BASE_ACCESS_CTX, new Set(['a', 'b']));
    expect(result).toBeNull();
  });
});

// ── registerLocation — enableDefaultConnection ────────────────────────────────

describe('LoreVault.registerLocation — enableDefaultConnection', () => {
  it('預設（省略）→ 自動注入父子雙向連線', () => {
    const vault = new LoreVault();
    const parent: LocationNode = {
      ...makeLocation('parent'),
      locationType: 'area',
      sublocations: [makeLocation('child')],
    };
    vault.load({ locations: { parent } });

    const loadedParent = vault.getLocation('parent');
    const loadedChild  = vault.getLocation('child');
    expect(loadedParent!.base.connections.some(c => c.targetLocationId === 'child')).toBe(true);
    expect(loadedChild!.base.connections.some(c => c.targetLocationId === 'parent')).toBe(true);
  });

  it('enableDefaultConnection: false → 不注入任何自動連線', () => {
    const vault = new LoreVault();
    const parent: LocationNode = {
      ...makeLocation('parent'),
      locationType: 'area',
      enableDefaultConnection: false,
      sublocations: [makeLocation('child')],
    };
    vault.load({ locations: { parent } });

    const loadedParent = vault.getLocation('parent');
    const loadedChild  = vault.getLocation('child');
    expect(loadedParent!.base.connections.some(c => c.targetLocationId === 'child')).toBe(false);
    expect(loadedChild!.base.connections.some(c => c.targetLocationId === 'parent')).toBe(false);
  });

  it('enableDefaultConnection: false 但 connections 已手動定義 → 保留手動連線', () => {
    const vault = new LoreVault();
    const child = makeLocation('child', [{ targetLocationId: 'parent', description: '手動返回' }]);
    const parent: LocationNode = {
      ...makeLocation('parent', [{ targetLocationId: 'child', description: '手動進入' }]),
      locationType: 'area',
      enableDefaultConnection: false,
      sublocations: [child],
    };
    vault.load({ locations: { parent } });

    const loadedParent = vault.getLocation('parent');
    const loadedChild  = vault.getLocation('child');
    // 手動定義的連線要保留
    expect(loadedParent!.base.connections.some(c => c.targetLocationId === 'child')).toBe(true);
    expect(loadedChild!.base.connections.some(c => c.targetLocationId === 'parent')).toBe(true);
    // 但不能有重複注入
    expect(loadedParent!.base.connections.filter(c => c.targetLocationId === 'child')).toHaveLength(1);
  });
});
