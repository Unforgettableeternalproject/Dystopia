// StateManager — holds and mutates GameState.
// All state changes go through here for consistency and event emission.

import type { GameState, PlayerAction, Thought, NPCMemoryEntry, ActiveDialogueState, GameTime } from '../types';
import type { PlayerCondition } from '../types/player';
import type { WorldPhaseId } from '../types/phase';
import type { QuestInstance } from '../types/quest';
import type { TimePeriod } from '../types/world';
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

  /** Update a stat by dot-path, e.g. "primaryStats.strength" */
  modifyStat(key: string, delta: number): void {
    const [group, stat] = key.split('.');
    const stats = (this.state.player as unknown as Record<string, Record<string, number>>)[group];
    if (stats && stat in stats) {
      stats[stat] = Math.max(0, stats[stat] + delta);
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

  // ── NPC Memory ───────────────────────────────────────────────

  /**
   * Record an NPC interaction. Creates entry on first contact.
   * dialogueId: the dialogue tree that was completed (if any).
   * choiceId: a significant player choice made during this interaction.
   */
  recordNPCInteraction(npcId: string, dialogueId?: string, choiceId?: string): void {
    const existing = this.state.npcMemory[npcId];
    if (!existing) {
      this.state.npcMemory[npcId] = {
        npcId,
        firstMetTurn: this.state.turn,
        lastInteractedTurn: this.state.turn,
        interactionCount: 1,
        completedDialogueIds: dialogueId ? [dialogueId] : [],
        keyChoiceIds: choiceId ? [choiceId] : [],
      };
    } else {
      existing.lastInteractedTurn = this.state.turn;
      existing.interactionCount += 1;
      if (dialogueId && !existing.completedDialogueIds.includes(dialogueId)) {
        existing.completedDialogueIds.push(dialogueId);
      }
      if (choiceId && !existing.keyChoiceIds.includes(choiceId)) {
        existing.keyChoiceIds.push(choiceId);
      }
    }
    this.notifyUpdate();
  }

  setNPCDialogueResume(npcId: string, nodeId: string): void {
    const mem = this.state.npcMemory[npcId];
    if (mem) {
      mem.lastDialogueNodeId = nodeId;
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

  endDialogue(completed = true): void {
    if (this.state.activeDialogue) {
      if (completed) {
        this.recordNPCInteraction(
          this.state.activeDialogue.npcId,
          this.state.activeDialogue.dialogueId
        );
      }
      this.state.activeDialogue = undefined;
    }
    this.state.phase = 'exploring';
    this.notifyUpdate();
  }

  // ── Quests ───────────────────────────────────────────────────

  startQuest(questId: string, entryStageId: string): void {
    this.state.activeQuests[questId] = {
      questId,
      currentStageId: entryStageId,
      completedObjectiveIds: [],
      isCompleted: false,
      isFailed: false,
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

  advanceQuestStage(questId: string, nextStageId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.currentStageId = nextStageId;
      this.bus.emit(GameEvents.QUEST_STAGE_ADVANCED, { questId, nextStageId });
      this.notifyUpdate();
    }
  }

  completeQuest(questId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.isCompleted = true;
      instance.currentStageId = null;
      if (!this.state.completedQuestIds.includes(questId)) {
        this.state.completedQuestIds.push(questId);
      }
      this.bus.emit(GameEvents.QUEST_COMPLETED, { questId });
      this.notifyUpdate();
    }
  }

  failQuest(questId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.isFailed = true;
      instance.currentStageId = null;
      if (!this.state.completedQuestIds.includes(questId)) {
        this.state.completedQuestIds.push(questId);
      }
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
