/** All lore entity types the editor can handle. */
export type EntityType =
  | 'location' | 'npc' | 'event' | 'encounter' | 'dialogue'
  | 'quest' | 'item' | 'prop' | 'faction' | 'flag' | 'district'
  | 'condition_def' | 'starter' | 'intel';

export interface EntityTypeMeta {
  type: EntityType;
  label: string;
  icon: string;
  /** Relative path from lore root (crambell-specific for now) */
  dir: string;
  /** If true, this type is a single global file, not a directory of files. */
  singleFile?: boolean;
  /** For singleFile types, the file path relative to lore root. */
  filePath?: string;
  /** Group label for sidebar display. */
  group?: 'region' | 'global';
}

export const ENTITY_TYPES: EntityTypeMeta[] = [
  // Region entities (crambell)
  { type: 'location',  label: '地點',  icon: '◈', dir: 'world/regions/crambell/locations', group: 'region' },
  { type: 'npc',       label: 'NPC',   icon: '◉', dir: 'world/regions/crambell/npcs', group: 'region' },
  { type: 'event',     label: '事件',  icon: '◆', dir: 'world/regions/crambell/events', group: 'region' },
  { type: 'encounter', label: '遭遇',  icon: '◇', dir: 'world/regions/crambell/encounters', group: 'region' },
  { type: 'dialogue',  label: '對話',  icon: '❝', dir: 'world/regions/crambell/dialogues', group: 'region' },
  { type: 'quest',     label: '任務',  icon: '◎', dir: 'world/regions/crambell/quests', group: 'region' },
  { type: 'item',      label: '道具',  icon: '□', dir: 'items', group: 'region' },
  { type: 'prop',      label: '物件',  icon: '▣', dir: 'world/regions/crambell/props', group: 'region' },
  { type: 'faction',   label: '派系',  icon: '⚑', dir: 'world/regions/crambell/factions', group: 'region' },
  { type: 'flag',      label: '旗標',  icon: '⚐', dir: 'world/regions/crambell/flags', group: 'region' },
  { type: 'intel',     label: '情報',  icon: '✦', dir: 'world/regions/crambell/intels', group: 'region' },
  { type: 'district',  label: '區域',  icon: '▦', dir: 'world/regions/crambell/districts', group: 'region' },
  // Global single-file types
  { type: 'condition_def', label: '狀態定義', icon: '⚕', dir: '', singleFile: true, filePath: 'world/conditions.json', group: 'global' },
  { type: 'starter',       label: '開場設定', icon: '▶', dir: '', singleFile: true, filePath: 'world/starter.json', group: 'global' },
];

export function getEntityMeta(type: EntityType): EntityTypeMeta {
  return ENTITY_TYPES.find(t => t.type === type)!;
}

/** Entity types that have dedicated form editors (rest use raw JSON). */
export const FORM_EDITOR_TYPES: EntityType[] = [
  'prop', 'item', 'faction', 'location', 'npc', 'event', 'quest',
  'dialogue', 'encounter', 'flag', 'district', 'condition_def', 'starter', 'intel',
];
