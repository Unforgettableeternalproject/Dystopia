// LoreLoader — aggregates all lore JSON files using Vite's import.meta.glob.
// Called once at game startup before controller.start().
//
// All glob paths are resolved relative to this file at build time.
// Schema files (_schema.json) are skipped automatically.

import type { GameController } from '../engine/GameController';
import type { StarterConfig }  from '../types';

// ── Eager globs (resolved at build time by Vite) ──────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const locationMods = import.meta.glob(
  '../../../lore/world/regions/crambell/locations/*.json', { eager: true }
) as Record<string, any>;

const npcMods = import.meta.glob(
  '../../../lore/world/regions/crambell/npcs/*.json', { eager: true }
) as Record<string, any>;

const eventMods = import.meta.glob(
  '../../../lore/world/regions/crambell/events/*.json', { eager: true }
) as Record<string, any>;

const factionMods = import.meta.glob(
  '../../../lore/world/regions/crambell/factions/*.json', { eager: true }
) as Record<string, any>;

const questMods = import.meta.glob(
  '../../../lore/world/regions/crambell/quests/*.json', { eager: true }
) as Record<string, any>;

const dialogueMods = import.meta.glob(
  '../../../lore/world/regions/crambell/dialogues/*.json', { eager: true }
) as Record<string, any>;

const districtMods = import.meta.glob(
  '../../../lore/world/regions/crambell/districts/*.json', { eager: true }
) as Record<string, any>;

const flagMods = import.meta.glob(
  '../../../lore/world/regions/crambell/flags/*.json', { eager: true }
) as Record<string, any>;

const encounterMods = import.meta.glob(
  '../../../lore/world/regions/crambell/encounters/*.json', { eager: true }
) as Record<string, any>;

const propMods = import.meta.glob(
  '../../../lore/world/regions/crambell/props/*.json', { eager: true }
) as Record<string, any>;

const crambellIndex = import.meta.glob(
  '../../../lore/world/regions/crambell/index.json', { eager: true }
) as Record<string, any>;

const crambellSchedule = import.meta.glob(
  '../../../lore/world/regions/crambell/schedule.json', { eager: true }
) as Record<string, any>;

const worldPhases = import.meta.glob(
  '../../../lore/world/phases.json', { eager: true }
) as Record<string, any>;

const conditionsMod = import.meta.glob(
  '../../../lore/world/conditions.json', { eager: true }
) as Record<string, any>;

const starterMod = import.meta.glob(
  '../../../lore/world/starter.json', { eager: true }
) as Record<string, any>;

const itemMods = import.meta.glob(
  '../../../lore/items/*.json', { eager: true }
) as Record<string, any>;

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Helpers ───────────────────────────────────────────────────────────────

function data(mod: Record<string, unknown>): unknown {
  return (mod as { default?: unknown }).default ?? mod;
}

/** Collect individual-object files (each has an 'id' field) into a Record keyed by id. */
function byId(mods: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, mod] of Object.entries(mods)) {
    if (path.includes('_schema')) continue;
    const d = data(mod) as { id?: string } | null;
    if (d && d.id) out[d.id] = d;
  }
  return out;
}

/** Collect array files (flags manifest) by concatenating all entries. */
function concatArrays(mods: Record<string, Record<string, unknown>>): unknown[] {
  const out: unknown[] = [];
  for (const [path, mod] of Object.entries(mods)) {
    if (path.includes('_schema')) continue;
    const d = data(mod);
    if (Array.isArray(d)) out.push(...d);
  }
  return out;
}

/** Get the single data object from a single-file glob. */
function single(mods: Record<string, Record<string, unknown>>): unknown {
  const entries = Object.entries(mods);
  if (entries.length === 0) return undefined;
  return data(entries[0][1]);
}

// ── Public loader ─────────────────────────────────────────────────────────

/**
 * Load all Crambell lore into the GameController's LoreVault.
 * Call this before controller.start().
 */
export function loadCrambellLore(controller: GameController): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controller.loadLore({
    locations:    byId(locationMods)   as any,
    npcs:         byId(npcMods)        as any,
    events:       byId(eventMods)      as any,
    factions:     byId(factionMods)    as any,
    quests:       byId(questMods)      as any,
    dialogues:    byId(dialogueMods)   as any,
    districts:    byId(districtMods)    as any,
    encounters:   byId(encounterMods)   as any,
    props:        byId(propMods)        as any,
    flagManifest: concatArrays(flagMods) as any,
  });

  // Region index
  const idx = single(crambellIndex) as { id?: string } | undefined;
  if (idx?.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller.loadLore({ regions: { [idx.id]: idx as any } });
  }

  // Schedule (keyed by regionId)
  const sched = single(crambellSchedule) as { regionId?: string } | undefined;
  if (sched?.regionId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller.loadLore({ schedules: { [sched.regionId]: sched as any } });
  }

  // World phases (array)
  const phases = single(worldPhases);
  if (Array.isArray(phases)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller.loadLore({ phases: phases as any });
  }

  // Condition definitions (global, keyed by id)
  const conds = single(conditionsMod);
  if (conds && typeof conds === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller.loadLore({ conditions: conds as any });
  }

  // Items (global, keyed by id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controller.loadLore({ items: byId(itemMods) as any });


  // Starter config
  const starter = single(starterMod);
  if (starter) {
    controller.loadStarter(starter as StarterConfig);
  }
}
