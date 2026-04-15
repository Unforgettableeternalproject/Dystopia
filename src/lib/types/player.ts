// ── Player Types ──────────────────────────────────────────────

/** 主要技能數值 */
export interface PrimaryStats {
  strength: number;     // 力量 — 體能、戰鬥判定
  knowledge: number;    // 知識 — 資訊、學習判定
  talent: number;       // 才能 — 技藝、手巧判定
  spirit: number;       // 精神 — 意志、感知判定
  luck: number;         // 運氣 — 機率、奇遇判定
}

/** 次要內部（設定）數值 */
export interface SecondaryStats {
  consciousness: number; // 意識 — 與精神學領域相關
  arcane: number;        // 奧秘 — 與魔法領域相關
  technology: number;    // 科技 — 與科學領域相關
}

/** 狀態數值 */
export interface StatusStats {
  stamina: number;       // 體力 — 當前/最大
  staminaMax: number;
  stress: number;        // 壓力 — 越高越不穩定
  stressMax: number;
  mana: number;          // 魔力 — 魔法使用量
  manaMax: number;
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

/** 玩家完整狀態 */
export interface PlayerState {
  id: string;
  name: string;
  origin: string;           // 出身背景 ID，影響初始數值與劇情
  currentLocationId: string;
  primaryStats: PrimaryStats;
  secondaryStats: SecondaryStats;
  statusStats: StatusStats;
  externalStats: ExternalStats;
  inventory: string[];      // item ID 列表
  activeFlags: Set<string>; // 已達成的旗標
  titles: string[];         // 已獲得的稱號
}
