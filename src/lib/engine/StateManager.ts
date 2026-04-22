// StateManager — holds and mutates GameState.
// All state changes go through here for consistency and event emission.

import type { GameState, PlayerAction, Thought, NPCMemoryEntry, GameTime } from '../types';
import type { PlayerCondition } from '../types/condition';
import type { ConditionDefinition } from '../types/condition';
import type { WorldPhaseId } from '../types/phase';
import type { QuestInstance, QuestSource, QuestDitchConsequences, QuestReward } from '../types/quest';
import type { TimePeriod } from '../types/world';
import type { PlayerAttitude } from '../types/dialogue';
import { EventBus, GameEvents } from './EventBus';
import { FlagSystem } from './FlagSystem';

export type AcquisitionRecord =
  | { type: 'item';       itemId: string; variantId?: string }
  | { type: 'stat';       key: string; delta: number }
  | { type: 'reputation'; factionId: string; delta: number }
  | { type: 'affinity';   npcId: string; delta: number };

export class StateManager {
  private state: GameState;
  private bus: EventBus;
  readonly flags: FlagSystem;
  private _acquisitions: AcquisitionRecord[] = [];

  constructor(initialState: GameState, bus: EventBus) {
    this.state = initialState;
    this.bus = bus;
    const activeQuestFlags = Object.values(initialState.activeQuests)
      .filter(q => !q.isCompleted && !q.isFailed && !q.isDitched)
      .map(q => q.questId + ':active');
    this.flags = new FlagSystem(bus, [
      ...Array.from(initialState.player.activeFlags),
      ...activeQuestFlags,
    ]);
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  setPlayerName(name: string): void {
    this.state.player.name = name;
    this.notifyUpdate();
  }

  // ── Movement & discovery ─────────────────────────────────────

  movePlayer(locationId: string): void {
    const prev = this.state.player.currentLocationId;
    this.state.player.currentLocationId = locationId;
    this.discoverLocation(locationId);
    this.bus.emit(GameEvents.LOCATION_CHANGED, { from: prev, to: locationId });
    this.notifyUpdate();
  }

  discoverLocation(locationId: string): void {
    if (!this.state.discoveredLocationIds.includes(locationId)) {
      this.state.discoveredLocationIds.push(locationId);
      this.notifyUpdate();
    }
  }

  // ── Stats ────────────────────────────────────────────────────

  /** Modify Melphin (currency). Clamps to minimum 0. */
  modifyMelphin(delta: number): void {
    this.state.player.melphin = Math.max(0, this.state.player.melphin + delta);
    this.notifyUpdate();
  }

  /** Update a stat by dot-path, e.g. "primaryStats.strength" */
  modifyStat(key: string, delta: number): void {
    const [group, stat] = key.split('.');
    const stats = (this.state.player as unknown as Record<string, Record<string, number>>)[group];
    if (stats && stat in stats) {
      const maxKey = `${stat}Max`;
      const max = group === 'statusStats' && maxKey in stats ? stats[maxKey] : Infinity;
      stats[stat] = Math.min(max, Math.max(0, stats[stat] + delta));
      this.notifyUpdate();
      if (delta !== 0) this._acquisitions.push({ type: 'stat', key, delta });
    }
  }

  // ── External stats ───────────────────────────────────────────

  modifyReputation(factionId: string, delta: number): void {
    const current = this.state.player.externalStats.reputation[factionId] ?? 0;
    this.state.player.externalStats.reputation[factionId] = current + delta;
    this.notifyUpdate();
    if (delta !== 0) this._acquisitions.push({ type: 'reputation', factionId, delta });
  }

  modifyAffinity(npcId: string, delta: number): void {
    const current = this.state.player.externalStats.affinity[npcId] ?? 0;
    this.state.player.externalStats.affinity[npcId] = current + delta;
    this.notifyUpdate();
    if (delta !== 0) this._acquisitions.push({ type: 'affinity', npcId, delta });
  }

  addItem(
    itemId: string,
    totalMinutes: number,
    variantId?: string,
    opts?: { stackable?: boolean; maxStack?: number; maxUsesPerInstance?: number },
  ): void {
    if (opts?.stackable) {
      // Stack onto existing non-expired instance
      const existing = this.state.player.inventory.find(
        i => i.itemId === itemId && i.variantId === variantId && !i.isExpired,
      );
      if (existing) {
        const limit = opts.maxStack ?? Infinity;
        if (existing.quantity < limit) {
          existing.quantity += 1;
          this.notifyUpdate();
          this._acquisitions.push({ type: 'item', itemId, variantId });
          return;
        }
        // Stack is full — fall through to create a new stack below.
      }
    } else {
      // Non-stackable: skip if already held (original behaviour)
      const exists = this.state.player.inventory.some(
        i => i.itemId === itemId && i.variantId === variantId && !i.isExpired,
      );
      if (exists) return;
    }

    const newItem: import('../types/item').InventoryItem = {
      instanceId: itemId + (variantId ? '_' + variantId : '') + '_' + totalMinutes,
      itemId,
      variantId,
      obtainedAtMinute: totalMinutes,
      quantity: 1,
      isExpired: false,
    };
    if (opts?.maxUsesPerInstance !== undefined) {
      newItem.usesRemaining = opts.maxUsesPerInstance;
    }
    this.state.player.inventory.push(newItem);
    this.notifyUpdate();
    this._acquisitions.push({ type: 'item', itemId, variantId });
  }

  /**
   * 消耗一個消耗品物品實例，套用其效果並從物品欄移除/扣除。
   * 效果由呼叫方（GameController，持有 LoreVault）解析並傳入。
   * 回傳 true = 成功消耗；false = instanceId 不存在或物品非消耗品。
   */
  consumeItem(
    instanceId: string,
    effect: import('../types/item').ConsumableEffect,
    getCondition: (id: string) => import('../types/condition').ConditionDefinition | undefined,
  ): boolean {
    const idx = this.state.player.inventory.findIndex(i => i.instanceId === instanceId);
    if (idx === -1) return false;

    const item = this.state.player.inventory[idx];

    // Apply status changes
    if (effect.statusChanges) {
      for (const [key, delta] of Object.entries(effect.statusChanges)) {
        if (delta !== undefined) this.modifyStat(`statusStats.${key}`, delta);
      }
    }
    // Apply condition
    if (effect.applyConditionId) {
      this.addCondition(
        effect.applyConditionId,
        getCondition,
        effect.applyConditionDurationTurns !== undefined
          ? { expiresOnTurn: this.state.turn + effect.applyConditionDurationTurns }
          : undefined,
      );
    }
    // Remove conditions
    effect.removeConditionIds?.forEach(id => this.removeCondition(id));
    // Flags
    effect.flagsSet?.forEach(f => this.flags.set(f));
    effect.flagsUnset?.forEach(f => this.flags.unset(f));

    // Deduct usage
    if (item.usesRemaining !== undefined) {
      item.usesRemaining -= 1;
      if (item.usesRemaining <= 0) {
        this.state.player.inventory.splice(idx, 1);
      }
    } else if (item.quantity > 1) {
      item.quantity -= 1;
    } else {
      this.state.player.inventory.splice(idx, 1);
    }

    this.notifyUpdate();
    return true;
  }

  /** 直接從物品欄移除指定實例（丟棄用）。回傳 true = 成功移除。 */
  removeItem(instanceId: string): boolean {
    const idx = this.state.player.inventory.findIndex(i => i.instanceId === instanceId);
    if (idx === -1) return false;
    this.state.player.inventory.splice(idx, 1);
    this.notifyUpdate();
    return true;
  }

  /** 從堆疊中減少指定數量。count >= 現有數量時整堆移除。回傳 true = 成功。 */
  removeItemQuantity(instanceId: string, count: number): boolean {
    const idx = this.state.player.inventory.findIndex(i => i.instanceId === instanceId);
    if (idx === -1) return false;
    const item = this.state.player.inventory[idx];
    if (count >= item.quantity) {
      this.state.player.inventory.splice(idx, 1);
    } else {
      item.quantity -= count;
    }
    this.notifyUpdate();
    return true;
  }

  // ── Conditions ───────────────────────────────────────────────

  /**
   * Add or replace a player condition by id.
   * Automatically initializes tickState if the definition has a tickEffect.
   * @param conditionId  ConditionDefinition.id
   * @param getCondition  Resolver for condition definitions (e.g. lore.getCondition)
   * @param options       Optional expiresOnTurn override
   */
  addCondition(
    conditionId: string,
    getCondition: (id: string) => ConditionDefinition | undefined,
    options?: { expiresOnTurn?: number },
  ): void {
    const def = getCondition(conditionId);
    const instance: PlayerCondition = {
      id: conditionId,
      expiresOnTurn: options?.expiresOnTurn,
    };
    if (def?.tickEffect) {
      instance.tickState = {
        ticksApplied: 0,
        nextTickTurn: this.state.turn + def.tickEffect.everyNTurns,
      };
    }
    const idx = this.state.player.conditions.findIndex(c => c.id === conditionId);
    if (idx >= 0) {
      this.state.player.conditions[idx] = instance;
    } else {
      this.state.player.conditions.push(instance);
    }
    this.notifyUpdate();
  }

  removeCondition(conditionId: string): void {
    this.state.player.conditions = this.state.player.conditions.filter(c => c.id !== conditionId);
    this.notifyUpdate();
  }

  /**
   * Process condition ticks and expire outdated conditions. Call once per turn.
   * - Applies tick effects (e.g. bleeding damage) when nextTickTurn is reached.
   * - Removes conditions whose expiresOnTurn has passed or tickEffect is exhausted.
   * @param getCondition  Resolver for condition definitions (e.g. lore.getCondition)
   */
  tickConditions(getCondition: (id: string) => ConditionDefinition | undefined): void {
    const currentTurn = this.state.turn;
    let changed = false;

    for (const c of this.state.player.conditions) {
      if (!c.tickState) continue;
      const def = getCondition(c.id);
      if (!def?.tickEffect) continue;
      const te = def.tickEffect;

      // Apply all overdue ticks in sequence (handles skipped turns)
      while (c.tickState.nextTickTurn <= currentTurn && c.tickState.ticksApplied < te.maxTicks) {
        for (const [key, delta] of Object.entries(te.statChanges)) {
          if (delta !== undefined) this.modifyStat(key, delta);
        }
        c.tickState.ticksApplied += 1;
        c.tickState.nextTickTurn += te.everyNTurns;
        changed = true;
      }
    }

    const before = this.state.player.conditions.length;
    this.state.player.conditions = this.state.player.conditions.filter(c => {
      if (c.expiresOnTurn !== undefined && c.expiresOnTurn <= currentTurn) return false;
      if (c.tickState) {
        const def = getCondition(c.id);
        if (def?.tickEffect && c.tickState.ticksApplied >= def.tickEffect.maxTicks) return false;
      }
      return true;
    });

    if (changed || this.state.player.conditions.length !== before) this.notifyUpdate();
  }

  // ── Intel ────────────────────────────────────────────────────

  addKnownIntel(intelId: string): void {
    if (!this.state.player.knownIntelIds.includes(intelId)) {
      this.state.player.knownIntelIds.push(intelId);
      this.notifyUpdate();
    }
  }

  /**
   * Grant intel and mirror to FlagSystem as `intel:<intelId>`.
   * This allows contextSnippets and other conditions to use `intel:<id>` syntax.
   */
  grantIntel(intelId: string): void {
    this.addKnownIntel(intelId);
    this.flags.set('intel:' + intelId);
  }

  // ── NPC Memory ───────────────────────────────────────────────

  /**
   * Record that the player interacted with an NPC this turn.
   * Creates entry on first contact with neutral attitude.
   */
  recordNPCInteraction(npcId: string): void {
    const existing = this.state.npcMemory[npcId];
    if (!existing) {
      this.state.npcMemory[npcId] = {
        npcId,
        firstMetTurn:       this.state.turn,
        lastInteractedTurn: this.state.turn,
        interactionCount:   1,
        playerAttitude:     'neutral',
      };
    } else {
      existing.lastInteractedTurn = this.state.turn;
      existing.interactionCount  += 1;
    }
    this.notifyUpdate();
  }

  /**
   * Update NPC dialogue state after an interaction.
   * Called by DialogueManager when a DM <<NPC_STATE: ...>> signal is parsed.
   */
  updateNPCDialogueState(npcId: string, topic?: string, attitude?: PlayerAttitude): void {
    const mem = this.state.npcMemory[npcId];
    if (!mem) return;
    if (topic)    mem.lastTopic      = topic;
    if (attitude) mem.playerAttitude = attitude;
    this.notifyUpdate();
  }

  // ── Dialogue ─────────────────────────────────────────────────

  startDialogue(npcId: string, dialogueId: string, entryNodeId: string): void {
    this.state.activeDialogue = { npcId, dialogueId, currentNodeId: entryNodeId };
    this.state.phase = 'dialogue';
    this.notifyUpdate();
  }

  advanceDialogue(nodeId: string): void {
    if (this.state.activeDialogue) {
      this.state.activeDialogue.currentNodeId = nodeId;
      this.notifyUpdate();
    }
  }

  endDialogue(): void {
    if (this.state.activeDialogue) {
      this.recordNPCInteraction(this.state.activeDialogue.npcId);
      this.state.activeDialogue = undefined;
    }
    this.state.phase = 'exploring';
    this.notifyUpdate();
  }

  // ── Encounter ────────────────────────────────────────────────

  setPhase(phase: import('../types/game').GamePhase): void {
    this.state.phase = phase;
    this.notifyUpdate();
  }

  setActiveEncounter(encounter: import('../types/encounter').ActiveEncounter): void {
    this.state.activeEncounter = encounter;
    this.notifyUpdate();
  }

  clearActiveEncounter(): void {
    this.state.activeEncounter = undefined;
    this.state.phase = 'exploring';
    this.notifyUpdate();
  }

  // ── Intel (alias) ────────────────────────────────────────────

  /** Alias for grantIntel — sets knownIntelIds and mirrors to FlagSystem. */
  addIntel(intelId: string): void {
    this.grantIntel(intelId);
  }

  // ── Quests ───────────────────────────────────────────────────

  /**
   * 低階任務啟動（QuestEngine 呼叫）。
   * 外部請使用 QuestEngine.grantQuest() 或 QuestEngine.acceptQuest()。
   */
  startQuest(questId: string, entryStageId: string, options?: {
    source?: QuestSource;
    giverNpcId?: string;
    sourceEventId?: string;
    acceptedAtMinutes?: number;
    expiresAtMinutes?: number;
  }): void {
    this.state.activeQuests[questId] = {
      questId,
      source:                 options?.source        ?? 'npc',
      currentStageId:         entryStageId,
      completedObjectiveIds:  [],
      localFlags:             [],
      isCompleted:            false,
      isFailed:               false,
      isDitched:              false,
      giverNpcId:             options?.giverNpcId,
      sourceEventId:          options?.sourceEventId,
      acceptedAtMinutes:      options?.acceptedAtMinutes,
      expiresAtMinutes:       options?.expiresAtMinutes,
    };
    this.flags.set(questId + ':active');
    this.bus.emit(GameEvents.QUEST_STARTED, { questId });
    this.notifyUpdate();
  }

  completeObjective(questId: string, objectiveId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance && !instance.completedObjectiveIds.includes(objectiveId)) {
      instance.completedObjectiveIds.push(objectiveId);
      this.notifyUpdate();
    }
  }

  /** 設置任務本地旗標（不影響全域 FlagSystem）。 */
  setQuestLocalFlag(questId: string, flagName: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance && !instance.localFlags.includes(flagName)) {
      instance.localFlags.push(flagName);
      this.notifyUpdate();
    }
  }

  advanceQuestStage(questId: string, nextStageId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.currentStageId = nextStageId;
      instance.completedObjectiveIds = [];   // reset objectives for new stage
      this.bus.emit(GameEvents.QUEST_STAGE_ADVANCED, { questId, nextStageId });
      this.notifyUpdate();
    }
  }

  /**
   * 循環任務用重置（而非標記為 completed）。
   * 回到 entryStageId 並清除 objectives，保持 activeQuests 中繼續存在。
   */
  resetQuest(questId: string, entryStageId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      this.bus.emit(GameEvents.QUEST_COMPLETED, { questId });
      instance.currentStageId        = entryStageId;
      instance.completedObjectiveIds = [];
      instance.localFlags            = [];
      this.notifyUpdate();
    }
  }

  completeQuest(questId: string, reward?: QuestReward): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.isCompleted    = true;
      instance.currentStageId = null;
      this.flags.unset(questId + ':active');
      if (!this.state.completedQuestIds.includes(questId)) {
        this.state.completedQuestIds.push(questId);
      }
      // Apply rewards
      if (reward) {
        reward.flagsSet?.forEach(f => this.flags.set(f));
        if (reward.reputationChanges) {
          for (const [fid, delta] of Object.entries(reward.reputationChanges)) {
            const current = this.state.player.externalStats.reputation[fid] ?? 0;
            this.state.player.externalStats.reputation[fid] = current + delta;
          }
        }
        if (reward.affinityChanges) {
          for (const [nid, delta] of Object.entries(reward.affinityChanges)) {
            const current = this.state.player.externalStats.affinity[nid] ?? 0;
            this.state.player.externalStats.affinity[nid] = current + delta;
          }
        }
        if (reward.experience) {
          this.state.player.statusStats.experience += reward.experience;
        }
        if (reward.items) {
          const now = this.state.time.totalMinutes;
          reward.items.forEach(({ itemId, variantId }) => {
            this.addItem(itemId, now, variantId);
          });
        }
      }
      this.bus.emit(GameEvents.QUEST_COMPLETED, { questId });
      this.notifyUpdate();
    }
  }

  /**
   * 將已完成的循環任務實例從 activeQuests 移除。
   * 讓 QuestEngine.checkPendingRepeats 在條件成立時可重新授予。
   * 僅對 isCompleted=true 的實例有效。
   */
  removeActiveQuest(questId: string): void {
    if (this.state.activeQuests[questId]?.isCompleted) {
      delete this.state.activeQuests[questId];
      this.notifyUpdate();
    }
  }

  removeEndedQuest(questId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance?.isCompleted || instance?.isFailed || instance?.isDitched) {
      delete this.state.activeQuests[questId];
      this.notifyUpdate();
    }
  }

  /** 玩家主動放棄任務。套用當前階段的 ditchConsequences 後移出 activeQuests。 */
  ditchQuest(questId: string, consequences?: QuestDitchConsequences): void {
    const instance = this.state.activeQuests[questId];
    if (!instance) return;

    instance.isDitched      = true;
    instance.isFailed       = true;
    instance.currentStageId = null;
    this.flags.unset(questId + ':active');

    if (consequences) {
      consequences.flagsSet?.forEach(f => this.flags.set(f));
      consequences.flagsUnset?.forEach(f => this.flags.unset(f));
      // Direct override (set to exact value, used for forcing faction to hostile)
      if (consequences.reputationOverrides) {
        for (const [fid, value] of Object.entries(consequences.reputationOverrides)) {
          this.state.player.externalStats.reputation[fid] = value;
        }
      }
      // Delta changes (on top of any override)
      if (consequences.reputationChanges) {
        for (const [fid, delta] of Object.entries(consequences.reputationChanges)) {
          const current = this.state.player.externalStats.reputation[fid] ?? 0;
          this.state.player.externalStats.reputation[fid] = current + delta;
        }
      }
      if (consequences.affinityChanges) {
        for (const [nid, delta] of Object.entries(consequences.affinityChanges)) {
          const current = this.state.player.externalStats.affinity[nid] ?? 0;
          this.state.player.externalStats.affinity[nid] = current + delta;
        }
      }
      if (consequences.statChanges) {
        for (const [key, delta] of Object.entries(consequences.statChanges)) {
          if (delta !== undefined) this.modifyStat(key, delta);
        }
      }
    }

    // 出賣行為（有 beneficiaryFactionId）→ 進 completedQuestIds，不可再接
    // 普通放棄 → 不進 completedQuestIds，允許再次接受
    if (consequences?.beneficiaryFactionId && !this.state.completedQuestIds.includes(questId)) {
      this.state.completedQuestIds.push(questId);
    }
    delete this.state.activeQuests[questId];
    this.bus.emit(GameEvents.QUEST_DITCHED, {
      questId,
      isBetrayalDitch: !!consequences?.beneficiaryFactionId,
      beneficiaryFactionId: consequences?.beneficiaryFactionId,
    });
    this.notifyUpdate();
  }

  failQuest(questId: string, options?: { recordAsCompleted?: boolean }): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.isFailed       = true;
      instance.currentStageId = null;
      this.flags.unset(questId + ':active');
      const recordAsCompleted = options?.recordAsCompleted ?? true;
      if (recordAsCompleted && !this.state.completedQuestIds.includes(questId)) {
        this.state.completedQuestIds.push(questId);
      }
      this.bus.emit(GameEvents.QUEST_FAILED, { questId });
      this.notifyUpdate();
    }
  }

  // ── Time ─────────────────────────────────────────────────────

  advanceTime(newTime: GameTime, newPeriod: TimePeriod): boolean {
    const periodChanged = newPeriod !== this.state.timePeriod;
    this.state.time       = newTime;
    this.state.timePeriod = newPeriod;
    this.notifyUpdate();
    return periodChanged;
  }

  /**
   * 檢查物品欄中所有未失效物品，將已到達時限的物品標記為 isExpired。
   * @param getExpiresAfterMinutes 接受 itemId，回傳該物品定義的時限分鐘數；無時限回傳 undefined
   */
  tickItemExpiry(getExpiresAfterMinutes: (itemId: string) => number | undefined): void {
    const now = this.state.time.totalMinutes;
    let changed = false;
    for (const item of this.state.player.inventory) {
      if (item.isExpired) continue;
      const expiresAfter = getExpiresAfterMinutes(item.itemId);
      if (expiresAfter === undefined) continue;
      if (now >= item.obtainedAtMinute + expiresAfter) {
        item.isExpired = true;
        changed = true;
        this.bus.emit(GameEvents.ITEM_EXPIRED, { itemId: item.itemId, instanceId: item.instanceId, variantId: item.variantId });
      }
    }
    if (changed) this.notifyUpdate();
  }

  setEventCooldown(eventId: string, totalMinutes: number): void {
    this.state.eventCooldowns[eventId] = totalMinutes;
  }

  getEventCounter(counterId: string): number {
    return this.state.eventCounters[counterId] ?? 0;
  }

  setEventCounter(counterId: string, value: number): void {
    const next = Math.max(0, Math.trunc(value));
    if (next === 0) {
      delete this.state.eventCounters[counterId];
    } else {
      this.state.eventCounters[counterId] = next;
    }
    this.notifyUpdate();
  }

  modifyEventCounter(counterId: string, delta: number): void {
    this.setEventCounter(counterId, this.getEventCounter(counterId) + delta);
  }

  resetEventCounter(counterId: string): void {
    if (counterId in this.state.eventCounters) {
      delete this.state.eventCounters[counterId];
      this.notifyUpdate();
    }
  }

  // ── World phase ──────────────────────────────────────────────

  advancePhase(phaseId: WorldPhaseId): void {
    if (!this.state.worldPhase.appliedPhaseIds.includes(phaseId)) {
      this.state.worldPhase.currentPhase = phaseId;
      this.state.worldPhase.appliedPhaseIds.push(phaseId);
      this.bus.emit(GameEvents.PHASE_ADVANCED, { phaseId });
      this.notifyUpdate();
    }
  }

  // ── Narrative & thoughts ─────────────────────────────────────

  setThoughts(thoughts: Thought[]): void {
    this.state.pendingThoughts = thoughts;
    this.notifyUpdate();
  }

  setLastNarrative(text: string): void {
    this.state.lastNarrative = text;
  }

  /**
   * Append a history entry for the current turn, then increment turn counter.
   * flagsChanged format: '+flag_id' for set, '-flag_id' for unset.
   */
  appendHistory(
    action: PlayerAction,
    narrative: string,
    npcIds?: string[],
    flagsChanged?: string[],
  ): void {
    this.state.history.push({
      turn: this.state.turn,
      action,
      narrative,
      locationId: this.state.player.currentLocationId,
      npcIds,
      flagsChanged,
    });
    if (this.state.history.length > 20) {
      this.state.history.shift();
    }
    this.state.turn += 1;
    this.notifyUpdate();
  }

  // ── Internal ─────────────────────────────────────────────────

  /** Forward an arbitrary event to the bus (for use by sub-engines). */
  emit(event: string, payload: unknown): void {
    this.bus.emit(event, payload);
  }

  /** 取出並清空所有待顯示的獲取通知（由 GameController 在敘事結束後呼叫）。 */
  drainAcquisitions(): AcquisitionRecord[] {
    const records = this._acquisitions;
    this._acquisitions = [];
    return records;
  }

  private notifyUpdate(): void {
    this.bus.emit(GameEvents.STATE_UPDATED, this.state);
  }
}
