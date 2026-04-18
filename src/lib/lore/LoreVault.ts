// LoreVault — lore database access layer.
// Loads authored content from JSON; the DM only reads world data through here.

import type {
  LocationNode, ResolvedLocation,
  NPCNode, NPCOverride,
  GameEvent, Faction, RegionIndex,
  DistrictIndex,
} from '../types';
import type { DialogueTree } from '../types/dialogue';
import type { QuestDefinition } from '../types/quest';
import type { WorldPhase, WorldPhaseId, PhaseEffect } from '../types/phase';
import type { FlagSystem } from '../engine/FlagSystem';
import type { NPCMemoryEntry } from '../types/game';

interface LoreData {
  locations:  Record<string, LocationNode>;
  npcs:       Record<string, NPCNode>;
  events:     Record<string, GameEvent>;
  factions:   Record<string, Faction>;
  dialogues:  Record<string, DialogueTree>;
  quests:     Record<string, QuestDefinition>;
  phases:     WorldPhase[];
  regions:    Record<string, RegionIndex>;
  districts:  Record<string, DistrictIndex>;
}

export class LoreVault {
  private data: LoreData = {
    locations: {}, npcs: {}, events: {}, factions: {},
    dialogues: {}, quests: {}, phases: [], regions: {}, districts: {},
  };

  load(data: Partial<LoreData>): void {
    if (data.locations) Object.assign(this.data.locations, data.locations);
    if (data.npcs)       Object.assign(this.data.npcs,      data.npcs);
    if (data.events)     Object.assign(this.data.events,    data.events);
    if (data.factions)   Object.assign(this.data.factions,  data.factions);
    if (data.dialogues)  Object.assign(this.data.dialogues, data.dialogues);
    if (data.quests)     Object.assign(this.data.quests,    data.quests);
    if (data.regions)    Object.assign(this.data.regions,   data.regions);
    if (data.districts)  Object.assign(this.data.districts, data.districts);
    if (data.phases)     this.data.phases.push(...data.phases);
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

  // -- Districts -------------------------------------------------------

  getDistrict(id: string): DistrictIndex | undefined {
    return this.data.districts[id];
  }

  // -- NPCs ------------------------------------------------------------

  getNPC(id: string): NPCNode | undefined {
    return this.data.npcs[id];
  }

  // Resolve NPC with phase overrides applied.
  resolveNPC(id: string, flags: FlagSystem): NPCNode | undefined {
    const npc = this.data.npcs[id];
    if (!npc || !npc.isVisible) return undefined;
    if (!npc.phaseOverrides) return npc;

    let patch: NPCOverride = {};
    for (const [condition, override] of Object.entries(npc.phaseOverrides)) {
      if (flags.evaluate(condition)) {
        patch = { ...patch, ...override };
      }
    }
    return { ...npc, ...patch };
  }

  getNPCsByIds(ids: string[], flags: FlagSystem): NPCNode[] {
    return ids
      .map(id => this.resolveNPC(id, flags))
      .filter((n): n is NPCNode => !!n);
  }

  // -- Dialogues -------------------------------------------------------

  getDialogue(id: string): DialogueTree | undefined {
    return this.data.dialogues[id];
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

  // -- DM scene context ------------------------------------------------

  /**
   * Build a structured scene context string for the DM system prompt.
   * npcMemory is optional; when provided, NPC lines include relationship history.
   */
  buildSceneContext(
    locationId: string,
    flags: FlagSystem,
    npcMemory?: Record<string, NPCMemoryEntry>,
  ): string {
    const resolved = this.resolveLocation(locationId, flags);
    if (!resolved) return '[Unknown location]';

    const npcs = this.getNPCsByIds(resolved.npcIds, flags);

    const exits = resolved.connections
      .map(c => {
        const lock = c.condition ? ' [requires: ' + c.condition + ']' : '';
        return '- ' + c.description + lock;
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
