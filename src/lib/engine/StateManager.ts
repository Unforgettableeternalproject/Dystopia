// StateManager — holds and mutates GameState.
// All state changes go through here for consistency and event emission.

import type { GameState, PlayerAction, Thought, NPCMemoryEntry, GameTime } from '../types';
import type { PlayerCondition } from '../types/player';
import type { WorldPhaseId } from '../types/phase';
import type { QuestInstance, QuestSource, QuestDitchConsequences, QuestReward } from '../types/quest';
import type { TimePeriod } from '../types/world';
import type { PlayerAttitude } from '../types/dialogue';
import { EventBus, GameEvents } from './EventBus';
import { FlagSystem } from './FlagSystem';

export class StateManager {
  private state: GameState;
  private bus: EventBus;
  readonly flags: FlagSystem;

  constructor(initialState: GameState, bus: EventBus) {
    this.state = initialState;
    this.bus = bus;
    this.flags = new FlagSystem(bus, Array.from(initialState.player.activeFlags));
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
      stats[stat] = Math.max(0, stats[stat] + delta);
      this.notifyUpdate();
    }
  }

  // ── External stats ───────────────────────────────────────────

  modifyReputation(factionId: string, delta: number): void {
    const current = this.state.player.externalStats.reputation[factionId] ?? 0;
    this.state.player.externalStats.reputation[factionId] = current + delta;
    this.notifyUpdate();
  }

  modifyAffinity(npcId: string, delta: number): void {
    const current = this.state.player.externalStats.affinity[npcId] ?? 0;
    this.state.player.externalStats.affinity[npcId] = current + delta;
    this.notifyUpdate();
  }

  addItem(itemId: string, totalMinutes: number, variantId?: string): void {
    const exists = this.state.player.inventory.some(
      i => i.itemId === itemId && i.variantId === variantId && !i.isExpired
    );
    if (!exists) {
      this.state.player.inventory.push({
        instanceId: itemId + (variantId ? '_' + variantId : '') + '_' + totalMinutes,
        itemId,
        variantId,
        obtainedAtMinute: totalMinutes,
        quantity: 1,
        isExpired: false,
      });
      this.notifyUpdate();
    }
  }

  // ── Conditions ───────────────────────────────────────────────

  /** Add or replace a player condition by id. */
  addCondition(condition: PlayerCondition): void {
    const idx = this.state.player.conditions.findIndex(c => c.id === condition.id);
    if (idx >= 0) {
      this.state.player.conditions[idx] = condition;
    } else {
      this.state.player.conditions.push(condition);
    }
    this.notifyUpdate();
  }

  removeCondition(conditionId: string): void {
    this.state.player.conditions = this.state.player.conditions.filter(c => c.id !== conditionId);
    this.notifyUpdate();
  }

  /** Expire any conditions whose expiresOnTurn <= current turn. Call once per turn. */
  tickConditions(): void {
    const before = this.state.player.conditions.length;
    this.state.player.conditions = this.state.player.conditions.filter(
      c => c.expiresOnTurn === undefined || c.expiresOnTurn > this.state.turn
    );
    if (this.state.player.conditions.length !== before) this.notifyUpdate();
  }

  // ── Intel ────────────────────────────────────────────────────

  addKnownIntel(intelId: string): void {
    if (!this.state.player.knownIntelIds.includes(intelId)) {
      this.state.player.knownIntelIds.push(intelId);
      this.notifyUpdate();
    }
  }

  /** Grant intel and mirror to FlagSystem as `know_<intelId>` for flag-condition use. */
  grantIntel(intelId: string): void {
    this.addKnownIntel(intelId);
    this.flags.set('know_' + intelId);
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
        firstMetTurn:         this.state.turn,
        lastInteractedTurn:   this.state.turn,
        interactionCount:     1,
        playerAttitude:       'neutral',
        permanentMilestoneIds: [],
      };
    } else {
      existing.lastInteractedTurn = this.state.turn;
      existing.interactionCount  += 1;
    }
    this.notifyUpdate();
  }

  /**
   * Update NPC dialogue state after an interaction.
   * Called by DialogueManager when a DM <<NPC: ...>> signal is parsed.
   */
  updateNPCDialogueState(npcId: string, topic?: string, attitude?: PlayerAttitude): void {
    const mem = this.state.npcMemory[npcId];
    if (!mem) return;
    if (topic)    mem.lastTopic       = topic;
    if (attitude) mem.playerAttitude  = attitude;
    this.notifyUpdate();
  }

  /**
   * Record a permanent dialogue milestone for an NPC.
   * Called by DialogueManager when a DM <<MILESTONE: id>> signal is parsed.
   */
  recordPermanentMilestone(npcId: string, milestoneId: string): void {
    const mem = this.state.npcMemory[npcId];
    if (!mem) return;
    if (!mem.permanentMilestoneIds.includes(milestoneId)) {
      mem.permanentMilestoneIds.push(milestoneId);
      this.notifyUpdate();
    }
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

  /** 玩家主動放棄任務。套用當前階段的 ditchConsequences 後移出 activeQuests。 */
  ditchQuest(questId: string, consequences?: QuestDitchConsequences): void {
    const instance = this.state.activeQuests[questId];
    if (!instance) return;

    instance.isDitched      = true;
    instance.isFailed       = true;
    instance.currentStageId = null;

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

  failQuest(questId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.isFailed       = true;
      instance.currentStageId = null;
      if (!this.state.completedQuestIds.includes(questId)) {
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

  private notifyUpdate(): void {
    this.bus.emit(GameEvents.STATE_UPDATED, this.state);
  }
}
