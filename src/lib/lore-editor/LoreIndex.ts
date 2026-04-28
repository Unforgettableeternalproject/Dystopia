/**
 * LoreIndex — scans all lore files, builds reverse reference maps,
 * and detects broken references.
 */
import { ENTITY_TYPES, type EntityType } from './entityTypes';
import { listLoreDir, readLoreFile } from './fileUtils';

export interface RefEntry {
  /** The entity that contains the reference. */
  sourceId: string;
  sourceType: EntityType;
  /** The field path where the reference was found. */
  fieldPath: string;
  /** The referenced entity ID. */
  targetId: string;
  /** The expected type of the referenced entity. */
  targetType: EntityType;
}

export interface LoreIndexData {
  /** All known entity IDs by type. */
  allIds: Map<EntityType, Set<string>>;
  /** Reverse references: targetId → list of entities that reference it. */
  reverseRefs: Map<string, RefEntry[]>;
  /** Broken references: references pointing to non-existent IDs. */
  brokenRefs: RefEntry[];
  /** Total entity count. */
  totalEntities: number;
}

/**
 * Build a complete LoreIndex by scanning all lore files.
 */
export async function buildLoreIndex(): Promise<LoreIndexData> {
  const allIds = new Map<EntityType, Set<string>>();
  const allRefs: RefEntry[] = [];

  // Step 1: Scan all entities and collect IDs + references
  for (const meta of ENTITY_TYPES) {
    const idSet = new Set<string>();
    allIds.set(meta.type, idSet);

    try {
      const files = await listLoreDir(meta.dir);
      for (const file of files) {
        idSet.add(file.id);
        try {
          const text = await readLoreFile(file.path);
          const parsed = JSON.parse(text);
          const refs = extractRefs(file.id, meta.type, parsed);
          allRefs.push(...refs);
        } catch { /* skip unparseable files */ }
      }
    } catch { /* skip missing directories */ }
  }

  // Step 2: Build reverse map and detect broken refs
  const reverseRefs = new Map<string, RefEntry[]>();
  const brokenRefs: RefEntry[] = [];

  for (const ref of allRefs) {
    // Build reverse map
    if (!reverseRefs.has(ref.targetId)) reverseRefs.set(ref.targetId, []);
    reverseRefs.get(ref.targetId)!.push(ref);

    // Check if target exists
    const targetIds = allIds.get(ref.targetType);
    if (!targetIds || !targetIds.has(ref.targetId)) {
      brokenRefs.push(ref);
    }
  }

  let totalEntities = 0;
  for (const set of allIds.values()) totalEntities += set.size;

  return { allIds, reverseRefs, brokenRefs, totalEntities };
}

// ── Reference extraction by entity type ──

function extractRefs(sourceId: string, sourceType: EntityType, data: unknown): RefEntry[] {
  if (!data || typeof data !== 'object') return [];
  const refs: RefEntry[] = [];
  const d = data as Record<string, unknown>;

  const add = (targetId: string, targetType: EntityType, fieldPath: string) => {
    if (targetId && typeof targetId === 'string' && !targetId.startsWith('_')) {
      refs.push({ sourceId, sourceType, fieldPath, targetId, targetType });
    }
  };

  const addArr = (arr: unknown, targetType: EntityType, fieldPath: string) => {
    if (Array.isArray(arr)) arr.forEach((id, i) => add(id as string, targetType, `${fieldPath}[${i}]`));
  };

  const addKeys = (obj: unknown, targetType: EntityType, fieldPath: string) => {
    if (obj && typeof obj === 'object') {
      Object.keys(obj as Record<string, unknown>).forEach(k => add(k, targetType, `${fieldPath}.${k}`));
    }
  };

  switch (sourceType) {
    case 'location':
      extractLocationRefs(d, refs, add, addArr);
      break;
    case 'npc':
      add(d.defaultLocationId as string, 'location', 'defaultLocationId');
      add(d.factionId as string, 'faction', 'factionId');
      add(d.dialogueId as string, 'dialogue', 'dialogueId');
      addArr(d.questIds, 'quest', 'questIds');
      if (Array.isArray(d.schedule)) {
        (d.schedule as Record<string, unknown>[]).forEach((s, i) => add(s.locationId as string, 'location', `schedule[${i}].locationId`));
      }
      if (Array.isArray(d.dialogueRules)) {
        (d.dialogueRules as Record<string, unknown>[]).forEach((r, i) => add(r.dialogueId as string, 'dialogue', `dialogueRules[${i}].dialogueId`));
      }
      break;
    case 'event':
      if (typeof d.locationId === 'string') add(d.locationId, 'location', 'locationId');
      else if (Array.isArray(d.locationId)) addArr(d.locationId, 'location', 'locationId');
      extractConditionRefs(d.condition, refs, sourceId, sourceType, 'condition');
      if (Array.isArray(d.outcomes)) {
        (d.outcomes as Record<string, unknown>[]).forEach((o, i) => {
          add(o.startEncounterId as string, 'encounter', `outcomes[${i}].startEncounterId`);
          add(o.grantQuestId as string, 'quest', `outcomes[${i}].grantQuestId`);
          add(o.failQuestId as string, 'quest', `outcomes[${i}].failQuestId`);
          extractItemGrants(o.grantItems, refs, sourceId, sourceType, `outcomes[${i}].grantItems`);
          addKeys(o.reputationChanges, 'faction', `outcomes[${i}].reputationChanges`);
          addKeys(o.affinityChanges, 'npc', `outcomes[${i}].affinityChanges`);
        });
      }
      break;
    case 'encounter':
      if (d.nodes && typeof d.nodes === 'object') {
        for (const [nid, node] of Object.entries(d.nodes as Record<string, Record<string, unknown>>)) {
          extractEffectsRefs(node.effects, refs, sourceId, sourceType, `nodes.${nid}.effects`);
          if (Array.isArray(node.choices)) {
            (node.choices as Record<string, unknown>[]).forEach((c, ci) => {
              extractEffectsRefs(c.effects, refs, sourceId, sourceType, `nodes.${nid}.choices[${ci}].effects`);
              extractItemReqs(c.itemRequirements, refs, sourceId, sourceType, `nodes.${nid}.choices[${ci}].itemRequirements`);
            });
          }
        }
      }
      if (Array.isArray(d.script)) {
        (d.script as Record<string, unknown>[]).forEach((line, li) => {
          extractEffectsRefs(line.effects, refs, sourceId, sourceType, `script[${li}].effects`);
        });
      }
      extractEffectsRefs((d.result as Record<string, unknown>)?.effects, refs, sourceId, sourceType, 'result.effects');
      break;
    case 'dialogue':
      add(d.npcId as string, 'npc', 'npcId');
      if (d.nodes && typeof d.nodes === 'object') {
        for (const [nid, node] of Object.entries(d.nodes as Record<string, Record<string, unknown>>)) {
          if (Array.isArray(node.choices)) {
            (node.choices as Record<string, unknown>[]).forEach((c, ci) => {
              extractItemReqs(c.itemRequirements, refs, sourceId, sourceType, `nodes.${nid}.choices[${ci}].itemRequirements`);
              const eff = c.effects as Record<string, unknown> | undefined;
              if (eff) {
                add(eff.grantQuest as string, 'quest', `nodes.${nid}.choices[${ci}].effects.grantQuest`);
              }
            });
          }
        }
      }
      break;
    case 'quest':
      if (d.stages && typeof d.stages === 'object') {
        for (const [sid, stage] of Object.entries(d.stages as Record<string, Record<string, unknown>>)) {
          const onFail = stage.onFail as Record<string, unknown> | undefined;
          if (onFail) add(onFail.startEventId as string, 'event', `stages.${sid}.onFail.startEventId`);
        }
      }
      break;
    case 'faction':
      if (Array.isArray(d.relations)) {
        (d.relations as Record<string, unknown>[]).forEach((r, i) => add(r.targetFactionId as string, 'faction', `relations[${i}].targetFactionId`));
      }
      break;
    case 'district':
      addArr(d.locationIds, 'location', 'locationIds');
      break;
  }

  return refs;
}

function extractLocationRefs(
  d: Record<string, unknown>,
  refs: RefEntry[],
  add: (id: string, type: EntityType, path: string) => void,
  addArr: (arr: unknown, type: EntityType, path: string) => void,
) {
  const scanBase = (base: Record<string, unknown>, prefix: string) => {
    addArr(base.npcIds, 'npc', `${prefix}.npcIds`);
    addArr(base.eventIds, 'event', `${prefix}.eventIds`);
    addArr(base.propIds, 'prop', `${prefix}.propIds`);
    if (Array.isArray(base.connections)) {
      (base.connections as Record<string, unknown>[]).forEach((c, i) => {
        add(c.targetLocationId as string, 'location', `${prefix}.connections[${i}].targetLocationId`);
      });
    }
  };
  if (d.base && typeof d.base === 'object') scanBase(d.base as Record<string, unknown>, 'base');
  if (Array.isArray(d.sublocations)) {
    (d.sublocations as Record<string, unknown>[]).forEach((sub, i) => {
      if (sub.base && typeof sub.base === 'object') scanBase(sub.base as Record<string, unknown>, `sublocations[${i}].base`);
    });
  }
}

function extractConditionRefs(
  cond: unknown, refs: RefEntry[], sourceId: string, sourceType: EntityType, prefix: string,
) {
  if (!cond || typeof cond !== 'object') return;
  const c = cond as Record<string, unknown>;
  const add = (id: string, type: EntityType, path: string) => {
    if (id && typeof id === 'string') refs.push({ sourceId, sourceType, fieldPath: path, targetId: id, targetType: type });
  };
  if (Array.isArray(c.npcIds)) c.npcIds.forEach((id, i) => add(id as string, 'npc', `${prefix}.npcIds[${i}]`));
  add(c.questActiveId as string, 'quest', `${prefix}.questActiveId`);
  extractItemReqs(c.itemRequirements, refs, sourceId, sourceType, `${prefix}.itemRequirements`);
}

function extractEffectsRefs(
  effects: unknown, refs: RefEntry[], sourceId: string, sourceType: EntityType, prefix: string,
) {
  if (!effects || typeof effects !== 'object') return;
  const e = effects as Record<string, unknown>;
  const add = (id: string, type: EntityType, path: string) => {
    if (id && typeof id === 'string') refs.push({ sourceId, sourceType, fieldPath: path, targetId: id, targetType: type });
  };
  add(e.grantQuestId as string, 'quest', `${prefix}.grantQuestId`);
  add(e.failQuestId as string, 'quest', `${prefix}.failQuestId`);
  add(e.movePlayer as string, 'location', `${prefix}.movePlayer`);
  add(e.startEncounterId as string, 'encounter', `${prefix}.startEncounterId`);
  extractItemGrants(e.grantItems, refs, sourceId, sourceType, `${prefix}.grantItems`);
  if (e.reputationChanges && typeof e.reputationChanges === 'object') {
    Object.keys(e.reputationChanges as Record<string, unknown>).forEach(k =>
      refs.push({ sourceId, sourceType, fieldPath: `${prefix}.reputationChanges.${k}`, targetId: k, targetType: 'faction' }));
  }
  if (e.affinityChanges && typeof e.affinityChanges === 'object') {
    Object.keys(e.affinityChanges as Record<string, unknown>).forEach(k =>
      refs.push({ sourceId, sourceType, fieldPath: `${prefix}.affinityChanges.${k}`, targetId: k, targetType: 'npc' }));
  }
  if (e.advanceQuestStage && typeof e.advanceQuestStage === 'object') {
    add((e.advanceQuestStage as Record<string, unknown>).questId as string, 'quest', `${prefix}.advanceQuestStage.questId`);
  }
  if (e.completeQuestObjective && typeof e.completeQuestObjective === 'object') {
    add((e.completeQuestObjective as Record<string, unknown>).questId as string, 'quest', `${prefix}.completeQuestObjective.questId`);
  }
}

function extractItemReqs(
  reqs: unknown, refs: RefEntry[], sourceId: string, sourceType: EntityType, prefix: string,
) {
  if (!Array.isArray(reqs)) return;
  reqs.forEach((r, i) => {
    const req = r as Record<string, unknown>;
    if (req.itemId && typeof req.itemId === 'string') {
      refs.push({ sourceId, sourceType, fieldPath: `${prefix}[${i}].itemId`, targetId: req.itemId, targetType: 'item' });
    }
  });
}

function extractItemGrants(
  grants: unknown, refs: RefEntry[], sourceId: string, sourceType: EntityType, prefix: string,
) {
  if (!Array.isArray(grants)) return;
  grants.forEach((g, i) => {
    const grant = g as Record<string, unknown>;
    if (grant.itemId && typeof grant.itemId === 'string') {
      refs.push({ sourceId, sourceType, fieldPath: `${prefix}[${i}].itemId`, targetId: grant.itemId, targetType: 'item' });
    }
  });
}
