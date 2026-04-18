// World / Lore entity types.
// Dialogue is a separate type (see dialogue.ts).
// Quest definitions are in quest.ts.
// World phase effects are in phase.ts.

// ── NPC ──────────────────────────────────────────────────────────

export type NPCType = 'stationed' | 'quest' | 'wandering';

/**
 * NPC 的單層知識。每層有自己的解鎖條件，只有在 flags 滿足時
 * 該層的 context 才會被加入 DM 的場景 prompt。
 *
 * 設計原則：
 * - 每層描述「玩家在這個知識深度所能感知到的資訊」
 * - 層與層之間可以獨立解鎖（知道 A 不代表知道 B）
 * - 不要在同一層混入需要不同路線才能得到的資訊
 */
export interface NPCSecretLayer {
  id: string;
  /** 設計備注：這層代表什麼資訊（不出現在 prompt 中） */
  label: string;
  /** 旗標運算式；為 true 時此層 context 被加入 DM prompt */
  condition: string;
  /** 此層解鎖後 DM 額外獲得的角色 context */
  context: string;
  /** 此層解鎖後切換的對話樹 ID（選填） */
  dialogueId?: string;
}

/**
 * phaseOverrides：只處理狀態/行為變化（位置、可見性、對話樹）。
 * 描述層的知識變化請用 NPCNode.secretLayers，不要在這裡加 description。
 */
export interface NPCOverride {
  dialogueId?: string;
  isVisible?: boolean;
  baseLocationId?: string;
}

export interface NPCNode {
  id: string;
  name: string;
  type: NPCType;
  baseLocationId: string;        // primary location (wandering type may change at runtime)
  factionId?: string;
  /** DM 永遠可見的表面資訊，只寫公開人設，不含任何秘密 */
  publicDescription: string;
  /** 知識層：依旗標條件分層揭露給 DM 的角色深度資訊 */
  secretLayers?: NPCSecretLayer[];
  dialogueId: string;            // points to dialogues/<id>.json
  questIds?: string[];
  isVisible: boolean;
  phaseOverrides?: Record<string, NPCOverride>;  // flag expression -> patch
}

// ── Location ─────────────────────────────────────────────────────

export interface LocationConnection {
  targetLocationId: string;
  condition?: string;            // flag expression; omit = always open
  description: string;           // player-facing exit label
  travelNote?: string;           // DM narration hint for the journey
}

export interface LocationBase {
  description: string;           // DM scene description
  ambience: string[];            // mood keywords for DM tone
  connections: LocationConnection[];
  npcIds: string[];
  eventIds: string[];
  isAccessible: boolean;
}

// LocalVariant: for changes scoped to this location only (e.g. mine collapse).
// Cross-location changes (e.g. region-wide lockdown) belong in phases.json.
export interface LocalVariant {
  id: string;
  label: string;
  condition: string;             // flag expression
  priority: number;
  description?: string;
  ambience?: string[];
  connections?: LocationConnection[];
  isAccessible?: boolean;
  addNpcIds?: string[];
  removeNpcIds?: string[];
  addEventIds?: string[];
  removeEventIds?: string[];
  transitionNote?: string;
}

/**
 * 地點層級類型。
 * undefined = 區域內的頂層地點（如一條街、一棟建築）
 * 'area'        = 建築／街區級別的中層地點
 * 'sublocation' = 房間／角落等最小粒度地點
 *
 * 導航仍由 connections 決定；此欄位僅提供層級語意，
 * 讓 DM 能在場景 context 中正確表達「身處某建築內部」。
 */
export type LocationType = 'area' | 'sublocation';

export interface LocationNode {
  id: string;
  name: string;
  regionId: string;
  tags: string[];
  base: LocationBase;
  localVariants: LocalVariant[];  // local-only changes; renamed from 'variants'
  /** 所屬象限/區塊 ID，對應 DistrictIndex.id */
  districtId?: string;
  /** 上層地點 ID；指向包含此地點的建築或街區 */
  parentId?: string;
  /** 地點層級；頂層地點不設此欄位 */
  locationType?: LocationType;
}

export interface ResolvedLocation {
  id: string;
  name: string;
  regionId: string;
  tags: string[];
  description: string;
  ambience: string[];
  connections: LocationConnection[];
  npcIds: string[];
  eventIds: string[];
  isAccessible: boolean;
  activeVariants: string[];
  transitionNotes: string[];
  /** 對應 LocationNode 的層級欄位，解析後直接透傳 */
  districtId?: string;
  parentId?: string;
  locationType?: LocationType;
}

// ── Time ─────────────────────────────────────────────────────────

/**
 * 遊戲內時段。
 * 'work'    = 作業時段（如礦工換班期間）
 * 'rest'    = 休息時段（下班後至次日開工前）
 * 'special' = 特殊時段（由旗標觸發，如公開處罰、緊急廣播）
 */
export type TimePeriod = 'work' | 'rest' | 'special';

/** 單一時段的起止定義 */
export interface PeriodDefinition {
  id: TimePeriod;
  label: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

/**
 * 區域時間表。
 * 定義該區域的作業/休息時段邊界，以及觸發特殊時段的旗標。
 * 儲存於 lore/world/regions/<region>/schedule.json。
 */
export interface RegionSchedule {
  regionId: string;
  periods: PeriodDefinition[];
  /** 若此旗標存在，強制將當前時段設為 'special' */
  specialPeriodFlag?: string;
}

// ── Event ────────────────────────────────────────────────────────

export interface EventCondition {
  flags?: string[];
  anyFlags?: string[];
  notFlags?: string[];                // 這些旗標全部不存在時才觸發
  minStats?: Partial<Record<string, number>>;
  /** 事件只在這些時段觸發 */
  timePeriod?: TimePeriod[];
  /**
   * 可重複事件的冷卻（遊戲內分鐘數）。
   * 上次觸發後需等待至少這麼多分鐘才能再次觸發。
   * 0 或未設定 = 每回合都可觸發（若其他條件滿足）。
   */
  cooldownMinutes?: number;
}

export interface EventOutcome {
  id: string;
  condition?: string;
  description: string;
  flagsSet?: string[];
  flagsUnset?: string[];
  statChanges?: Partial<Record<string, number>>;
}

export interface GameEvent {
  id: string;
  locationId?: string;
  condition: EventCondition;
  description: string;
  outcomes: EventOutcome[];
  isRepeatable: boolean;
}

// ── Faction ──────────────────────────────────────────────────────

export interface Faction {
  id: string;
  name: string;
  regionId: string | null;    // null = cross-region (global) faction
  description: string;
  defaultReputation: number;
}

// ── Region index ─────────────────────────────────────────────────

export interface RegionIndex {
  id: string;
  name: string;
  altNames?: string[];
  theme: string;
  startingLocationId?: string;
  locationIds: string[];
  npcIds: string[];
  questIds: string[];
  factionIds: string[];
  /** 此區域內所有象限/區塊的 ID 列表 */
  districtIds?: string[];
  /**
   * 全域事件 ID 列表（不綁定地點）。
   * 每回合由 EventEngine.checkGlobalEvents() 統一檢查。
   * 通常用於時段轉換、廣播、天氣等跨地點事件。
   */
  globalEventIds?: string[];
}

// ── Flag Manifest ────────────────────────────────────────────────

/**
 * 旗標的近接條件。
 * 只有在滿足這些條件時，此旗標的 manifest entry 才會被注入 DM 的 context。
 * 條件之間為 AND 關係；每個陣列內部亦為 AND（anyFlags 除外為 OR）。
 */
export interface FlagProximity {
  /** 玩家身處這些地點時才顯示 */
  locationIds?: string[];
  /** 玩家身處這些象限時才顯示 */
  districtIds?: string[];
  /** 玩家持有這些進行中任務時才顯示 */
  questIds?: string[];
  /** 這些旗標全部存在時才顯示 */
  flags?: string[];
  /** 這些旗標至少一個存在時才顯示 */
  anyFlags?: string[];
  /** 這些旗標全部不存在時才顯示（例如：旗標尚未設置才需要顯示） */
  notFlags?: string[];
  /** 只在這些時段顯示 */
  timePeriod?: TimePeriod[];
}

/**
 * 單一旗標的 DM 操作說明。
 * 儲存於 lore/world/regions/<region>/flags/*.json。
 *
 * DM 看到的格式（過濾後）：
 *   FLAG [flagId]: description
 *   → Set when:   setCondition
 *   → Unset when: unsetCondition (若有)
 */
export interface FlagManifestEntry {
  flagId: string;
  /** DM-facing：此旗標代表什麼狀態，用一句話描述 */
  description: string;
  /** DM-facing：玩家做了什麼事才應設置此旗標 */
  setCondition: string;
  /** DM-facing：在什麼情況下應清除此旗標（省略 = 永久，不回收） */
  unsetCondition?: string;
  proximity: FlagProximity;
}

// ── District ──────────────────────────────────────────────────────

/**
 * 象限/區塊索引。
 * 位於 Region（國家）與 Location（地點）之間的中間層。
 * 用於：DM 場景 context 的地理定位、進出區塊的關卡邏輯。
 *
 * 導航仍由 LocationConnection 決定；
 * 此層提供「玩家身處哪個象限」的語意，不替代圖結構。
 */
export interface DistrictIndex {
  id: string;
  name: string;
  regionId: string;
  description: string;           // DM-facing 象限概述
  ambience: string[];            // 氛圍關鍵字
  /**
   * 此象限的進出是否需要通過關卡。
   * true 時，跨象限的 LocationConnection 應設定 condition 指向對應旗標。
   */
  hasCheckpoint: boolean;
  /** 進出關卡的旗標 ID，hasCheckpoint 為 true 時使用 */
  checkpointFlag?: string;
  locationIds: string[];
}
