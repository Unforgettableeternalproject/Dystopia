// World / Lore entity types.
import type { ItemRequirement } from './item';
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
  /** 時段限制；省略 = 任何時段皆可出現 */
  availablePeriods?: TimePeriod[];
  phaseOverrides?: Record<string, NPCOverride>;  // flag expression -> patch
}

// ── Location ─────────────────────────────────────────────────────

/**
 * 任務階段參照。指向特定任務的特定進行階段。
 * 用於 AccessCondition.questStages，陣列內為 OR 關係（符合其中一個即可）。
 */
export interface QuestStageRef {
  questId: string;
  stageId: string;
}

/**
 * 精確時間範圍（遊戲內時鐘，24 小時制）。
 * 支援跨午夜，例如 { startHour: 22, startMinute: 0, endHour: 6, endMinute: 0 }。
 * 用於 ConnectionAccess.timeRanges，陣列內為 OR 關係（落在其中一個範圍即通過）。
 */
export interface GameTimeRange {
  startHour: number;    // 0–23
  startMinute: number;  // 0–59
  endHour: number;      // 0–23
  endMinute: number;    // 0–59
}

/**
 * 通道進入條件的繞過設定。
 * bypass 內所有欄位為 OR 關係——任一條件成立即可無視整個 access 的限制。
 * 省略整個 bypass 物件 = 不啟用繞過機制。
 */
export interface ConnectionBypass {
  /** 旗標表達式；evaluate 為 true 時繞過 access */
  flag?: string;
  /** 玩家持有其中任一情報 ID 即可繞過 */
  knowledgeIds?: string[];
  /** 玩家持有其中任一物品即可繞過（與 ConnectionAccess.itemRequirements 的 AND 邏輯相反，此處為 OR） */
  itemRequirements?: ItemRequirement[];
  /**
   * DM context：玩家以特殊方式通過時的提示語。
   * 例：「出示工頭牌後守衛揮手放行」
   */
  bypassMessage?: string;
  /**
   * bypass 通過時額外消耗的遊戲內時間（分鐘）。
   * 代表走迂迴路線、賄賂、交涉等需要額外時間的方式。
   * 省略 = 無額外時間成本。
   */
  timePenaltyMinutes?: number;
}

/**
 * 通道／地點進入條件。所有設定的欄位同時滿足才能通行（AND 關係）。
 * 省略整個 access 物件 = 永遠開放。
 */
export interface ConnectionAccess {
  /** 旗標表達式；evaluate 為 true 時開放 */
  flag?: string;
  /** 僅在這些時段（work/rest/special）開放；省略 = 任何時段皆可 */
  timePeriods?: TimePeriod[];
  /**
   * 精確時間範圍。陣列內為 OR — 當前時間落在其中任一範圍即通過。
   * 與 timePeriods 同為 AND 關係的獨立條件：兩者都設定時，兩者都必須通過。
   * 省略 = 無時鐘限制。
   */
  timeRanges?: GameTimeRange[];
  /** 玩家需擁有的情報 ID（knownIntelIds）；省略 = 無知識門檻 */
  knowledgeIds?: string[];
  /**
   * 任務階段限制。陣列內為 OR — 玩家只要正在進行其中一個 questId+stageId 組合即開放。
   * 省略 = 無任務限制。
   */
  questStages?: QuestStageRef[];
  /**
   * 物品持有需求（AND 關係）。玩家需持有所有指定的未失效物品才能通行。
   * 例：移動許可（特定象限變體）。省略 = 無物品門檻。
   */
  itemRequirements?: ItemRequirement[];
  /**
   * 最低持有梅分門檻。玩家持有梅分需大於等於此數值才能通行。
   * 省略 = 無貨幣門檻。
   */
  minMelphin?: number;
  /**
   * 條件不滿足時顯示給玩家的說明（由 DM 或 Regulator 傳遞）。
   * 例：「礦坑入口在休息時段關閉」、「此通道需要通行憑證」
   */
  lockedMessage?: string;
  /**
   * 繞過條件。bypass 內任一條件成立即可無視此 access 的所有限制（OR 覆蓋 AND）。
   * 省略 = 不啟用繞過機制。
   */
  bypass?: ConnectionBypass;
}

export interface LocationConnection {
  targetLocationId: string;
  description: string;           // player-facing exit label
  travelNote?: string;           // DM narration hint for the journey
  /**
   * 通道耗時（分鐘）。預設 5 分鐘。
   * 透過 bypass 路徑時，若 bypass 未設定 timePenaltyMinutes，系統自動加算 +20%。
   */
  traverseTime?: number;
  /** 進入條件；省略 = 永遠開放 */
  access?: ConnectionAccess;
}

export interface LocationBase {
  /**
   * 節點顯示名稱。設定後取代 LocationNode.name 作為玩家／DM 看到的具體地點名稱。
   * 適用於 area 節點：LocationNode.name = 區域概念（「綜合宿舍」），
   * base.name = 玩家實際站在的節點名稱（「宿舍大門」）。
   * 省略 = 沿用 LocationNode.name。
   */
  name?: string;
  description: string;           // DM scene description
  ambience: string[];            // mood keywords for DM tone
  connections: LocationConnection[];
  npcIds: string[];
  eventIds: string[];
  /**
   * 靜態可訪問預設值。false = 地點預設隱藏／封鎖，可由 localVariants 覆蓋。
   * 若需要動態條件（旗標、時段、任務階段），請同時設定 accessCondition。
   */
  isAccessible: boolean;
  /**
   * 動態進入條件。評估時機與 ConnectionAccess 相同（AND 關係）。
   * isAccessible 為靜態預設，accessCondition 提供額外的動態把關；
   * 兩者皆通過才允許進入。省略 = 不附加動態條件。
   */
  accessCondition?: ConnectionAccess;
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
  localVariants: LocalVariant[];
  /** 所屬象限/區塊 ID，對應 DistrictIndex.id */
  districtId?: string;
  /** 上層地點 ID；指向包含此地點的建築或街區（由 LoreVault 自動填入，無需手動設定） */
  parentId?: string;
  /** 地點層級；頂層地點不設此欄位（由 LoreVault 自動填入子地點） */
  locationType?: LocationType;
  /**
   * 是否自動在父地點與子地點之間建立雙向連線。預設 true。
   * 設為 false 可停用自動注入，適用於需要明確定義進出路線的線性地點
   * （如走廊、序列式關卡）。
   */
  enableDefaultConnection?: boolean;
  /**
   * 此地點內嵌的子地點。LoreVault 載入時會自動展開，
   * 以各自的 id 平攤進 locations dict，並繼承 parentId / regionId / districtId。
   * 子地點 JSON 不需要重複填寫這些欄位。
   */
  sublocations?: LocationNode[];
}

export interface ResolvedLocation {
  id: string;
  /** 有效節點名稱（base.name ?? node.name）。 */
  name: string;
  /**
   * 區域概念名稱。只在 base.name 存在時填入（= 原始 node.name）。
   * 子地點的「Inside:」context 應顯示此值，以呈現「身處哪個區域」。
   */
  areaName?: string;
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
  minEventCounters?: Record<string, number>;
  maxEventCounters?: Record<string, number>;
  exactEventCounters?: Record<string, number>;
  /** 事件只在這些時段觸發 */
  timePeriod?: TimePeriod[];
  /**
   * 可重複事件的冷卻（遊戲內分鐘數）。
   * 上次觸發後需等待至少這麼多分鐘才能再次觸發。
   * 0 或未設定 = 每回合都可觸發（若其他條件滿足）。
   */
  cooldownMinutes?: number;
  /** 至少一個 NPC 在當前場景中才觸發。 */
  npcIds?: string[];
  /**
   * 當遊戲時鐘跨越這些整點小時 (0–23) 時觸發。
   * 以本回合的時間推進量來判斷是否跨越邊界——即使一次行動
   * 跨越多個小時，每個邊界都會被偵測到。
   * 搭配 cooldownMinutes >= 55 防止同一小時內重複觸發。
   * 範例: triggerHours: [6, 22] 每天 6:00 和 22:00 各觸發一次。
   */
  triggerHours?: number[];
  /**
   * 指定任務必須為進行中（非完成、非失敗）才觸發。
   * 搭配 questStageId 可進一步限定特定任務階段。
   */
  questActiveId?: string;
  /**
   * 指定任務階段 ID。需同時設定 questActiveId。
   * 玩家當前的任務階段必須符合才觸發。
   */
  questStageId?: string;
  /**
   * 玩家持有的物品需求（AND 關係）。玩家需持有所有未失效的指定物品才能觸發。
   * 與 ConnectionAccess.itemRequirements 語意相同。
   */
  itemRequirements?: ItemRequirement[];
  /**
   * 反向物品條件：玩家未持有其中任何物品時才觸發（持有任一則封鎖）。
   * 直接比對 itemId，不考慮 variantId 與過期狀態。
   */
  notItemIds?: string[];
  /**
   * 最低梅分門檻。玩家持有梅分需大於等於此數值才能觸發。
   */
  minMelphin?: number;
}

/** 物品發放項目（用於 EventOutcome.grantItems） */
export interface EventGrantItem {
  itemId: string;
  variantId?: string;
}

export interface EventCounterWeightRule {
  counterId: string;
  valueWeights: Record<string, number>;
  fallback?: 'base' | 'nearest_lower';
}

export interface EventOutcome {
  id: string;
  condition?: string;
  /**
   * 無條件 outcome 的抽選權重（僅在同一事件有多個無條件 outcome 時生效）。
   * 預設為 1。有條件的 outcome 不受此欄位影響。
   */
  weight?: number;
  weightByEventCounter?: EventCounterWeightRule;
  description: string;
  flagsSet?: string[];
  flagsUnset?: string[];
  eventCounterSet?: Record<string, number>;
  eventCounterChanges?: Record<string, number>;
  eventCounterReset?: string[];
  statChanges?: Partial<Record<string, number>>;
  /** 授予任務（由 GameController 轉交 QuestEngine 處理） */
  grantQuestId?: string;
  /** 派系聲望變化，key 為 factionId，value 為 delta（可為負值） */
  reputationChanges?: Record<string, number>;
  /** NPC 好感變化，key 為 npcId，value 為 delta（可為負值） */
  affinityChanges?: Record<string, number>;
  /** 給予玩家物品列表 */
  grantItems?: EventGrantItem[];
  /** 觸發遭遇 ID（由 GameController 轉交 EncounterEngine 處理） */
  startEncounterId?: string;
  /**
   * 梅分變化（正 = 獲得，負 = 扣除）。
   * 由 StateManager.modifyMelphin 處理，不走 statChanges 的 dot-path。
   */
  melphinChange?: number;
  /**
   * 觸發指定任務的 onFail 效果並推進/失敗該任務（由 GameController 轉交 QuestEngine）。
   */
  failQuestId?: string;
}

export interface GameEvent {
  id: string;
  name?: string;
  locationId?: string;
  condition: EventCondition;
  description: string;
  outcomes: EventOutcome[];
  isRepeatable: boolean;
  /** 若為 true，觸發時以事件 name（或 id）為標題閃現短暫提示。沉默事件不設此欄位。 */
  notification?: boolean;
  /** Toast 樣式。預設 normal（藍）。negative=黃、danger=紅、rare=金（7 秒，帶光暈）。 */
  notificationVariant?: 'normal' | 'negative' | 'danger' | 'rare';
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

// ── Pathfinding ───────────────────────────────────────────────────

/** 單一路段的導航資訊（來源 → 目的地一步） */
export interface PathSegment {
  fromId: string;
  toId: string;
  connectionDescription: string;
  /** 此路段實際耗時（分鐘），已含 bypass 懲罰 */
  time: number;
  bypassUsed: boolean;
  bypassMessage?: string;
}

/**
 * `findPath` 回傳的路徑結果。
 * - `path`：有序地點 ID 清單（含起點與終點）
 * - `segments`：每個路段的詳細資訊
 * - `totalTime`：全程耗時（分鐘）
 * - `usedBypass`：任一路段使用了 bypass
 */
export interface PathResult {
  path: string[];
  segments: PathSegment[];
  totalTime: number;
  usedBypass: boolean;
}
