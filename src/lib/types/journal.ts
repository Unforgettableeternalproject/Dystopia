// -- Journal (玩家日誌) Types ---
//
// 玩家用的「最近發生了什麼、為什麼發生」紀錄。與除錯用的 trace / Logger 無關，
// 文字在寫入當下就以玩家可見的名稱組好，存檔後不需再查 lore。

/** 日誌類別（對應面板頂部的篩選） */
export type JournalCategory =
  | 'stats'      // 數值：狀態數值、梅分、技能經驗、角色經驗
  | 'social'     // 聲望（陣營）與好感（NPC）
  | 'quest'      // 任務：接取、推進、目標、完成、失敗、背棄／放棄、陣營信用
  | 'event'      // 事件／遭遇、擲骰判定
  | 'item'       // 物品：獲得、失去、使用、丟棄、過期
  | 'intel'      // 情報
  | 'condition'  // 狀態效果
  | 'rest'       // 休息
  | 'choice'     // 關鍵選擇
  | 'location';  // 地點：首次到訪、門禁調整

/** 日誌條目的遊戲時間戳（不含 totalMinutes 以外的冗餘資料） */
export interface JournalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface JournalEntry {
  /** 遞增序號（同一局內唯一），供 UI 判斷未讀 */
  id: number;
  time: JournalTime;
  category: JournalCategory;
  /** 玩家可見的文字，不含旗標名稱或隱藏後果 */
  text: string;
  /** 造成此變化的來源（行動、事件、遭遇、對話…）；未知時省略 */
  source?: string;
}

/** 日誌保留筆數上限（存檔與記憶體共用） */
export const JOURNAL_MAX_ENTRIES = 200;
