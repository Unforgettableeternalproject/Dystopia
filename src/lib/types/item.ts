// ── Item Types ──────────────────────────────────────────────────────

export type ItemType = 'equipment' | 'consumable' | 'key' | 'info';

/**
 * 物品的獲得來源類型。
 * - 'event'  : 透過事件觸發取得（EventOutcome / DM signal）
 * - 'npc'    : 向 NPC 購買、交換或接受贈予
 * - 'prop'   : 從場景中的道具/容器取得（尚未實作）
 * - 'shop'   : 在商店購買
 * - 'story'  : 劇情或初始物品（starter.json / 過場給予）
 */
export type ItemSource = 'event' | 'npc' | 'prop' | 'shop' | 'story';

/** 物品對主要數值的加成（可為負值） */
export interface ItemStatBonus {
  strength?: number;
  knowledge?: number;
  talent?: number;
  spirit?: number;
  luck?: number;
}

/** 物品變體，例如「移動許可」有前往不同象限的版本 */
export interface ItemVariant {
  id: string;
  label: string;
  description?: string;
}

// ── Consumable Effect ────────────────────────────────────────────────

/**
 * 消耗品使用後的立即狀態數值變化（delta）。
 * 正值 = 恢復/提升，負值 = 損傷/增壓。
 * 數值由引擎 clamp 到對應的 max（不超過 staminaMax 等）。
 */
export interface ConsumableStatusChanges {
  /** 體力變化（正 = 恢復，負 = 傷害） */
  stamina?: number;
  /** 魔素變化（正 = 恢復，負 = 消耗） */
  endo?: number;
  /** 壓力變化（正 = 增壓，負 = 舒緩） */
  stress?: number;
}

/**
 * 消耗品的使用效果定義。
 * ItemNode.type = 'consumable' 時填寫，其他類型省略此欄位。
 */
export interface ConsumableEffect {
  /** 立即套用的狀態數值變化 */
  statusChanges?: ConsumableStatusChanges;
  /**
   * 套用一個狀態條件（buff / debuff / 受傷等）。
   * 填入 ConditionDefinition.id，由引擎查表取得完整定義。
   * 若玩家已有相同 id 的條件，會覆蓋（重置 runtime 狀態）。
   */
  applyConditionId?: string;
  /**
   * 套用條件時的持續回合數覆蓋。
   * 省略 = 依 ConditionDefinition 決定（無限期或由 tickEffect.maxTicks 控制）。
   * 引擎計算：expiresOnTurn = currentTurn + durationTurns
   */
  applyConditionDurationTurns?: number;
  /**
   * 清除的條件 ID 列表（解除中毒、治療等）。
   * 陣列內所有條件同時移除。
   */
  removeConditionIds?: string[];
  /** 使用後設置的旗標 */
  flagsSet?: string[];
  /** 使用後清除的旗標 */
  flagsUnset?: string[];
}

/**
 * 物品定義節點（lore/items/ 中的靜態資料）。
 * 玩家實際持有的物品以 InventoryItem 記錄，並指向此定義。
 */
export interface ItemNode {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  /**
   * 繼承的基礎物品 ID。設定後，此物品從 base 繼承所有未覆蓋的欄位。
   * 用於預先定義的模板實例——有自己的 ID，可放進任何字串陣列 grant。
   * 載入時由 LoreVault 自動解析合併。
   */
  baseId?: string;
  /**
   * 訊息物品的內文。type='info' 時填寫。
   * 玩家使用時不消耗，而是開啟閱讀模態窗顯示此內容。
   * isTemplate 物品可透過 InventoryItem.itemOverrides.content 覆蓋此欄位。
   */
  content?: string;
  /**
   * 標記此物品為模板。模板物品本身只是一個「空殼」，
   * 發放時可透過 itemOverrides 指定不同的 name / description / content，
   * 產生多種臨時變種。每個實例在 InventoryItem 中都是獨立的。
   * DM 也可在給予物品時使用此機制產生未預先定義的物品。
   */
  isTemplate?: boolean;
  /** 裝備時提供的數值加成；消耗品/關鍵道具通常不適用 */
  statBonus?: ItemStatBonus;
  /** 變體列表；有變體的物品在 InventoryItem 中需同時指定 variantId */
  variants?: ItemVariant[];
  /**
   * 物品的獲得來源類型列表。
   * 一個物品可有多種取得方式，初始物品填 ['story']。
   * 供引擎過濾、DM 提示，以及未來商店/事件系統參考。
   */
  obtainedFrom?: ItemSource[];
  /**
   * 使用後的敘述提示（給 DM 參考，不直接顯示給玩家）。
   * 描述物品使用後會發生什麼事、有什麼感受或場景變化。
   * 僅 consumable 有意義；equipment/key 省略。
   */
  useNarrative?: string;
  /**
   * 持有後幾分鐘失效（遊戲內分鐘）。
   * 到達時限後由引擎標記 isExpired，失效物品仍保留在 inventory 中作為紀錄。
   * 省略 = 永久有效。
   */
  expiresAfterMinutes?: number;
  /** 是否可堆疊（quantity > 1），預設 false */
  stackable?: boolean;
  /**
   * 可堆疊物品的最大持有數量上限。
   * 省略 = 無上限。僅 stackable:true 時有意義。
   */
  maxStack?: number;
  /**
   * 每個物品實例的最大使用次數（消耗品用）。
   * 省略 = 單次使用即消耗。
   * 使用後 InventoryItem.usesRemaining -= 1，歸零時移除實例。
   */
  maxUsesPerInstance?: number;
  /**
   * 消耗品使用效果；type='consumable' 時填寫，其他類型省略。
   * 包含狀態數值變化、條件套用/移除、旗標操作。
   */
  effect?: ConsumableEffect;
}

/**
 * 玩家物品欄中的實際物品實例。
 * 指向 ItemNode 作為定義，並記錄個別實例的狀態。
 */
export interface InventoryItem {
  /** 唯一識別此實例（格式：itemId_totalMinutes） */
  instanceId: string;
  itemId: string;
  /** 物品變體 ID，對應 ItemNode.variants[].id */
  variantId?: string;
  /** 獲得時的遊戲總分鐘數（用於計算是否到期） */
  obtainedAtMinute: number;
  /** 數量（可堆疊物品使用） */
  quantity: number;
  /** 是否已失效（時限到達後由引擎標記） */
  isExpired: boolean;
  /**
   * 剩餘使用次數（對應 ItemNode.maxUsesPerInstance）。
   * 僅當 ItemNode.maxUsesPerInstance 有設定時才存在。
   * 由 addItem 初始化，每次使用後 -1，歸零時由引擎移除。
   */
  usesRemaining?: number;
  /**
   * 實例覆蓋欄位。從 isTemplate 物品產生實例時填入，
   * 優先於 ItemNode 的同名欄位。UI / LoreItemModal 讀取此值。
   * 也可由 DM signal 在發放時動態指定。
   */
  itemOverrides?: { name?: string; description?: string; content?: string };
}

/**
 * 通道/地點進入時對物品的需求（用於 ConnectionAccess.itemRequirements）。
 * 玩家需持有匹配的未失效物品才能通行。
 */
export interface ItemRequirement {
  itemId: string;
  /** 若指定，玩家持有的物品需同時匹配此變體 ID */
  variantId?: string;
}
