// -- LoreVault ---
// Lore database access layer. Loads from JSON, provides indexed queries.
// The DM should only obtain world data through this layer.

import type {
  LocationNode,
  ResolvedLocation,
  NPCNode,
  GameEvent,
  Faction,
} from "../types";
import type { FlagSystem } from "../engine/FlagSystem";

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

  load(data: Partial<LoreData>): void {
    if (data.locations) Object.assign(this.data.locations, data.locations);
    if (data.npcs) Object.assign(this.data.npcs, data.npcs);
    if (data.events) Object.assign(this.data.events, data.events);
    if (data.factions) Object.assign(this.data.factions, data.factions);
  }

  // -- Locations ---

  getLocation(id: string): LocationNode | undefined {
    return this.data.locations[id];
  }

  // Compute the effective state of a location given current flags.
  // All active variants (sorted ascending by priority) are merged onto base.
  // connections: full replacement; npcIds/eventIds: additive/subtractive.
  resolveLocation(id: string, flags: FlagSystem): ResolvedLocation | undefined {
    const node = this.data.locations[id];
    if (!node) return undefined;

    let description = node.base.description;
    let ambience = [...node.base.ambience];
    let connections = [...node.base.connections];
    const npcIds = new Set<string>(node.base.npcIds);
    const eventIds = new Set<string>(node.base.eventIds);
    let isAccessible = node.base.isAccessible;

    const activeVariants: string[] = [];
    const transitionNotes: string[] = [];

    const sorted = [...node.variants].sort((a, b) => a.priority - b.priority);

    for (const v of sorted) {
      if (!flags.evaluate(v.condition)) continue;

      activeVariants.push(v.id);

      if (v.description !== undefined) description = v.description;
      if (v.ambience !== undefined) ambience = [...v.ambience];
      if (v.connections !== undefined) connections = [...v.connections];
      if (v.isAccessible !== undefined) isAccessible = v.isAccessible;

      v.addNpcIds?.forEach((nid) => npcIds.add(nid));
      v.removeNpcIds?.forEach((nid) => npcIds.delete(nid));
      v.addEventIds?.forEach((eid) => eventIds.add(eid));
      v.removeEventIds?.forEach((eid) => eventIds.delete(eid));

      if (v.transitionNote) transitionNotes.push(v.transitionNote);
    }

    return {
      id: node.id,
      name: node.name,
      regionId: node.regionId,
      tags: node.tags,
      description,
      ambience,
      connections,
      npcIds: Array.from(npcIds),
      eventIds: Array.from(eventIds),
      isAccessible,
      activeVariants,
      transitionNotes,
    };
  }

  getLocationsByRegion(regionId: string): LocationNode[] {
    return Object.values(this.data.locations).filter(
      (loc) => loc.regionId === regionId
    );
  }

  // -- NPCs ---

  getNPC(id: string): NPCNode | undefined {
    return this.data.npcs[id];
  }

  getNPCsByIds(ids: string[]): NPCNode[] {
    return ids
      .map((id) => this.data.npcs[id])
      .filter((npc): npc is NPCNode => !!npc && npc.isVisible);
  }

  // -- Events ---

  getEvent(id: string): GameEvent | undefined {
    return this.data.events[id];
  }

  getEventsByIds(ids: string[]): GameEvent[] {
    return ids
      .map((id) => this.data.events[id])
      .filter((evt): evt is GameEvent => !!evt);
  }

  // -- Factions ---

  getFaction(id: string): Faction | undefined {
    return this.data.factions[id];
  }

  // -- Scene context for DM ---
  // Builds a lore subset string for the DM for the current location.
  // Always passes flags so the DM sees the world as it currently is.
  buildSceneContext(locationId: string, flags: FlagSystem): string {
    const resolved = this.resolveLocation(locationId, flags);
    if (!resolved) return "[Unknown location]";

    const npcs = this.getNPCsByIds(resolved.npcIds);

    const connectionLines = resolved.connections
      .map((c) => {
        const lock = c.condition ? ` [requires: ${c.condition}]` : "";
        return `- ${c.description}${lock}`;
      })
      .join("\n");

    const npcLines = npcs
      .map((n) => `- ${n.name} (${n.type}): ${n.description}`)
      .join("\n");

    const worldStateSection =
      resolved.transitionNotes.length > 0
        ? "\n### World State\n" +
          resolved.transitionNotes.map((note) => `- ${note}`).join("\n")
        : "";

    return [
      `## Location: ${resolved.name}`,
      `Tags: ${resolved.tags.join(", ")}`,
      `Ambience: ${resolved.ambience.join(", ")}`,
      "",
      resolved.description,
      worldStateSection,
      "",
      "### Exits",
      connectionLines || "(none)",
      "",
      "### Present NPCs",
      npcLines || "(none)",
    ].join("\n");
  }
}
