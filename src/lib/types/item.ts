// ── Item Types ──────────────────────────────────────────────────────

export type ItemType = 'equipment' | 'consumable' | 'key';

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

/**
 * 物品定義節點（lore/items/ 中的靜態資料）。
 * 玩家實際持有的物品以 InventoryItem 記錄，並指向此定義。
 */
export interface ItemNode {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  /** 裝備時提供的數值加成；消耗品/關鍵道具通常不適用 */
  statBonus?: ItemStatBonus;
  /** 變體列表；有變體的物品在 InventoryItem 中需同時指定 variantId */
  variants?: ItemVariant[];
  /** 獲得來源說明（給 DM/玩家閱讀） */
  obtainedFrom?: string;
  /**
   * 持有後幾分鐘失效（遊戲內分鐘）。
   * 到達時限後由引擎標記 isExpired，失效物品仍保留在 inventory 中作為紀錄。
   * 省略 = 永久有效。
   */
  expiresAfterMinutes?: number;
  /** 是否可堆疊（quantity > 1），預設 false */
  stackable?: boolean;
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
