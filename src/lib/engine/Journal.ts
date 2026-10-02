// Journal — 玩家日誌記錄器。
//
// 由 StateManager 持有（日誌本身存在 GameState.journal，讀檔重建 StateManager 時自然跟著換）。
// 來源與合併以「frame」堆疊處理：
//   - begin(source) 開一個批次；批次內的數值變化（體力、壓力、梅分、經驗…）累加，
//     end() 時彙總成一筆「數值」條目。其他類別（聲望、任務、物品…）立即寫入，來源取當前 frame。
//   - 與目前最上層 frame 來源相同的 begin 不開新批次（回傳 null），讓巢狀呼叫合併到同一筆。
//   - source 省略時繼承外層來源。
//   - end(token) 依 token 移除（不假設是堆疊頂端），避免非同步流程交錯時錯位。
// 名稱解析由 GameController 注入（StateManager 不持有 LoreVault）；未注入時退回 id。

import type { GameState } from '../types';
import type { JournalCategory, JournalEntry } from '../types/journal';
import { JOURNAL_MAX_ENTRIES } from '../types/journal';

/** 數值顯示名稱（日誌、獲取通知共用） */
export const STAT_LABELS: Record<string, Record<string, string>> = {
  statusStats:   { stamina: '體力', staminaMax: '體力上限', stress: '壓力', stressMax: '壓力上限', endo: 'Endo', endoMax: 'Endo 上限', experience: '經驗', fatigue: '疲勞' },
  primaryStats:  { strength: '力量', knowledge: '知識', talent: '才能', spirit: '靈性', luck: '運氣' },
  secondaryStats: { consciousness: '意識', mysticism: '神秘', technology: '技術' },
};

/** dot-path（如 statusStats.stamina）→ 顯示名稱 */
export function statLabel(key: string): string {
  const [group, stat] = key.split('.');
  return STAT_LABELS[group]?.[stat] ?? stat ?? key;
}

export function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** 名稱解析器：回傳 undefined 時退回 id。 */
export interface JournalNameResolver {
  faction?(id: string): string | undefined;
  npc?(id: string): string | undefined;
  item?(itemId: string, variantId?: string): string | undefined;
  quest?(id: string): string | undefined;
  questStage?(questId: string, stageId: string): string | undefined;
  questObjective?(questId: string, objectiveId: string): string | undefined;
  intel?(id: string): string | undefined;
  /** 狀態效果顯示名稱；hidden = true 時不記錄 */
  condition?(id: string): { label: string; hidden: boolean } | undefined;
  location?(id: string): string | undefined;
}

export interface JournalFrame {
  source?: string;
  /** key → { label, delta }；Map 保留插入順序 */
  stats: Map<string, { label: string; delta: number }>;
}

export class JournalRecorder {
  private frames: JournalFrame[] = [];
  names: JournalNameResolver = {};
  /** 新條目寫入後的回呼（UI 同步用） */
  onAppend?: (entry: JournalEntry) => void;

  constructor(private getState: () => GameState) {}

  // ── 名稱 ──────────────────────────────────────────────────────

  factionName(id: string): string { return this.names.faction?.(id) ?? id; }
  npcName(id: string): string { return this.names.npc?.(id) ?? id; }
  itemName(itemId: string, variantId?: string): string { return this.names.item?.(itemId, variantId) ?? itemId; }
  questName(id: string): string { return this.names.quest?.(id) ?? id; }
  intelName(id: string): string { return this.names.intel?.(id) ?? id; }
  locationName(id: string): string { return this.names.location?.(id) ?? id; }
  condition(id: string): { label: string; hidden: boolean } {
    return this.names.condition?.(id) ?? { label: id, hidden: false };
  }
  questStage(questId: string, stageId: string): string | undefined { return this.names.questStage?.(questId, stageId); }
  questObjective(questId: string, objectiveId: string): string | undefined { return this.names.questObjective?.(questId, objectiveId); }

  // ── 批次 ──────────────────────────────────────────────────────

  /** 目前生效的來源（最上層 frame）。 */
  currentSource(): string | undefined {
    return this.frames[this.frames.length - 1]?.source;
  }

  /**
   * 開始一個批次。回傳 token 供 end() 使用；
   * 與最上層 frame 來源相同時回傳 null（合併進外層批次）。
   */
  begin(source?: string): JournalFrame | null {
    const top = this.frames[this.frames.length - 1];
    const effective = source ?? top?.source;
    if (top && top.source === effective) return null;
    const frame: JournalFrame = { source: effective, stats: new Map() };
    this.frames.push(frame);
    return frame;
  }

  /** 結束批次：把累積的數值變化彙總成一筆。 */
  end(token: JournalFrame | null): void {
    if (!token) return;
    const idx = this.frames.indexOf(token);
    if (idx === -1) return;
    this.frames.splice(idx, 1);
    this.flushStats(token);
  }

  with<T>(source: string | undefined, fn: () => T): T {
    const token = this.begin(source);
    try {
      return fn();
    } finally {
      this.end(token);
    }
  }

  async withAsync<T>(source: string | undefined, fn: () => Promise<T>): Promise<T> {
    const token = this.begin(source);
    try {
      return await fn();
    } finally {
      this.end(token);
    }
  }

  // ── 記錄 ──────────────────────────────────────────────────────

  /** 數值變化：有批次時累加，無批次時直接寫一筆。delta 應為實際套用量。 */
  stat(key: string, label: string, delta: number): void {
    if (!delta) return;
    const top = this.frames[this.frames.length - 1];
    if (!top) {
      this.log('stats', `${label} ${formatDelta(delta)}`);
      return;
    }
    const cur = top.stats.get(key);
    if (cur) cur.delta += delta;
    else top.stats.set(key, { label, delta });
  }

  /** 立即寫入一筆；source 省略時使用當前批次來源。 */
  log(category: JournalCategory, text: string, source?: string): JournalEntry {
    const gs = this.getState();
    if (!gs.journal) gs.journal = [];
    const journal = gs.journal;
    const last = journal[journal.length - 1];
    const { year, month, day, hour, minute } = gs.time;
    const src = source ?? this.currentSource();
    const entry: JournalEntry = {
      id: (last?.id ?? 0) + 1,
      time: { year, month, day, hour, minute },
      category,
      text,
      ...(src ? { source: src } : {}),
    };
    journal.push(entry);
    if (journal.length > JOURNAL_MAX_ENTRIES) {
      journal.splice(0, journal.length - JOURNAL_MAX_ENTRIES);
    }
    this.onAppend?.(entry);
    return entry;
  }

  /** 關鍵選擇：只記選項文字，不揭露旗標或隱藏後果。 */
  logKeyChoice(choiceText: string): void {
    this.log('choice', `你選擇了：〈${choiceText}〉（這個選擇可能影響後續發展）`);
  }

  private flushStats(frame: JournalFrame): void {
    const parts: string[] = [];
    for (const { label, delta } of frame.stats.values()) {
      if (delta !== 0) parts.push(`${label} ${formatDelta(delta)}`);
    }
    if (parts.length > 0) this.log('stats', parts.join('、'), frame.source);
  }
}
