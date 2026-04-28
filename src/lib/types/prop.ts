// ── Prop (Scene Object) Types ────────────────────────────────────

import type { ConnectionAccess } from './world';
import type { EncounterNode } from './encounter';

/**
 * Prop 嵌入式互動遭遇定義。
 * 結構同 EncounterDefinition 的 nodes DAG，不建立獨立 encounter 檔案。
 * 引擎會為其生成合成 ID（prop_interact_{propId}）並暫時注入 LoreVault。
 */
export interface PropInteraction {
  /** 遭遇型別。'transit' 為轉移門專用型別，MVP 使用標準選項面板渲染。 */
  type?: 'event' | 'story' | 'transit';
  entryNodeId: string;
  nodes: Record<string, EncounterNode>;
}

/**
 * 場景物件節點（lore/world/regions/<region>/props/ 中的靜態資料）。
 * Prop 是存在於地點中的可互動物件，可作為休息點、承載物品、觸發事件或遭遇。
 * 地點透過 LocationBase.propIds 引用；LocalVariant 可用 addPropIds/removePropIds 增減。
 */
export interface PropNode {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  /** 靜態預設可見性。false = 始終隱藏（除非被 LocalVariant 加入）。省略或 true = 可見。 */
  isVisible?: boolean;
  /**
   * 動態可見條件。使用 ConnectionAccess 結構，支援所有現有條件類型
   * （flag、timePeriods、timeRanges、intelIds、questStages、itemRequirements、minMelphin）。
   * 省略 = 無額外條件限制。bypass 與 lockedMessage 欄位不適用，會被忽略。
   */
  visibleWhen?: ConnectionAccess;
  /** 是否為休息點。場景中存在任一 visible restPoint 即允許 full rest。 */
  restPoint?: boolean;
  /** DM 提示：玩家檢查此物件時 DM 額外獲得的 context（不直接顯示給玩家）。 */
  checkPrompt?: string;
  // ── 互動系統 ──
  /** 是否允許玩家主動 interact（省略或 false = 只能 examine）。 */
  interactable?: boolean;
  /** 互動按鈕顯示文字（省略 = '互動'）。 */
  interactLabel?: string;
  /** 嵌入式互動遭遇定義（不建立獨立 encounter 檔案）。 */
  interaction?: PropInteraction;
  /**
   * 每個遊戲日（午夜）自動重置的旗標 ID 列表。
   * 用於每日補充資源（如餐桌麵包）：interaction 用 flagsSet 標記已取，
   * 引擎在日期切換時清除這些旗標，使資源重新可取。
   */
  dailyResetFlags?: string[];
  // ── Legacy（向下相容，優先使用 interaction） ──
  /** 可從此物件取得的物品（舊機制） */
  itemGrants?: PropItemGrant[];
  /** 互動觸發的事件 ID（舊機制） */
  eventIds?: string[];
  /** 互動觸發的遭遇 ID（舊機制，interaction 優先） */
  encounterId?: string;
}

/**
 * Prop 物品發放項目。
 * 定義 Prop 中可取得的物品、數量與條件。
 * isTemplate 物品可附帶 itemOverrides 產生帶自訂內容的實例。
 */
export interface PropItemGrant {
  itemId: string;
  variantId?: string;
  count?: number;
  /** isTemplate 物品的實例覆蓋欄位（name / description / content） */
  itemOverrides?: { name?: string; description?: string; content?: string };
  /** 取得後設置的旗標（防止重複取得） */
  onceFlag?: string;
  /** 鎖定條件（旗標表達式），evaluate 為 true 時鎖住此物品 */
  lockedWhen?: string;
  lockedMessage?: string;
}

// ── Observe Types ────────────────────────────────────────────────

export interface ObserveExit {
  targetLocationId: string;
  description: string;
  /** true = 不可通行（access 與 bypass 皆不通過，且無嘗試遭遇） */
  isLocked: boolean;
  /** 鎖住時的說明文字 */
  lockedMessage?: string;
  /** true = 封鎖但可嘗試通行（會觸發嘗試遭遇） */
  hasAttempt?: boolean;
  /** 嘗試遭遇 ID */
  attemptEncounterId?: string;
  /** 嘗試通道的標籤提示 */
  attemptLabel?: string;
}

export interface ObserveNPC {
  id: string;
  name: string;
}

export interface ObserveProp {
  id: string;
  name: string;
  description: string;
  isRestPoint: boolean;
  /** 是否可與玩家互動（顯示 interact 按鈕） */
  isInteractable: boolean;
  /** 互動按鈕顯示文字（預設 '互動'） */
  interactLabel: string;
}

/**
 * 觀察系統快照。由 GameController.getObserveSnapshot() 產生，
 * 純確定性邏輯，不經 LLM。
 */
export interface ObserveSnapshot {
  location: { id: string; name: string };
  exits: ObserveExit[];
  npcs: ObserveNPC[];
  props: ObserveProp[];
  canFullRest: boolean;
}

// ── Rest Context ─────────────────────────────────────────────────

/**
 * 休息情境分類。由 GameController 在 rest action 時計算，
 * 用於 DM context 注入與 Judge resolution clamp。
 */
export interface RestContext {
  mode: 'full_available' | 'scuffed';
  restPointIds: string[];
  /** scuffed 模式的最大休息時間（分鐘），Judge resolution 會被 clamp */
  maxTimeMinutes: number;
  /** 休息效果倍率（scuffed = 0.3，full = 1.0） */
  statusEffectScale: number;
}

