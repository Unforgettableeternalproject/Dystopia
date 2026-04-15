// ── World / Lore Types ────────────────────────────────────────

/** NPC 類型 */
export type NPCType = 'stationed' | 'quest' | 'wandering';
// stationed = 據點式，quest = 任務式，wandering = 遊歷式

/** NPC 節點 */
export interface NPCNode {
  id: string;
  name: string;
  type: NPCType;
  locationId: string;        // 主要所在地點（wandering 型可為空）
  factionId?: string;        // 所屬派系
  description: string;       // 給 DM 的角色描述（不給玩家直接看）
  dialogue: DialogueLine[];  // 預設對話線
  questIds?: string[];       // 可觸發的任務 ID
  isVisible: boolean;        // 當前是否可互動
}

/** 對話行 */
export interface DialogueLine {
  id: string;
  condition?: string;        // 旗標條件表達式，空白表示無條件
  text: string;              // NPC 說的話
  triggers?: string[];       // 觸發的旗標或事件 ID
  nextDialogueId?: string;   // 連結下一句
}

/** 地點連接 */
export interface LocationConnection {
  targetLocationId: string;
  condition?: string;        // 旗標條件，空白表示無條件
  description: string;       // 簡述這個出口（給玩家看）
}

/** 地點節點 */
export interface LocationNode {
  id: string;
  name: string;
  regionId: string;
  description: string;       // 給 DM 的場景描述
  ambience: string;          // 氛圍關鍵字，用於 DM 敘述調性
  connections: LocationConnection[];
  npcIds: string[];          // 本地點可能出現的 NPC ID 列表
  eventIds: string[];        // 可觸發事件 ID 列表
  isDiscovered: boolean;     // 玩家是否已探索過
}

/** 事件觸發條件 */
export interface EventCondition {
  flags?: string[];          // 需要全部達成的旗標
  anyFlags?: string[];       // 需要至少一個的旗標
  minStats?: Partial<Record<string, number>>; // 最低數值要求
}

/** 遊戲事件節點 */
export interface GameEvent {
  id: string;
  locationId?: string;       // 限定地點觸發（空白表示全域）
  condition: EventCondition;
  description: string;       // 給 DM 的事件描述
  outcomes: EventOutcome[];  // 可能的結果（依玩家選擇分支）
  isRepeatable: boolean;
}

/** 事件結果 */
export interface EventOutcome {
  id: string;
  condition?: string;        // 需要的玩家選擇或旗標
  description: string;       // 給 DM 的結果描述
  flagsSet?: string[];       // 設定的旗標
  flagsUnset?: string[];     // 清除的旗標
  statChanges?: Partial<Record<string, number>>; // 數值變化
}

/** 派系 */
export interface Faction {
  id: string;
  name: string;
  regionId: string;
  description: string;
  defaultReputation: number; // 玩家初始聲望值
}
