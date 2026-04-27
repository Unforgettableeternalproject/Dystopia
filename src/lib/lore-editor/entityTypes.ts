/** All lore entity types the editor can handle. */
export type EntityType =
  | 'location' | 'npc' | 'event' | 'encounter' | 'dialogue'
  | 'quest' | 'item' | 'prop' | 'faction' | 'flag' | 'district';

export interface EntityTypeMeta {
  type: EntityType;
  label: string;
  icon: string;
  /** Relative path from lore root (crambell-specific for now) */
  dir: string;
}

export const ENTITY_TYPES: EntityTypeMeta[] = [
  { type: 'location',  label: '地點',  icon: '◈', dir: 'world/regions/crambell/locations' },
  { type: 'npc',       label: 'NPC',   icon: '◉', dir: 'world/regions/crambell/npcs' },
  { type: 'event',     label: '事件',  icon: '◆', dir: 'world/regions/crambell/events' },
  { type: 'encounter', label: '遭遇',  icon: '◇', dir: 'world/regions/crambell/encounters' },
  { type: 'dialogue',  label: '對話',  icon: '❝', dir: 'world/regions/crambell/dialogues' },
  { type: 'quest',     label: '任務',  icon: '◎', dir: 'world/regions/crambell/quests' },
  { type: 'item',      label: '道具',  icon: '□', dir: 'items' },
  { type: 'prop',      label: '物件',  icon: '▣', dir: 'world/regions/crambell/props' },
  { type: 'faction',   label: '派系',  icon: '⚑', dir: 'world/regions/crambell/factions' },
  { type: 'flag',      label: '旗標',  icon: '⚐', dir: 'world/regions/crambell/flags' },
  { type: 'district',  label: '區域',  icon: '▦', dir: 'world/regions/crambell/districts' },
];

export function getEntityMeta(type: EntityType): EntityTypeMeta {
  return ENTITY_TYPES.find(t => t.type === type)!;
}

/** Entity types that have dedicated form editors (rest use raw JSON). */
export const FORM_EDITOR_TYPES: EntityType[] = ['prop', 'item', 'faction', 'location', 'npc', 'event'];
