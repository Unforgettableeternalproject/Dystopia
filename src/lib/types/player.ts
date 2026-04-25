// ── Player Types ──────────────────────────────────────────────
import type { InventoryItem } from './item';
import type { PlayerCondition } from './condition';
export type { PlayerCondition } from './condition';

/** 主要技能數值 */
export interface PrimaryStats {
  strength: number;     // 力量 — 體能、戰鬥判定
  knowledge: number;    // 知識 — 資訊、學習判定
  talent: number;       // 才能 — 技藝、手巧判定
  spirit: number;       // 精神 — 意志、感知判定
  luck: number;         // 運氣 — 機率、奇遇判定
}

/** 主要技能的 key 名稱（用於型別安全的 XP / 傾向操作） */
export type PrimaryStatKey = keyof PrimaryStats;

/**
 * 各主要技能的當前累積 XP。
 * XP 滿後自動升級，升級後 XP 繼承（carry over）。
 */
export type PrimaryStatsExp = Record<PrimaryStatKey, number>;

/**
 * 各主要技能獲得 XP 的次數累積，用於計算傾向。
 * 次數越多的技能，其傾向強度越高。
 */
export type InclinationTracker = Record<PrimaryStatKey, number>;

/**
 * 每日 GRANT XP 上限的追蹤記錄，依遊戲內日期重置。
 * GRANT 來源（DM 直接發放）受每日上限限制；事件/遭遇來源不受此限。
 */
export interface DailyGrantTracker {
  /** 當前日期 key，格式：`${year}-${month}-${day}` */
  dateKey: string;
  /** 今日已透過 GRANT 發放的技能 XP 量 */
  grantedExp: Partial<Record<PrimaryStatKey, number>>;
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
  fatigue: number;       // 疲勞 — 0–5，隱藏數值，需≥3才能進行休息
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

/** 玩家完整狀態 */
export interface PlayerState {
  id: string;
  name: string;
  origin: string;              // 出身背景 ID，影響初始數值與劇情
  currentLocationId: string;
  primaryStats: PrimaryStats;
  primaryStatsExp: PrimaryStatsExp;      // 各主要技能當前累積 XP
  inclinationTracker: InclinationTracker; // 各技能獲得 XP 次數（傾向計算用）
  dailyGrantTracker: DailyGrantTracker;   // 每日 GRANT 上限追蹤
  secondaryStats: SecondaryStats;
  statusStats: StatusStats;
  externalStats: ExternalStats;
  inventory: InventoryItem[];  // 物品欄
  activeFlags: Set<string>;    // 已達成的旗標
  titles: string[];            // 已獲得的稱號
  conditions: PlayerCondition[]; // 當前生效的暫時性狀態
  knownIntelIds: string[];      // 已發現的情報 ID（對應 lore/intel/ 資料）
  /**
   * 已接觸派系的 ID 列表。
   * 有聲望變動時自動加入；也可由事件明確觸發（contactFaction effect）。
   * 接觸 ≠ 識別：識別名稱需再確認 Faction.revealFlag。
   */
  contactedFactions?: string[];
  melphin: number;              // 梅分 (Melphin) — 持有貨幣
}
