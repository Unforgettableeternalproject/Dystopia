// EventEngine — checks and applies GameEvent triggers.
// Called by GameController after each player action.
//
// Two entry points:
//   checkAndApply(locationId)   — location-bound events (from LocationNode.eventIds)
//   checkGlobalEvents(regionId) — global events (from RegionIndex.globalEventIds)

import type { GameEvent, EventOutcome, RegionSchedule, ItemRequirement } from '../types';
import type { LoreVault } from '../lore/LoreVault';
import type { StateManager } from './StateManager';
import type { TimeManager } from './TimeManager';
import { GameEvents } from './EventBus';

export interface TriggeredEvent {
  event: GameEvent;
  outcome: EventOutcome;
  /** 此結果需要授予的任務 ID（由 GameController 轉交 QuestEngine） */
  grantQuestId?: string;
  /** 此結果需要開啟的遭遇 ID（由 GameController 轉交 EncounterEngine） */
  startEncounterId?: string;
  /** 此結果需要觸發失敗的任務 ID（由 GameController 轉交 QuestEngine.applyQuestFail） */
  failQuestId?: string;
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

  // Temporary context populated before each processEventIds pass.
  // Avoids threading extra params through every internal method.
  private checkCtx: { sceneNpcIds: string[]; crossedHours: number[] } = {
    sceneNpcIds: [],
    crossedHours: [],
  };

  /**
   * Check all events at the current location.
   * @param crossedHours Hour boundaries (0–23) crossed during this action's time advance.
   */
  checkAndApply(locationId: string, crossedHours: number[] = []): TriggeredEvent[] {
    const resolved = this.lore.resolveLocation(locationId, this.state.flags);
    if (!resolved) return [];
    this.checkCtx = { sceneNpcIds: resolved.npcIds, crossedHours };
    return this.processEventIds(resolved.eventIds);
  }

  /**
   * Check global (non-location-bound) events for the current region.
   * @param crossedHours Hour boundaries (0–23) crossed during this action's time advance.
   */
  checkGlobalEvents(regionId: string, crossedHours: number[] = []): TriggeredEvent[] {
    const region = this.lore.getRegion(regionId);
    if (!region?.globalEventIds?.length) return [];
    // Global events may also specify npcIds — check against current scene
    const gs       = this.state.getState();
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    this.checkCtx  = { sceneNpcIds: resolved?.npcIds ?? [], crossedHours };
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
      triggered.push({
        event: ev,
        outcome,
        grantQuestId:     outcome.grantQuestId,
        startEncounterId: outcome.startEncounterId,
        failQuestId:      outcome.failQuestId,
      });

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

    // NPC presence condition — at least one required NPC must be in the current scene
    if (condition.npcIds?.length) {
      const hasNpc = condition.npcIds.some(id => this.checkCtx.sceneNpcIds.includes(id));
      if (!hasNpc) return false;
    }

    // Hour-boundary trigger — fires only when the clock crosses one of these hours
    // during this action's time advance. Acts as a gate: if specified and no
    // matching boundary was crossed, the event does not fire this turn.
    if (condition.triggerHours?.length) {
      const crossed = condition.triggerHours.some(h => this.checkCtx.crossedHours.includes(h));
      if (!crossed) return false;
    }

    // Quest active condition — specified quest must be in progress
    if (condition.questActiveId) {
      const qInst = gs.activeQuests[condition.questActiveId];
      if (!qInst || qInst.isCompleted || qInst.isFailed) return false;
      // Optional: specific stage must match
      if (condition.questStageId && qInst.currentStageId !== condition.questStageId) return false;
    }

    // Item requirements — player must hold all specified non-expired items
    if (condition.itemRequirements?.length) {
      for (const req of condition.itemRequirements) {
        const held = gs.player.inventory.some(
          i => i.itemId === req.itemId
            && !i.isExpired
            && (req.variantId === undefined || i.variantId === req.variantId)
        );
        if (!held) return false;
      }
    }

    // Melphin minimum — player must hold at least this amount
    if (condition.minMelphin !== undefined && gs.player.melphin < condition.minMelphin) {
      return false;
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
    if (outcome.reputationChanges) {
      for (const [factionId, delta] of Object.entries(outcome.reputationChanges)) {
        if (delta !== undefined) this.state.modifyReputation(factionId, delta);
      }
    }
    if (outcome.affinityChanges) {
      for (const [npcId, delta] of Object.entries(outcome.affinityChanges)) {
        if (delta !== undefined) this.state.modifyAffinity(npcId, delta);
      }
    }
    if (outcome.grantItems?.length) {
      const now = this.state.getState().time.totalMinutes;
      for (const { itemId, variantId } of outcome.grantItems) {
        this.state.addItem(itemId, now, variantId);
      }
    }
    if (outcome.melphinChange) {
      this.state.modifyMelphin(outcome.melphinChange);
    }
    // grantQuestId, startEncounterId, failQuestId are intentionally NOT applied here.
    // They require higher-level coordination (QuestEngine / EncounterEngine)
    // and are handled by GameController after processEventIds returns.
  }

  private resolveStatValue(gs: Readonly<import('../types').GameState>, key: string): number | undefined {
    const [group, stat] = key.split('.');
    const statsGroup = (gs.player as unknown as Record<string, Record<string, number>>)[group];
    return statsGroup?.[stat];
  }
}
