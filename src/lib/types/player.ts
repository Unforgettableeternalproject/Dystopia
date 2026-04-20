// ── Player Types ──────────────────────────────────────────────
import type { InventoryItem } from './item';

/** 主要技能數值 */
export interface PrimaryStats {
  strength: number;     // 力量 — 體能、戰鬥判定
  knowledge: number;    // 知識 — 資訊、學習判定
  talent: number;       // 才能 — 技藝、手巧判定
  spirit: number;       // 精神 — 意志、感知判定
  luck: number;         // 運氣 — 機率、奇遇判定
}

/** 內部數值 — 玩家對世界三大領域的理解程度 */
export interface SecondaryStats {
  consciousness: number; // 意識 — 與精神學領域相關
  mysticism: number;     // 奧秘 — 與魔法領域相關
  technology: number;    // 科技 — 與科學領域相關
}

/** 狀態數值 */
export interface StatusStats {
  stamina: number;       // 體力 — 當前/最大
  staminaMax: number;
  stress: number;        // 壓力 — 越高越不穩定
  stressMax: number;
  endo: number;          // Endo (Endovis) — 體內魔素，魔法使用量
  endoMax: number;
  experience: number;    // 經驗 — 影響技能成長方向
}

/** 外部數值 — 玩家對外部世界的關係紀錄 */
export interface ExternalStats {
  /** 對各派系的聲望值 Record<factionId, value> */
  reputation: Record<string, number>;
  /** 對特定 NPC 的好感值 Record<npcId, value> */
  affinity: Record<string, number>;
  /** 對地點的熟悉度 Record<locationId, value> */
  familiarity: Record<string, number>;
}

/**
 * 暫時性狀態條件 — 附加在玩家身上的短期或持續效果。
 * 例如：受傷、虛空污染、心靈控制、精神崩潰等。
 * expiresOnTurn 為 undefined 表示持續到主動清除。
 */
export interface PlayerCondition {
  id: string;                               // 唯一識別碼，例如 'injured_arm'
  label: string;                            // 玩家可見的簡短標籤
  description: string;                      // DM 面向的效果說明
  expiresOnTurn?: number;                   // undefined = 永久，直到旗標或事件清除
  statModifiers?: Partial<PrimaryStats>;    // 選填：對主要數值的加減效果
  isHidden?: boolean;                       // true = 玩家不知道自己有這個條件（如被操控）
}

/** 玩家完整狀態 */
export interface PlayerState {
  id: string;
  name: string;
  origin: string;              // 出身背景 ID，影響初始數值與劇情
  currentLocationId: string;
  primaryStats: PrimaryStats;
  secondaryStats: SecondaryStats;
  statusStats: StatusStats;
  externalStats: ExternalStats;
  inventory: InventoryItem[];  // 物品欄
  activeFlags: Set<string>;    // 已達成的旗標
  titles: string[];            // 已獲得的稱號
  conditions: PlayerCondition[]; // 當前生效的暫時性狀態
  knownIntelIds: string[];     // 已發現的情報 ID（對應 lore/intel/ 資料）
}
