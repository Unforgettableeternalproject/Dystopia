// FlagSystem — manages game flags (achieved conditions, event triggers, etc.)
// Flags are string IDs; semantics are owned by the lore/engine layers.

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

  hasAll(flagIds: string[]): boolean {
    return flagIds.every((id) => this.flags.has(id));
  }

  hasAny(flagIds: string[]): boolean {
    return flagIds.some((id) => this.flags.has(id));
  }

  /**
   * Evaluate a condition string.
   * Supports both symbol form ('flag1 & flag2 | !flag3') and word form ('flag1 AND flag2 OR NOT flag3').
   * - '|' / 'OR'  = OR (lowest precedence)
   * - '&' / 'AND' = AND
   * - '!' / 'NOT' prefix = NOT (true when flag is absent)
   */
  evaluate(condition: string): boolean {
    if (!condition.trim()) return true;
    // Normalise word-form operators to symbol form so lore files can use either style.
    const normalised = condition
      .replace(/\bOR\b/g, '|')
      .replace(/\bAND\b/g, '&')
      .replace(/\bNOT\s+/g, '!');
    return normalised
      .split('|')
      .some((orPart) =>
        orPart
          .trim()
          .split('&')
          .every((token) => {
            const t = token.trim();
            if (t.startsWith('!')) return !this.flags.has(t.slice(1).trim());
            return this.flags.has(t);
          })
      );
  }

  toArray(): string[] {
    return Array.from(this.flags);
  }
}
