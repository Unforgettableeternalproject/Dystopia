// ── LoreVault ─────────────────────────────────────────────────
// 設定資料庫存取層。從 JSON 檔案載入，提供快速索引查詢。
// DM 只應透過此層取得世界資料，不應自行創造。

import type { LocationNode, NPCNode, GameEvent, Faction } from '../types';

interface LoreData {
  locations: Record<string, LocationNode>;
  npcs: Record<string, NPCNode>;
  events: Record<string, GameEvent>;
  factions: Record<string, Faction>;
}

export class LoreVault {
  private data: LoreData = {
    locations: {},
    npcs: {},
    events: {},
    factions: {},
  };

  /** 載入設定資料（傳入 JSON 物件） */
  load(data: Partial<LoreData>): void {
    if (data.locations) Object.assign(this.data.locations, data.locations);
    if (data.npcs) Object.assign(this.data.npcs, data.npcs);
    if (data.events) Object.assign(this.data.events, data.events);
    if (data.factions) Object.assign(this.data.factions, data.factions);
  }

  // ── 地點 ───────────────────────────────────────────────────

  getLocation(id: string): LocationNode | undefined {
    return this.data.locations[id];
  }

  getLocationsByRegion(regionId: string): LocationNode[] {
    return Object.values(this.data.locations).filter(
      (loc) => loc.regionId === regionId
    );
  }

  // ── NPC ────────────────────────────────────────────────────

  getNPC(id: string): NPCNode | undefined {
    return this.data.npcs[id];
  }

  getNPCsAtLocation(locationId: string): NPCNode[] {
    return Object.values(this.data.npcs).filter(
      (npc) => npc.locationId === locationId && npc.isVisible
    );
  }

  // ── 事件 ───────────────────────────────────────────────────

  getEvent(id: string): GameEvent | undefined {
    return this.data.events[id];
  }

  getEventsAtLocation(locationId: string): GameEvent[] {
    return Object.values(this.data.events).filter(
      (evt) => !evt.locationId || evt.locationId === locationId
    );
  }

  // ── 派系 ───────────────────────────────────────────────────

  getFaction(id: string): Faction | undefined {
    return this.data.factions[id];
  }

  // ── 給 DM 的場景上下文摘要 ─────────────────────────────────

  /**
   * 為 DM 組合當前場景的 lore 子集。
   * 只包含當前地點相關的資料，避免傳入整個 vault。
   */
  buildSceneContext(locationId: string): string {
    const location = this.getLocation(locationId);
    if (!location) return '[Unknown location]';

    const npcs = this.getNPCsAtLocation(locationId);
    const connections = location.connections
      .map((c) => `- ${c.description} → ${c.targetLocationId}`)
      .join('\n');

    const npcSummary = npcs
      .map((n) => `- ${n.name} (${n.type}): ${n.description}`)
      .join('\n');

    return [
      `## Location: ${location.name}`,
      location.description,
      `Ambience: ${location.ambience}`,
      '',
      '### Exits',
      connections || '(none)',
      '',
      '### Present NPCs',
      npcSummary || '(none)',
    ].join('\n');
  }
}
