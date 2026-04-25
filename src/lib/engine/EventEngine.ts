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
import type { PrimaryStatKey } from '../types/player';
import { GameEvents } from './EventBus';
import { checkDateTimeConditions, checkTimeRanges } from '../utils/dateTimeCondition';

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

    // Collect eventIds from current location and all ancestor locations.
    // This allows events registered at a parent location to fire in any sublocation.
    const eventIds = [...resolved.eventIds];
    let parentId = resolved.parentId;
    while (parentId) {
      const parent = this.lore.resolveLocation(parentId, this.state.flags);
      if (!parent) break;
      eventIds.push(...parent.eventIds);
      parentId = parent.parentId;
    }

    this.checkCtx = { sceneNpcIds: resolved.npcIds, crossedHours };
    return this.processEventIds(eventIds);
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

  /**
   * Checks (without applying effects) whether any triggerHours events would fire
   * for the given crossed-hour set. Used by executeRest() to detect sleep interrupt points.
   *
   * Only events with condition.triggerHours are considered — probability-based
   * or presence-based events do not interrupt sleep.
   * triggerChance is intentionally skipped: time-boundary events should reliably wake the player.
   */
  peekHourlyInterrupts(regionId: string, locationId: string, crossedHours: number[]): GameEvent[] {
    const resolved = this.lore.resolveLocation(locationId, this.state.flags);
    this.checkCtx = { sceneNpcIds: resolved?.npcIds ?? [], crossedHours };

    const region = this.lore.getRegion(regionId);
    const globalIds = region?.globalEventIds ?? [];

    const locationIds: string[] = [];
    if (resolved) {
      locationIds.push(...resolved.eventIds);
      let parentId = resolved.parentId;
      while (parentId) {
        const parent = this.lore.resolveLocation(parentId, this.state.flags);
        if (!parent) break;
        locationIds.push(...parent.eventIds);
        parentId = parent.parentId;
      }
    }

    const events = this.lore.getEventsByIds([...globalIds, ...locationIds]);
    return events.filter(ev =>
      ev.condition.triggerHours?.length &&
      this.canTrigger(ev, /* skipChance */ true),
    );
  }

  /**
   * 在休息開始時（時間推進前）檢查 rest_start 事件。
   * 只處理 condition.triggerOn === 'rest_start' 的事件。
   * 若有事件觸發，GameController 將強制套用極差休息結果。
   */
  checkRestStartEvents(regionId: string, locationId: string): TriggeredEvent[] {
    const resolved = this.lore.resolveLocation(locationId, this.state.flags);
    this.checkCtx = { sceneNpcIds: resolved?.npcIds ?? [], crossedHours: [] };

    const region = this.lore.getRegion(regionId);
    const globalIds = region?.globalEventIds ?? [];

    const locationIds: string[] = [];
    if (resolved) {
      locationIds.push(...resolved.eventIds);
      let parentId = resolved.parentId;
      while (parentId) {
        const parent = this.lore.resolveLocation(parentId, this.state.flags);
        if (!parent) break;
        locationIds.push(...parent.eventIds);
        parentId = parent.parentId;
      }
    }

    const allIds    = [...globalIds, ...locationIds];
    const allEvents = this.lore.getEventsByIds(allIds);
    const restStartIds = allEvents
      .filter(ev => ev.condition.triggerOn === 'rest_start')
      .map(ev => ev.id);

    return this.processEventIds(restStartIds);
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

  private canTrigger(event: GameEvent, skipChance = false): boolean {
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

    if (condition.minEventCounters) {
      for (const [counterId, min] of Object.entries(condition.minEventCounters)) {
        if (min === undefined || this.state.getEventCounter(counterId) < min) return false;
      }
    }
    if (condition.maxEventCounters) {
      for (const [counterId, max] of Object.entries(condition.maxEventCounters)) {
        if (max === undefined || this.state.getEventCounter(counterId) > max) return false;
      }
    }
    if (condition.exactEventCounters) {
      for (const [counterId, exact] of Object.entries(condition.exactEventCounters)) {
        if (exact === undefined || this.state.getEventCounter(counterId) !== exact) return false;
      }
    }

    // Time period condition
    if (condition.timePeriods && this.schedule) {
      const current = this.time.getCurrentPeriod(gs.time, this.schedule, gs.player.activeFlags);
      if (!condition.timePeriods.includes(current)) return false;
    }

    // Time range condition (daily recurring, OR within array)
    if (!checkTimeRanges(condition.timeRanges, gs.time)) return false;

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

    // Not-item condition — blocked if player holds any of these items (non-expired)
    if (condition.notItemIds?.length) {
      const hasAny = condition.notItemIds.some(id =>
        gs.player.inventory.some(i => i.itemId === id && !i.isExpired)
      );
      if (hasAny) return false;
    }

    // Melphin minimum — player must hold at least this amount
    if (condition.minMelphin !== undefined && gs.player.melphin < condition.minMelphin) {
      return false;
    }

    // Date-time conditions (array is OR — at least one must pass)
    if (!checkDateTimeConditions(condition.dateTimeConditions, gs.time)) return false;

    // Reputation conditions (AND — all must pass)
    if (condition.minReputation) {
      const rep = gs.player.externalStats.reputation;
      for (const [fid, min] of Object.entries(condition.minReputation)) {
        if ((rep[fid] ?? 0) < min) return false;
      }
    }
    if (condition.maxReputation) {
      const rep = gs.player.externalStats.reputation;
      for (const [fid, max] of Object.entries(condition.maxReputation)) {
        if ((rep[fid] ?? 0) > max) return false;
      }
    }

    // Affinity conditions (AND — all must pass)
    if (condition.minAffinity) {
      const aff = gs.player.externalStats.affinity;
      for (const [nid, min] of Object.entries(condition.minAffinity)) {
        if ((aff[nid] ?? 0) < min) return false;
      }
    }
    if (condition.maxAffinity) {
      const aff = gs.player.externalStats.affinity;
      for (const [nid, max] of Object.entries(condition.maxAffinity)) {
        if ((aff[nid] ?? 0) > max) return false;
      }
    }

    // Trigger chance — roll last so all hard conditions pass first
    if (!skipChance && event.condition.triggerChance !== undefined && event.condition.triggerChance < 1) {
      if (Math.random() > event.condition.triggerChance) return false;
    }

    return true;
  }

  /**
   * Directly trigger an event by ID from an external source (e.g. quest onFail.startEventId).
   * Skips time-based and cooldown conditions, but still respects notFlags guards
   * to prevent accidental double-firing.
   */
  fireEventById(eventId: string): TriggeredEvent | null {
    const event = this.lore.getEvent(eventId);
    if (!event) return null;

    // Respect notFlags guard only
    if (event.condition.notFlags) {
      for (const f of event.condition.notFlags) {
        if (this.state.flags.has(f)) return null;
      }
    }

    const gs = this.state.getState();
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    this.checkCtx = { sceneNpcIds: resolved?.npcIds ?? [], crossedHours: [] };

    const outcome = this.selectOutcome(event);
    if (!outcome) return null;

    this.applyOutcome(outcome);

    if (!event.isRepeatable) {
      this.state.flags.set(event.id + ':fired');
    } else {
      this.state.setEventCooldown(event.id, gs.time.totalMinutes);
    }

    this.state.emit(GameEvents.GAME_EVENT_TRIGGERED, { eventId: event.id, outcomeId: outcome.id });

    return {
      event,
      outcome,
      grantQuestId:     outcome.grantQuestId,
      startEncounterId: outcome.startEncounterId,
      failQuestId:      outcome.failQuestId,
    };
  }

  /**
   * Force-trigger an event by ID, bypassing all canTrigger conditions.
   * Used by debug tools only.
   */
  forceEvent(eventId: string): TriggeredEvent | null {
    const event = this.lore.getEvent(eventId);
    if (!event) return null;

    // Set up checkCtx for the current scene so applyOutcome has context
    const resolved = this.lore.resolveLocation(
      this.state.getState().player.currentLocationId,
      this.state.flags,
    );
    this.checkCtx = { sceneNpcIds: resolved?.npcIds ?? [], crossedHours: [] };

    const outcome = this.selectOutcome(event);
    if (!outcome) return null;

    this.applyOutcome(outcome);

    if (!event.isRepeatable) {
      this.state.flags.set(event.id + ':fired');
    } else {
      this.state.setEventCooldown(event.id, this.state.getState().time.totalMinutes);
    }

    this.state.emit(GameEvents.GAME_EVENT_TRIGGERED, { eventId: event.id, outcomeId: outcome.id });

    return {
      event,
      outcome,
      grantQuestId:     outcome.grantQuestId,
      startEncounterId: outcome.startEncounterId,
      failQuestId:      outcome.failQuestId,
    };
  }

  // Select an outcome via weighted random:
  // 1. Collect all conditional outcomes whose condition passes.
  //    If any exist, weighted-random among them (conditions take priority over fallbacks).
  // 2. Otherwise, weighted-random among all unconditional outcomes.
  // weight defaults to 1 for all outcomes.
  private selectOutcome(event: GameEvent): EventOutcome | undefined {
    const pool = event.outcomes.filter(
      o => o.condition && this.state.flags.evaluate(o.condition)
    );
    const candidates = pool.length > 0
      ? pool
      : event.outcomes.filter(o => !o.condition);

    const weighted = candidates
      .map(outcome => ({ outcome, weight: this.resolveOutcomeWeight(outcome) }))
      .filter(entry => entry.weight > 0);

    if (weighted.length === 0) return undefined;
    if (weighted.length === 1) return weighted[0].outcome;

    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll <= 0) return entry.outcome;
    }
    return weighted[weighted.length - 1].outcome;
  }

  private resolveOutcomeWeight(outcome: EventOutcome): number {
    const baseWeight = outcome.weight ?? 1;
    const rule = outcome.weightByEventCounter;
    if (!rule) return baseWeight;

    const counterValue = this.state.getEventCounter(rule.counterId);
    const exactWeight = rule.valueWeights[String(counterValue)];
    if (exactWeight !== undefined) return Math.max(0, exactWeight);
    if (rule.fallback !== 'nearest_lower') return Math.max(0, baseWeight);

    const nearestLower = Object.entries(rule.valueWeights)
      .map(([key, weight]) => ({ key: Number(key), weight }))
      .filter(entry => Number.isFinite(entry.key) && entry.key <= counterValue)
      .sort((a, b) => b.key - a.key)[0];

    return Math.max(0, nearestLower?.weight ?? baseWeight);
  }

  private applyOutcome(outcome: EventOutcome): void {
    outcome.flagsSet?.forEach(f => this.state.flags.set(f));
    outcome.flagsUnset?.forEach(f => this.state.flags.unset(f));
    outcome.eventCounterReset?.forEach(counterId => this.state.resetEventCounter(counterId));
    if (outcome.eventCounterSet) {
      for (const [counterId, value] of Object.entries(outcome.eventCounterSet)) {
        if (value !== undefined) this.state.setEventCounter(counterId, value);
      }
    }
    if (outcome.eventCounterChanges) {
      for (const [counterId, delta] of Object.entries(outcome.eventCounterChanges)) {
        if (delta !== undefined) this.state.modifyEventCounter(counterId, delta);
      }
    }
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
        const def = this.lore.getItem(itemId);
        this.state.addItem(itemId, now, variantId, {
          stackable:          def?.stackable,
          maxStack:           def?.maxStack,
          maxUsesPerInstance: def?.maxUsesPerInstance,
        });
      }
    }
    if (outcome.melphinChange) {
      this.state.modifyMelphin(outcome.melphinChange);
    }
    if (outcome.applyConditionId) {
      this.state.addCondition(outcome.applyConditionId, id => this.lore.getCondition(id));
    }
    if (outcome.removeConditionIds?.length) {
      for (const id of outcome.removeConditionIds) {
        this.state.removeCondition(id);
      }
    }
    if (outcome.skillExpChanges) {
      for (const [statKey, baseAmount] of Object.entries(outcome.skillExpChanges)) {
        if (baseAmount !== undefined) {
          this.state.grantSkillExp(statKey as PrimaryStatKey, baseAmount, 'event');
        }
      }
    }
    if (outcome.characterExpGrant) {
      this.state.grantCharacterExp(outcome.characterExpGrant);
    }
    if (outcome.npcFlagsSet) {
      this.state.applyNPCFlagsSet(outcome.npcFlagsSet);
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
