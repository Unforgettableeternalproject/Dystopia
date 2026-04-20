// LoreVault — lore database access layer.
// Loads authored content from JSON; the DM only reads world data through here.

import type {
  LocationNode, ResolvedLocation, LocationConnection, ConnectionAccess, GameTimeRange,
  NPCNode, NPCOverride,
  GameEvent, Faction, RegionIndex,
  DistrictIndex, RegionSchedule, FlagManifestEntry,
  TimePeriod,
} from '../types';
import type { ItemNode, InventoryItem } from '../types/item';
import type { ConditionDefinition } from '../types/condition';
import type { EncounterDefinition } from '../types/encounter';
import type { GameTime } from '../types/game';
import { FlagRegistry } from '../engine/FlagRegistry';
import type { ProximityContext } from '../engine/FlagRegistry';
import type { DialogueProfile } from '../types/dialogue';
import type { QuestDefinition, QuestInstance } from '../types/quest';
import type { WorldPhase, WorldPhaseId, PhaseEffect } from '../types/phase';
import type { FlagSystem } from '../engine/FlagSystem';
import type { NPCMemoryEntry } from '../types/game';

interface LoreData {
  locations:    Record<string, LocationNode>;
  npcs:         Record<string, NPCNode>;
  events:       Record<string, GameEvent>;
  factions:     Record<string, Faction>;
  dialogues:    Record<string, DialogueProfile>;
  quests:       Record<string, QuestDefinition>;
  encounters:   Record<string, EncounterDefinition>;
  phases:       WorldPhase[];
  regions:      Record<string, RegionIndex>;
  districts:    Record<string, DistrictIndex>;
  schedules:    Record<string, RegionSchedule>;
  flagManifest: FlagManifestEntry[];
  items:        Record<string, ItemNode>;
  conditions:   Record<string, ConditionDefinition>;
}

export class LoreVault {
  private data: LoreData = {
    locations: {}, npcs: {}, events: {}, factions: {},
    dialogues: {}, quests: {}, encounters: {}, phases: [], regions: {}, districts: {}, schedules: {},
    flagManifest: [], items: {}, conditions: {},
  };

  /** Singleton FlagRegistry built lazily from loaded flagManifest entries. */
  readonly flagRegistry = new FlagRegistry();

  load(data: Partial<LoreData>): void {
    if (data.locations) {
      for (const loc of Object.values(data.locations) as LocationNode[]) {
        this.registerLocation(loc);
      }
    }
    if (data.npcs)         Object.assign(this.data.npcs,       data.npcs);
    if (data.events)       Object.assign(this.data.events,     data.events);
    if (data.factions)     Object.assign(this.data.factions,   data.factions);
    if (data.dialogues)    Object.assign(this.data.dialogues,  data.dialogues);
    if (data.quests)       Object.assign(this.data.quests,     data.quests);
    if (data.regions)      Object.assign(this.data.regions,    data.regions);
    if (data.districts)    Object.assign(this.data.districts,  data.districts);
    if (data.schedules)    Object.assign(this.data.schedules,  data.schedules);
    if (data.flagManifest) {
      this.data.flagManifest.push(...data.flagManifest);
      this.flagRegistry.clear();
      this.flagRegistry.load(this.data.flagManifest);
    }
    if (data.phases)       this.data.phases.push(...data.phases);
    if (data.items)        Object.assign(this.data.items,       data.items);
    if (data.encounters)   Object.assign(this.data.encounters,  data.encounters);
    if (data.conditions)   Object.assign(this.data.conditions,  data.conditions);
  }

  /**
   * Register a LocationNode and recursively expand its sublocations.
   * Children inherit parentId, regionId, districtId, and locationType automatically.
   */
  private registerLocation(
    node: LocationNode,
    parentId?: string,
    inheritedRegionId?: string,
    inheritedDistrictId?: string,
  ): void {
    const patched: LocationNode = {
      ...node,
      regionId:     node.regionId     || inheritedRegionId  || '',
      districtId:   node.districtId   ?? inheritedDistrictId,
      parentId:     parentId          ?? node.parentId,
      locationType: node.locationType ?? (parentId !== undefined ? 'sublocation' : undefined),
      // Fresh array so auto-injection below doesn't mutate original JSON objects.
      base: { ...node.base, connections: [...node.base.connections] },
    };
    this.data.locations[node.id] = patched;
    for (const sub of node.sublocations ?? []) {
      this.registerLocation(sub, node.id, patched.regionId, patched.districtId);

      // Auto-inject implicit parent ↔ child connections (if not already authored).
      const parent = this.data.locations[node.id];
      const child  = this.data.locations[sub.id];
      if (!parent.base.connections.some(c => c.targetLocationId === sub.id)) {
        parent.base.connections.push({ targetLocationId: sub.id, description: '進入' + child.name });
      }
      if (!child.base.connections.some(c => c.targetLocationId === node.id)) {
        child.base.connections.push({ targetLocationId: node.id, description: '返回' + parent.name });
      }
    }
  }

  // -- Locations -------------------------------------------------------

  getLocation(id: string): LocationNode | undefined {
    return this.data.locations[id];
  }

  // Resolve a location to its current effective state given active flags.
  // localVariants handle location-scoped changes only.
  // Phase-level changes are applied separately via applyPhaseEffects().
  resolveLocation(id: string, flags: FlagSystem): ResolvedLocation | undefined {
    const node = this.data.locations[id];
    if (!node) return undefined;

    let { description, ambience, connections, npcIds, eventIds, isAccessible } = node.base;
    ambience    = [...ambience];
    connections = [...connections];
    const npcSet   = new Set(npcIds);
    const evtSet   = new Set(eventIds);

    const activeVariants: string[] = [];
    const transitionNotes: string[] = [];

    const sorted = [...node.localVariants].sort((a, b) => a.priority - b.priority);
    for (const v of sorted) {
      if (!flags.evaluate(v.condition)) continue;
      activeVariants.push(v.id);
      if (v.description  !== undefined) description  = v.description;
      if (v.ambience     !== undefined) ambience      = [...v.ambience];
      if (v.connections  !== undefined) connections   = [...v.connections];
      if (v.isAccessible !== undefined) isAccessible  = v.isAccessible;
      v.addNpcIds?.forEach(n => npcSet.add(n));
      v.removeNpcIds?.forEach(n => npcSet.delete(n));
      v.addEventIds?.forEach(e => evtSet.add(e));
      v.removeEventIds?.forEach(e => evtSet.delete(e));
      if (v.transitionNote) transitionNotes.push(v.transitionNote);
    }

    return {
      id: node.id, name: node.name, regionId: node.regionId, tags: node.tags,
      description, ambience, connections,
      npcIds: Array.from(npcSet), eventIds: Array.from(evtSet),
      isAccessible, activeVariants, transitionNotes,
      districtId:   node.districtId,
      parentId:     node.parentId,
      locationType: node.locationType,
    };
  }

  getLocationsByRegion(regionId: string): LocationNode[] {
    return Object.values(this.data.locations).filter(l => l.regionId === regionId);
  }

  getLocationsByDistrict(districtId: string): LocationNode[] {
    return Object.values(this.data.locations).filter(l => l.districtId === districtId);
  }

  /** Returns all direct children (sublocations) of the given area location. */
  getLocationsByParent(parentId: string): LocationNode[] {
    return Object.values(this.data.locations).filter(l => l.parentId === parentId);
  }

  /**
   * Returns district adjacency for a region derived from cross-district connections.
   * e.g. if a location in Delth connects to a location in Famein, they are adjacent.
   */
  getDistrictAdjacency(regionId: string): Map<string, string[]> {
    const adj = new Map<string, Set<string>>();
    for (const loc of Object.values(this.data.locations)) {
      if (loc.regionId !== regionId || !loc.districtId) continue;
      if (!adj.has(loc.districtId)) adj.set(loc.districtId, new Set());
      for (const conn of loc.base.connections) {
        const target = this.data.locations[conn.targetLocationId];
        if (!target?.districtId || target.districtId === loc.districtId) continue;
        adj.get(loc.districtId)!.add(target.districtId);
        if (!adj.has(target.districtId)) adj.set(target.districtId, new Set());
        adj.get(target.districtId)!.add(loc.districtId);
      }
    }
    const result = new Map<string, string[]>();
    for (const [k, v] of adj) result.set(k, Array.from(v));
    return result;
  }

  /** Returns true if the given game time falls within the range (supports overnight wrap). */
  private isInTimeRange(range: GameTimeRange, time: GameTime): boolean {
    const cur   = time.hour * 60 + time.minute;
    const start = range.startHour * 60 + range.startMinute;
    const end   = range.endHour   * 60 + range.endMinute;
    return start <= end
      ? cur >= start && cur <= end          // same-day range: 06:00–16:00
      : cur >= start || cur <= end;         // overnight range: 22:00–06:00
  }

  /**
   * Core access evaluation — shared by connections and locations.
   * All access conditions are AND. timeRanges / questStages arrays are OR within themselves.
   * Bypass is only checked when access conditions fail (access takes priority).
   * Returns { allowed, bypassMessage?, timePenalty? } where bypass fields are set only when
   * normal access failed and bypass was the reason the connection opened.
   */
  private evaluateAccessCondition(
    a: ConnectionAccess | undefined,
    flags: FlagSystem,
    timePeriod: TimePeriod,
    knownIntelIds: string[],
    activeQuests?: QuestInstance[],
    gameTime?: GameTime,
    inventory?: InventoryItem[],
    melphin?: number,
  ): { allowed: boolean; bypassMessage?: string; timePenalty?: number } {
    if (!a) return { allowed: true };

    // ── Normal access check (AND) ──────────────────────────────────
    const accessPassed =
      (!a.flag || flags.evaluate(a.flag)) &&
      (!a.timePeriods?.length || a.timePeriods.includes(timePeriod)) &&
      (!a.timeRanges?.length || (!!gameTime && a.timeRanges.some(r => this.isInTimeRange(r, gameTime)))) &&
      (!a.knowledgeIds?.length || a.knowledgeIds.every(id => knownIntelIds.includes(id))) &&
      (!a.questStages?.length || a.questStages.some(qs =>
        activeQuests?.some(qi => qi.questId === qs.questId && qi.currentStageId === qs.stageId)
      )) &&
      (!a.itemRequirements?.length || a.itemRequirements.every(req =>
        (inventory ?? []).some(i =>
          i.itemId === req.itemId &&
          !i.isExpired &&
          (req.variantId === undefined || i.variantId === req.variantId)
        )
      )) &&
      (a.minMelphin === undefined || (melphin ?? 0) >= a.minMelphin);

    if (accessPassed) return { allowed: true };

    // ── Bypass check (OR) — only reached when access failed ────────
    if (a.bypass) {
      const b = a.bypass;
      const bypassGranted =
        (b.flag !== undefined && flags.evaluate(b.flag)) ||
        (b.knowledgeIds?.some(id => knownIntelIds.includes(id)) ?? false) ||
        (b.itemRequirements?.some(req =>
          (inventory ?? []).some(i =>
            i.itemId === req.itemId &&
            !i.isExpired &&
            (req.variantId === undefined || i.variantId === req.variantId)
          )
        ) ?? false);
      if (bypassGranted) {
        return { allowed: true, bypassMessage: b.bypassMessage, timePenalty: b.timePenaltyMinutes };
      }
    }

    return { allowed: false };
  }

  /**
   * Returns true if the player can currently use this connection.
   */
  canAccessConnection(
    conn: LocationConnection,
    flags: FlagSystem,
    timePeriod: TimePeriod,
    knownIntelIds: string[],
    activeQuests?: QuestInstance[],
    gameTime?: GameTime,
    inventory?: InventoryItem[],
    melphin?: number,
  ): boolean {
    return this.evaluateAccessCondition(conn.access, flags, timePeriod, knownIntelIds, activeQuests, gameTime, inventory, melphin).allowed;
  }

  /**
   * Returns full access evaluation result.
   * bypassMessage / timePenalty are set only when normal access failed and bypass was triggered.
   * Used by buildSceneContext (DM hints) and GameController (applying time cost on move).
   */
  getConnectionAccessResult(
    conn: LocationConnection,
    flags: FlagSystem,
    timePeriod: TimePeriod,
    knownIntelIds: string[],
    activeQuests?: QuestInstance[],
    gameTime?: GameTime,
    inventory?: InventoryItem[],
    melphin?: number,
  ): { allowed: boolean; bypassMessage?: string; timePenalty?: number } {
    return this.evaluateAccessCondition(conn.access, flags, timePeriod, knownIntelIds, activeQuests, gameTime, inventory, melphin);
  }

  /**
   * Returns true if the player can enter this location.
   * Combines localVariant-resolved isAccessible with base.accessCondition.
   */
  canAccessLocation(
    locationId: string,
    flags: FlagSystem,
    timePeriod: TimePeriod,
    knownIntelIds: string[],
    activeQuests?: QuestInstance[],
    gameTime?: GameTime,
    inventory?: InventoryItem[],
    melphin?: number,
  ): boolean {
    const resolved = this.resolveLocation(locationId, flags);
    if (!resolved || !resolved.isAccessible) return false;
    const node = this.data.locations[locationId];
    return this.evaluateAccessCondition(node?.base.accessCondition, flags, timePeriod, knownIntelIds, activeQuests, gameTime, inventory, melphin).allowed;
  }

  // -- Districts -------------------------------------------------------

  getDistrict(id: string): DistrictIndex | undefined {
    return this.data.districts[id];
  }

  // -- Regions ---------------------------------------------------------

  getRegion(id: string): RegionIndex | undefined {
    return this.data.regions[id];
  }

  // -- Schedules -------------------------------------------------------

  getSchedule(regionId: string): RegionSchedule | undefined {
    return this.data.schedules[regionId];
  }

  // -- NPCs ------------------------------------------------------------

  getNPC(id: string): NPCNode | undefined {
    return this.data.npcs[id];
  }

  // Resolve NPC with phase overrides and optional time period filter applied.
  resolveNPC(id: string, flags: FlagSystem, timePeriod?: TimePeriod): NPCNode | undefined {
    const npc = this.data.npcs[id];
    if (!npc || !npc.isVisible) return undefined;
    if (timePeriod && npc.availablePeriods?.length && !npc.availablePeriods.includes(timePeriod)) return undefined;
    if (!npc.phaseOverrides) return npc;

    let patch: NPCOverride = {};
    for (const [condition, override] of Object.entries(npc.phaseOverrides)) {
      if (flags.evaluate(condition)) {
        patch = { ...patch, ...override };
      }
    }
    return { ...npc, ...patch };
  }

  getNPCsByIds(ids: string[], flags: FlagSystem, timePeriod?: TimePeriod): NPCNode[] {
    return ids
      .map(id => this.resolveNPC(id, flags, timePeriod))
      .filter((n): n is NPCNode => !!n);
  }

  // -- Dialogue Profiles -----------------------------------------------

  getDialogue(id: string): DialogueProfile | undefined {
    return this.data.dialogues[id];
  }

  getDialogueProfile(npcId: string, dialogueId: string): DialogueProfile | undefined {
    return this.data.dialogues[dialogueId] ?? this.data.dialogues[npcId];
  }

  // -- Events ----------------------------------------------------------

  getEvent(id: string): GameEvent | undefined {
    return this.data.events[id];
  }

  getEventsByIds(ids: string[]): GameEvent[] {
    return ids.map(id => this.data.events[id]).filter((e): e is GameEvent => !!e);
  }

  // -- Quests ----------------------------------------------------------

  getQuest(id: string): QuestDefinition | undefined {
    return this.data.quests[id];
  }

  getAllQuests(): QuestDefinition[] {
    return Object.values(this.data.quests);
  }

  // -- Factions --------------------------------------------------------

  getFaction(id: string): Faction | undefined {
    return this.data.factions[id];
  }

  // -- World phases ----------------------------------------------------

  getPhase(id: WorldPhaseId): WorldPhase | undefined {
    return this.data.phases.find(p => p.id === id);
  }

  // Returns the effects that should be applied for a given phase.
  // Caller (GameController / PhaseManager) is responsible for executing them.
  getPhaseEffects(phaseId: WorldPhaseId): PhaseEffect[] {
    return this.getPhase(phaseId)?.effects ?? [];
  }

  // -- Items -----------------------------------------------------------

  getItem(id: string): ItemNode | undefined {
    return this.data.items[id];
  }

  getAllItems(): ItemNode[] {
    return Object.values(this.data.items);
  }

  // -- Conditions ------------------------------------------------------

  getCondition(id: string): ConditionDefinition | undefined {
    return this.data.conditions[id];
  }

  getAllConditions(): ConditionDefinition[] {
    return Object.values(this.data.conditions);
  }

  // -- Encounters ------------------------------------------------------

  getEncounter(id: string): EncounterDefinition | undefined {
    return this.data.encounters[id];
  }

  // -- Debug catalog ---------------------------------------------------

  /** Returns all loadable IDs + display names for the debug launcher. */
  getDebugCatalog(): {
    encounters: { id: string; name: string; type: string }[];
    npcs:       { id: string; name: string; type: string }[];
    events:     { id: string; name: string }[];
    quests:     { id: string; name: string }[];
    locations:  { id: string; name: string }[];
  } {
    return {
      encounters: Object.values(this.data.encounters).map(e => ({ id: e.id, name: e.name, type: e.type ?? 'event' })),
      npcs:       Object.values(this.data.npcs).map(n => ({ id: n.id, name: n.name, type: n.type })),
      events:     Object.values(this.data.events).map(e => ({ id: e.id, name: e.name })),
      quests:     Object.values(this.data.quests).map(q => ({ id: q.id, name: q.name })),
      locations:  Object.values(this.data.locations).map(l => ({ id: l.id, name: l.name })),
    };
  }

  // -- DM scene context ------------------------------------------------

  /**
   * Build a structured scene context string for the DM system prompt.
   * npcMemory is optional; when provided, NPC lines include relationship history.
   * accessCtx is optional; when provided, locked connections are labeled as such.
   */
  buildSceneContext(
    locationId: string,
    flags: FlagSystem,
    npcMemory?: Record<string, NPCMemoryEntry>,
    accessCtx?: { timePeriod: TimePeriod; gameTime?: GameTime; knownIntelIds: string[]; activeQuests?: QuestInstance[]; inventory?: InventoryItem[]; melphin?: number },
  ): string {
    const resolved = this.resolveLocation(locationId, flags);
    if (!resolved) return '[Unknown location]';

    const npcs = this.getNPCsByIds(resolved.npcIds, flags, accessCtx?.timePeriod);

    const exits = resolved.connections
      .map(c => {
        const parts: string[] = ['- [' + c.targetLocationId + '] ' + c.description];
        if (c.travelNote) parts.push('travel: ' + c.travelNote);

        if (c.access) {
          const reqs: string[] = [];
          if (c.access.timePeriods?.length) reqs.push('time: ' + c.access.timePeriods.join('/'));
          if (c.access.flag)                reqs.push('flag: ' + c.access.flag);
          if (c.access.knowledgeIds?.length) reqs.push('knowledge: ' + c.access.knowledgeIds.join(', '));
          if (c.access.itemRequirements?.length) {
            const itemDescs = c.access.itemRequirements.map(r => r.itemId + (r.variantId ? ':' + r.variantId : ''));
            reqs.push('item: ' + itemDescs.join(', '));
          }
          if (c.access.minMelphin !== undefined) reqs.push('melphin: ' + c.access.minMelphin + '+');
          if (reqs.length) parts.push('[requires ' + reqs.join(' | ') + ']');

          // Show lock/bypass status when access context is provided
          if (accessCtx) {
            const result = this.getConnectionAccessResult(c, flags, accessCtx.timePeriod, accessCtx.knownIntelIds, accessCtx.activeQuests, accessCtx.gameTime, accessCtx.inventory, accessCtx.melphin);
            if (!result.allowed) {
              const msg = c.access.lockedMessage ?? '此通道目前無法通行';
              parts.push('[LOCKED: ' + msg + ']');
            } else if (result.bypassMessage || result.timePenalty !== undefined) {
              const bypassParts: string[] = [];
              if (result.bypassMessage) bypassParts.push(result.bypassMessage);
              if (result.timePenalty !== undefined) bypassParts.push('+' + result.timePenalty + 'min');
              parts.push('[BYPASS: ' + bypassParts.join(' | ') + ']');
            }
          }
        }

        return parts.join(' | ');
      })
      .join('\n');

    const npcLines = npcs
      .map(n => {
        // 公開描述永遠包含，秘密層依旗標條件追加
        const revealedSecrets = (n.secretLayers ?? [])
          .filter(s => flags.evaluate(s.condition))
          .map(s => s.context)
          .join(' ');
        const desc = n.publicDescription + (revealedSecrets ? ' | ' + revealedSecrets : '');
        const base = '- ' + n.name + ' (' + n.type + '): ' + desc;

        if (!npcMemory) return base;
        const mem = npcMemory[n.id];
        if (!mem) return base + ' [初次相遇]';
        const rel = '[已見過 ' + mem.interactionCount + ' 次, 上次於第 ' + mem.lastInteractedTurn + ' 回合]';
        return base + ' ' + rel;
      })
      .join('\n');

    const worldState = resolved.transitionNotes.length > 0
      ? '\n### World State\n' + resolved.transitionNotes.map(t => '- ' + t).join('\n')
      : '';

    // 象限 context：讓 DM 知道玩家身處哪個象限
    let districtLine = '';
    if (resolved.districtId) {
      const district = this.data.districts[resolved.districtId];
      if (district) {
        districtLine = 'District: ' + district.name +
          (district.ambience.length > 0 ? ' — ' + district.ambience.join(', ') : '');
      }
    }

    // 上層地點 context：讓 DM 知道玩家身處某建築/街區內部
    let parentLine = '';
    if (resolved.parentId) {
      const parent = this.resolveLocation(resolved.parentId, flags);
      if (parent) {
        parentLine = 'Inside: ' + parent.name +
          (parent.ambience.length > 0 ? ' (' + parent.ambience.join(', ') + ')' : '');
      }
    }

    return [
      '## Location: ' + resolved.name,
      districtLine ? districtLine : '',
      parentLine ? 'Inside: ' + parentLine : '',
      'Tags: ' + resolved.tags.join(', '),
      'Ambience: ' + resolved.ambience.join(', '),
      '',
      resolved.description,
      worldState,
      '',
      '### Exits',
      exits || '(none)',
      '',
      '### Present NPCs',
      npcLines || '(none)',
    ].filter(line => line !== '').join('\n');
  }
}
