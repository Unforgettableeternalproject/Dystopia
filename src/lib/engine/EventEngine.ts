// EventEngine — checks and applies GameEvent triggers at the current location.
// Called by GameController after each player action.

import type { GameEvent, EventOutcome } from '../types';
import type { LoreVault } from '../lore/LoreVault';
import type { StateManager } from './StateManager';
import { GameEvents } from './EventBus';

export interface TriggeredEvent {
  event: GameEvent;
  outcome: EventOutcome;
}

export class EventEngine {
  constructor(
    private lore: LoreVault,
    private state: StateManager,
  ) {}

  /**
   * Check all events available at the current location.
   * Returns triggered events with their selected outcomes.
   * Applies flag and stat changes immediately.
   * Non-repeatable events are skipped if already fired (flag already set).
   */
  checkAndApply(locationId: string): TriggeredEvent[] {
    const resolved = this.lore.resolveLocation(locationId, this.state.flags);
    if (!resolved) return [];

    const events = this.lore.getEventsByIds(resolved.eventIds);
    const triggered: TriggeredEvent[] = [];

    for (const ev of events) {
      if (!this.canTrigger(ev)) continue;

      const outcome = this.selectOutcome(ev);
      if (!outcome) continue;

      this.applyOutcome(outcome);
      triggered.push({ event: ev, outcome });

      this.state.flags.set(ev.id + ':fired');
      this.state.emit(GameEvents.GAME_EVENT_TRIGGERED, { eventId: ev.id, outcomeId: outcome.id });
    }

    return triggered;
  }

  private canTrigger(event: GameEvent): boolean {
    // Skip non-repeatable events that have already fired
    if (!event.isRepeatable && this.state.flags.has(event.id + ':fired')) return false;

    const { condition } = event;
    if (condition.flags && !this.state.flags.hasAll(condition.flags)) return false;
    if (condition.anyFlags && !this.state.flags.hasAny(condition.anyFlags)) return false;

    if (condition.minStats) {
      const gs = this.state.getState();
      for (const [key, min] of Object.entries(condition.minStats)) {
        const val = this.resolveStatValue(gs, key);
        if (val === undefined || min === undefined || val < min) return false;
      }
    }

    return true;
  }

  // Select the first outcome whose condition is met (or the first unconditional one).
  private selectOutcome(event: GameEvent): EventOutcome | undefined {
    return event.outcomes.find(
      o => !o.condition || this.state.flags.evaluate(o.condition)
    );
  }

  private applyOutcome(outcome: EventOutcome): void {
    outcome.flagsSet?.forEach(f => this.state.flags.set(f));
    outcome.flagsUnset?.forEach(f => this.state.flags.unset(f));
    if (outcome.statChanges) {
      for (const [key, delta] of Object.entries(outcome.statChanges)) {
        if (delta !== undefined) this.state.modifyStat(key, delta);
      }
    }
  }

  private resolveStatValue(gs: Readonly<import('../types').GameState>, key: string): number | undefined {
    const [group, stat] = key.split('.');
    const statsGroup = (gs.player as unknown as Record<string, Record<string, number>>)[group];
    return statsGroup?.[stat];
  }
}
