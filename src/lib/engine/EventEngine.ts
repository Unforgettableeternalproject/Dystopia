// EventEngine — checks and applies GameEvent triggers.
// Called by GameController after each player action.
//
// Two entry points:
//   checkAndApply(locationId)   — location-bound events (from LocationNode.eventIds)
//   checkGlobalEvents(regionId) — global events (from RegionIndex.globalEventIds)

import type { GameEvent, EventOutcome, RegionSchedule } from '../types';
import type { LoreVault } from '../lore/LoreVault';
import type { StateManager } from './StateManager';
import type { TimeManager } from './TimeManager';
import { GameEvents } from './EventBus';

export interface TriggeredEvent {
  event: GameEvent;
  outcome: EventOutcome;
}

export class EventEngine {
  constructor(
    private lore:    LoreVault,
    private state:   StateManager,
    private time:    TimeManager,
    private schedule: RegionSchedule | null = null,
  ) {}

  /** Set the active region schedule (call when region changes). */
  setSchedule(schedule: RegionSchedule | null): void {
    this.schedule = schedule;
  }

  /**
   * Check all events available at the current location.
   * Returns triggered events with their selected outcomes.
   * Applies flag/stat/cooldown changes immediately.
   */
  checkAndApply(locationId: string): TriggeredEvent[] {
    const resolved = this.lore.resolveLocation(locationId, this.state.flags);
    if (!resolved) return [];
    return this.processEventIds(resolved.eventIds);
  }

  /**
   * Check global (non-location-bound) events for the current region.
   * Call once per turn after location events.
   */
  checkGlobalEvents(regionId: string): TriggeredEvent[] {
    const region = this.lore.getRegion(regionId);
    if (!region?.globalEventIds?.length) return [];
    return this.processEventIds(region.globalEventIds);
  }

  // -- Internal ----------------------------------------------------------

  private processEventIds(ids: string[]): TriggeredEvent[] {
    const events    = this.lore.getEventsByIds(ids);
    const triggered: TriggeredEvent[] = [];

    for (const ev of events) {
      if (!this.canTrigger(ev)) continue;

      const outcome = this.selectOutcome(ev);
      if (!outcome) continue;

      this.applyOutcome(outcome);
      triggered.push({ event: ev, outcome });

      // Non-repeatable: mark as permanently fired
      if (!ev.isRepeatable) {
        this.state.flags.set(ev.id + ':fired');
      } else {
        // Repeatable: record cooldown timestamp
        const gs = this.state.getState();
        this.state.setEventCooldown(ev.id, gs.time.totalMinutes);
      }

      this.state.emit(GameEvents.GAME_EVENT_TRIGGERED, { eventId: ev.id, outcomeId: outcome.id });
    }

    return triggered;
  }

  private canTrigger(event: GameEvent): boolean {
    const gs = this.state.getState();

    // Non-repeatable: skip if already fired
    if (!event.isRepeatable && this.state.flags.has(event.id + ':fired')) return false;

    const { condition } = event;

    // Flag conditions
    if (condition.flags    && !this.state.flags.hasAll(condition.flags))   return false;
    if (condition.anyFlags && !this.state.flags.hasAny(condition.anyFlags)) return false;
    if (condition.notFlags) {
      for (const f of condition.notFlags) {
        if (this.state.flags.has(f)) return false;
      }
    }

    // Stat conditions
    if (condition.minStats) {
      for (const [key, min] of Object.entries(condition.minStats)) {
        const val = this.resolveStatValue(gs, key);
        if (val === undefined || min === undefined || val < min) return false;
      }
    }

    // Time period condition
    if (condition.timePeriod && this.schedule) {
      const current = this.time.getCurrentPeriod(gs.time, this.schedule, gs.player.activeFlags);
      if (!condition.timePeriod.includes(current)) return false;
    }

    // Cooldown condition (repeatable events only)
    if (event.isRepeatable && condition.cooldownMinutes && condition.cooldownMinutes > 0) {
      const lastFired = gs.eventCooldowns[event.id];
      if (lastFired !== undefined) {
        const elapsed = gs.time.totalMinutes - lastFired;
        if (elapsed < condition.cooldownMinutes) return false;
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
