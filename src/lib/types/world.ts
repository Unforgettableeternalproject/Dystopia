// World / Lore entity types.
import type { ItemRequirement } from './item';
// Dialogue is a separate type (see dialogue.ts).
// Quest definitions are in quest.ts.
// World phase effects are in phase.ts.

// ── NPC ──────────────────────────────────────────────────────────

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
}

/**
 * NPC 位置排程項目。
 * condition 成立時，NPC 出現在 locationId 指定的地點。
 * locationId 省略 = 此條件下 NPC 不在任何地方（暫時消失）。
 */
export interface NPCScheduleEntry {
  id: string;
  /** 設計備注（不出現在 prompt 中） */
  label: string;
  /** 旗標運算式；為 true 時套用此項目 */
  condition: string;
  /** NPC 所在地點；省略 = 不在任何地方 */
  locationId?: string;
  /** 優先序；數值高者優先；相同優先序取第一個成立的 */
  priority: number;
  /** 額外時段限制；省略 = 不限時段 */
  timePeriods?: TimePeriod[];
  timeRanges?: GameTimeRange[];
}

/**
 * 條件式對話樹切換。
 * condition 成立時，NPC 的對話樹改為 dialogueId。
 */
export interface NPCDialogueRule {
  id: string;
  /** 設計備注（不出現在 prompt 中） */
  label: string;
  /** 旗標運算式；為 true 時套用此規則 */
  condition: string;
  dialogueId: string;
  /** 優先序；數值高者優先 */
  priority: number;
}

/**
 * NPC 認知觸發規則。
 * 累積與此 NPC 的互動次數達到 interactionCount 後，
 * 自動在 npcMemory[npcId].flags 中設置 flagId。
 * 可附加前置旗標條件（全局旗標運算式）。
 */
export interface NPCKnowledgeTrigger {
  /** 要設置的 NPC 本地旗標 ID */
  flagId: string;
  /** 累積與此 NPC 的互動次數達到此數後觸發 */
  interactionCount: number;
  /**
   * 選填：全局旗標前置條件。
   * 省略 = 無前置條件（純粹依互動次數觸發）。
   */
  condition?: string;
}

export interface NPCNode {
  id: string;
  name: string;
  /** 預設位置 ID；省略 = 預設不在任何地方（須靠 schedule 觸發出現） */
  defaultLocationId?: string;
  factionId?: string;
  /** DM 永遠可見的表面資訊，只寫公開人設，不含任何秘密 */
  publicDescription: string;
  /** 知識層：依旗標條件分層揭露給 DM 的角色深度資訊 */
  secretLayers?: NPCSecretLayer[];
  /** 預設對話樹 ID */
  dialogueId: string;
  /** 條件式對話樹切換；優先序高者勝出，無規則命中則用 dialogueId */
  dialogueRules?: NPCDialogueRule[];
  questIds?: string[];
  /**
   * NPC 可見條件（旗標運算式）。
   * 省略 = 永遠可見（位置由 schedule / defaultLocationId 決定）。
   * 設定後，運算式為 false 時 NPC 完全不出現，無論位置如何。
   */
  visibleWhen?: string;
  /** 整體時段限制；省略 = 任何時段皆可出現 */
  availablePeriods?: TimePeriod[];
  /** 位置排程；依 priority 取第一個成立的條件決定 NPC 當前位置 */
  schedule?: NPCScheduleEntry[];
  /**
   * 認知觸發規則。互動次數達到閾值後自動設置 NPC 本地旗標。
   * 設置的旗標儲存在 npcMemory[id].flags，供 secretLayers.condition 評估。
   */
  knowledgeTriggers?: NPCKnowledgeTrigger[];
}

/**
 * resolveNPC 的回傳型別。
 * 在 NPCNode 的基礎上附加計算後的位置與對話樹。
 */
export interface ResolvedNPC extends NPCNode {
  /** 當前實際所在地點 ID；undefined = 目前不在任何地方 */
  currentLocationId: string | undefined;
  /** 當前生效的對話樹 ID（已套用 dialogueRules） */
  activeDialogueId: string;
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
 * 用於 ConnectionAccess.timeRanges 與 EventCondition.timeRanges，陣列內為 OR 關係（落在其中一個範圍即通過）。
 */
export interface GameTimeRange {
  startHour: number;    // 0–23
  startMinute: number;  // 0–59
  endHour: number;      // 0–23
  endMinute: number;    // 0–59
}

/**
 * 遊戲內曆法的一個時間點（各欄位皆可省略，省略時視為 0）。
 * 用於 GameDateTimeCondition，描述 before / after / between 的基準點。
 */
export interface GameDatePoint {
  year?:   number;  // 省略視為 0
  month?:  number;  // 1–12；省略視為 0
  day?:    number;  // 1–31；省略視為 0
  hour?:   number;  // 0–23；省略視為 0
  minute?: number;  // 0–59；省略視為 0
}

/**
 * 進階日期時間條件，支援 before / after / between 三種關係。
 * 可同時考量日期（年月日）與時刻（時分）。
 * 用於 ConnectionAccess.dateTimeConditions，陣列內為 OR 關係（符合其中一個即通過）。
 *
 * @example
 * // 在 AD 1498-06-15 08:00 之後才開放
 * { relation: 'after', from: { year: 1498, month: 6, day: 15, hour: 8, minute: 0 } }
 *
 * @example
 * // 在 AD 1498-06-10 00:00 到 1498-06-20 23:59 之間
 * { relation: 'between',
 *   from: { year: 1498, month: 6, day: 10, hour: 0, minute: 0 },
 *   to:   { year: 1498, month: 6, day: 20, hour: 23, minute: 59 } }
 */
export interface GameDateTimeCondition {
  /** 'before' = 在 from 之前；'after' = 在 from 之後；'between' = 在 from 到 to 之間（含端點）。 */
  relation: 'before' | 'after' | 'between';
  /** 參考時間點（before/after 的基準；between 的起點）。 */
  from: GameDatePoint;
  /** 僅 relation === 'between' 時必填：終止時間點。 */
  to?: GameDatePoint;
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
  intelIds?: string[];
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
  /**
   * 進階日期時間條件。陣列內為 OR — 符合其中一個即通過。
   * 與 timeRanges / timePeriods 同為 AND 關係的獨立條件。
   * 支援 before / after / between，可同時考量日期（年月日）與時刻（時分）。
   * 省略 = 無日期時間限制。
   */
  dateTimeConditions?: GameDateTimeCondition[];
  /** 玩家需擁有的情報 ID（knownIntelIds）；省略 = 無知識門檻 */
  intelIds?: string[];
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
   * 派系聲望下限（AND 關係）。key = factionId，value = 最低聲望值。
   * 玩家對所有指定派系的聲望均需達標才能通行。
   */
  minReputation?: Record<string, number>;
  /**
   * 派系聲望上限（AND 關係）。key = factionId，value = 最高聲望值。
   */
  maxReputation?: Record<string, number>;
  /**
   * NPC 好感下限（AND 關係）。key = npcId，value = 最低好感值。
   */
  minAffinity?: Record<string, number>;
  /**
   * NPC 好感上限（AND 關係）。key = npcId，value = 最高好感值。
   */
  maxAffinity?: Record<string, number>;
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
  /**
   * 嘗試遭遇 ID。條件不滿足（且 bypass 也不通過）時，若設定此欄位，
   * 通道不顯示為「封鎖」而是「可嘗試」——玩家選擇通行時進入該遭遇事件，
   * 根據遭遇結果決定是否放行。
   * 省略 = 條件不滿足時直接封鎖。
   */
  attemptEncounterId?: string;
  /**
   * 嘗試通道的地圖標籤提示。
   * 例：「門禁中（可嘗試）」、「有守衛把守」
   * 省略 = 使用預設提示「可嘗試通行」
   */
  attemptLabel?: string;
  /**
   * 嘗試遭遇的冷卻時間（遊戲內分鐘）。
   * 遭遇結束後，此通道在冷卻期間內視為完全封鎖（不可再次嘗試）。
   * 省略 = 無冷卻，隨時可再次嘗試。
   */
  attemptCooldownMinutes?: number;
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
  /**
   * 地圖可見條件。若設定，且條件不滿足，且玩家未到訪目標地點，
   * 則此連線的目標節點在小地圖上不顯示（隱藏節點，仍可 hover 顯示 ???）。
   * 省略 = 目標節點永遠在地圖上可見。
   * 注意：此欄位只影響地圖顯示，不影響實際通行能力（由 access 控制）。
   */
  mapVisible?: {
    /** 玩家需已知的情報 ID（AND 關係，全部知道才算通過） */
    intelIds?: string[];
    /** 旗標運算式；由 FlagSystem.evaluate 評估，true = 可見 */
    flags?: string;
  };
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
  /** 場景物件 ID 列表，引用 props/*.json 中的 PropNode */
  propIds?: string[];
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
  addPropIds?: string[];
  removePropIds?: string[];
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
  propIds: string[];
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
  timePeriods?: TimePeriod[];
  /**
   * 精確時間範圍（每日循環，24 小時制）。陣列內為 OR — 當前時刻落在其中任一範圍即通過。
   * 支援跨午夜，例如 { startHour: 0, startMinute: 0, endHour: 4, endMinute: 59 }。
   * 與 timePeriods 為獨立的 AND 條件：兩者都設定時，兩者都必須通過。
   * 省略 = 無時鐘限制。
   */
  timeRanges?: GameTimeRange[];
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
  /**
   * 進階日期時間條件（陣列內 OR）。符合其中一個即通過此欄位。
   * 支援 before / after / between，可同時考量日期（年月日）與時刻（時分）。
   * 省略 = 無日期時間限制。
   */
  dateTimeConditions?: GameDateTimeCondition[];
  /**
   * 觸發機率（0–1）。條件通過後，依此機率決定是否實際觸發。
   * 省略或 1.0 = 必定觸發。
   */
  triggerChance?: number;
  /**
   * 派系聲望下限（AND 關係）。key = factionId，value = 最低聲望值。
   */
  minReputation?: Record<string, number>;
  /**
   * 派系聲望上限（AND 關係）。key = factionId，value = 最高聲望值。
   */
  maxReputation?: Record<string, number>;
  /**
   * NPC 好感下限（AND 關係）。key = npcId，value = 最低好感值。
   */
  minAffinity?: Record<string, number>;
  /**
   * NPC 好感上限（AND 關係）。key = npcId，value = 最高好感值。
   */
  maxAffinity?: Record<string, number>;
  /**
   * 位置排除條件：玩家當前位置（含所有上層父位置）若在此清單內，則不觸發事件。
   * 用於「反向位置」判斷，例如宵禁事件：玩家不在宿舍區時才觸發。
   * 只需填入父位置 ID，系統會自動向上遍歷 parentId 鏈涵蓋所有子位置。
   */
  notLocationIds?: string[];
  /**
   * 僅在特定遊戲動作時觸發，而非正常事件輪詢。
   * 'rest_start' = 玩家開始休息時（時間推進前）觸發。
   * 省略 = 正常觸發（任何動作後輪詢）。
   */
  triggerOn?: 'rest_start';
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
   * 觸發 NPC 對話節點（由 GameController 啟動 DialogueManager 的 scripted node）。
   * 用於事件觸發的 NPC 主動對話場景，endAfterScript 預設為 true。
   */
  startNpcDialogue?: {
    npcId: string;
    dialogueId: string;
    nodeId: string;
  };
  /**
   * 梅分變化（正 = 獲得，負 = 扣除）。
   * 由 StateManager.modifyMelphin 處理，不走 statChanges 的 dot-path。
   */
  melphinChange?: number;
  /**
   * 觸發指定任務的 onFail 效果並推進/失敗該任務（由 GameController 轉交 QuestEngine）。
   */
  failQuestId?: string;
  /**
   * 套用一個狀態條件（buff / debuff / 受傷等）。
   * 填入 ConditionDefinition.id，由引擎查表取得完整定義。
   */
  applyConditionId?: string;
  /** 移除指定狀態條件的 ID 列表。 */
  removeConditionIds?: string[];
  /**
   * 技能經驗獲得，key = primaryStat 名稱，value = 基礎 XP 量。
   * 引擎套用角色經驗加成與傾向加成後發放，來源為 'event'（無每日上限）。
   * 例：{ "strength": 15, "knowledge": 5 }
   */
  skillExpChanges?: Partial<Record<string, number>>;
  /**
   * 角色經驗（全局）獲得量。
   * 累積後提升技能 XP 加成梯度與每日 GRANT 上限。
   */
  characterExpGrant?: number;
  /**
   * 設置 NPC 本地認知旗標。key = npcId，value = 要設置的旗標 ID 陣列。
   * 設置的旗標儲存在 npcMemory[npcId].flags，供 secretLayers.condition 評估。
   * 用於「從事件或另一個 NPC 處得知某人的秘密」等場景。
   */
  npcFlagsSet?: Record<string, string[]>;
}

/**
 * 觸發 Variant — 讓同一個事件可依不同條件走不同的觸發邏輯。
 * 引擎在通過 top-level condition 的 shared gates（timePeriods、flags 等）後，
 * 依序檢查 triggerVariants，第一個符合的 variant 生效：
 *   - 它的 triggerChance / cooldownMinutes 取代 top-level 的對應設定
 *   - 沒有 triggerChance = 必定觸發（無機率篩選）
 *   - 沒有 cooldownMinutes = 不受冷卻限制（即使 isRepeatable）
 *   - notification / notificationVariant 覆蓋整個事件的通知設定
 * 若所有 variant 均不符合 → 事件不觸發。
 * 省略 triggerVariants = 沿用 top-level condition（現有行為）。
 */
export interface EventTriggerVariant {
  condition: {
    flags?: string[];
    anyFlags?: string[];
    notFlags?: string[];
    questActiveId?: string;
    questStageId?: string;
    triggerChance?: number;
    cooldownMinutes?: number;
    minReputation?: Record<string, number>;
    maxReputation?: Record<string, number>;
    minAffinity?: Record<string, number>;
    maxAffinity?: Record<string, number>;
  };
  notification?: boolean;
  notificationVariant?: 'normal' | 'negative' | 'danger' | 'rare';
}

export interface GameEvent {
  id: string;
  name?: string;
  locationId?: string | string[];
  condition: EventCondition;
  /**
   * 觸發 variant 列表（可選）。存在時取代 top-level condition 的 triggerChance / cooldownMinutes。
   * 詳見 EventTriggerVariant。
   */
  triggerVariants?: EventTriggerVariant[];
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
  /**
   * 身份揭露條件（情報 ID）。玩家 knownIntelIds 尚未包含此 ID 時，
   * 派系名稱在聲望圖中以 ??? 顯示。省略 = 接觸即知（如政府等公開勢力）。
   * 範例：unknownUntil: "crambell_treffen_true_name"
   */
  unknownUntil?: string;
  /**
   * 與其他派系的靜態關係（用於派系關係圖的彈簧佈局）。
   * weight > 0 = 友好，0 = 中立，weight < 0 = 敵對。
   * 每條邊只需在其中一方的檔案定義一次；系統會自動去重。
   */
  relations?: Array<{ targetFactionId: string; weight: number }>;
}

/**
 * 兩派系之間的關係邊。
 * weight > 0 = 友好，weight = 0 = 中立，weight < 0 = 敵對。
 */
export interface FactionRelationEdge {
  a: string;   // factionId
  b: string;   // factionId
  weight: number;
}

/**
 * 陣營關係圖定義（lore/world/regions/<region>/faction_graphs/<id>.json）。
 * 只定義派系間的靜態關係邊；節點座標由前端以彈簧佈局演算法動態計算，
 * 玩家投影點依 reputation 加權向量平均計算，均不寫死在 lore。
 */
export interface FactionGraphDefinition {
  id: string;
  /** 此圖包含的派系 ID 列表（可用於顯示未發現派系的提示） */
  factionIds: string[];
  /** 派系間的靜態關係邊（驅動彈簧佈局與關係可視化） */
  edges: FactionRelationEdge[];
  /**
   * 解鎖旗標。旗標成立時才允許玩家開啟此關係圖。
   * 省略 = 預設解鎖。
   * @future 目前未被 runtime 讀取，保留供後續 UI 入口控制使用。
   */
  unlockFlag?: string;
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
  timePeriods?: TimePeriod[];
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
  /** 區域特殊數值（如三區的管制程度、警戒等） */
  regionCustom?: Record<string, number>;
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
