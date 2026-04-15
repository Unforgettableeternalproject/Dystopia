// ── FlagSystem ────────────────────────────────────────────────
// 管理遊戲旗標（已達成的條件、事件觸發紀錄等）。
// 旗標是字串 ID，系統只負責 set/unset/check，不持有語義。

import { EventBus, GameEvents } from './EventBus';

export class FlagSystem {
  private flags: Set<string>;
  private bus: EventBus;

  constructor(bus: EventBus, initialFlags: string[] = []) {
    this.flags = new Set(initialFlags);
    this.bus = bus;
  }

  set(flagId: string): void {
    if (!this.flags.has(flagId)) {
      this.flags.add(flagId);
      this.bus.emit(GameEvents.FLAG_SET, { flagId });
    }
  }

  unset(flagId: string): void {
    if (this.flags.has(flagId)) {
      this.flags.delete(flagId);
      this.bus.emit(GameEvents.FLAG_UNSET, { flagId });
    }
  }

  has(flagId: string): boolean {
    return this.flags.has(flagId);
  }

  /** 所有旗標都滿足 */
  hasAll(flagIds: string[]): boolean {
    return flagIds.every((id) => this.flags.has(id));
  }

  /** 至少一個旗標滿足 */
  hasAny(flagIds: string[]): boolean {
    return flagIds.some((id) => this.flags.has(id));
  }

  /** 評估條件字串，格式：'flag1 & flag2 | flag3' */
  evaluate(condition: string): boolean {
    if (!condition.trim()) return true;
    // 簡單解析：先處理 | 再處理 &
    return condition
      .split('|')
      .some((orPart) =>
        orPart
          .trim()
          .split('&')
          .every((flag) => this.flags.has(flag.trim()))
      );
  }

  toArray(): string[] {
    return Array.from(this.flags);
  }
}
