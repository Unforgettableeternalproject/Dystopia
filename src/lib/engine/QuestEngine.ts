// QuestEngine — tracks objective completion and advances quest stages.
// Call checkObjectives() after each state change that might complete an objective.

import type { LoreVault } from '../lore/LoreVault';
import type { StateManager } from './StateManager';
import type { QuestDefinition, QuestInstance, QuestObjective } from '../types/quest';
import type { GameState } from '../types';

export class QuestEngine {
  constructor(
    private lore: LoreVault,
    private state: StateManager,
  ) {}

  /** Accept a quest. Returns false if already active or unknown. */
  acceptQuest(questId: string): boolean {
    const def = this.lore.getQuest(questId);
    if (!def) return false;
    const gs = this.state.getState();
    if (gs.activeQuests[questId] || gs.completedQuestIds.includes(questId)) return false;
    this.state.startQuest(questId, def.entryStageId);
    return true;
  }

  /**
   * Scan all active quests for newly completed objectives or stage completions.
   * Safe to call every turn — idempotent for already-completed objectives.
   */
  checkObjectives(): void {
    const gs = this.state.getState();
    for (const [questId, instance] of Object.entries(gs.activeQuests)) {
      if (instance.isCompleted || instance.isFailed || !instance.currentStageId) continue;
      const def = this.lore.getQuest(questId);
      if (!def) continue;
      this.processStage(questId, instance, def);
    }
  }

  private processStage(questId: string, instance: QuestInstance, def: QuestDefinition): void {
    const stage = def.stages[instance.currentStageId!];
    if (!stage) return;

    const gs = this.state.getState();

    // Mark newly satisfied objectives
    for (const obj of stage.objectives) {
      if (!instance.completedObjectiveIds.includes(obj.id) && this.evaluateObjective(obj, gs)) {
        this.state.completeObjective(questId, obj.id);
      }
    }

    // Re-read instance after mutations
    const updated = this.state.getState().activeQuests[questId];
    const allDone = stage.objectives.every(o => updated.completedObjectiveIds.includes(o.id));
    if (!allDone) return;

    // Stage complete — apply outcome
    const outcome = stage.onComplete;
    outcome.flagsSet?.forEach(f => this.state.flags.set(f));
    outcome.flagsUnset?.forEach(f => this.state.flags.unset(f));
    if (outcome.statChanges) {
      for (const [key, delta] of Object.entries(outcome.statChanges)) {
        this.state.modifyStat(key, delta);
      }
    }

    if (outcome.nextStageId === null) {
      this.state.completeQuest(questId);
    } else {
      this.state.advanceQuestStage(questId, outcome.nextStageId);
    }
  }

  private evaluateObjective(obj: QuestObjective, gs: Readonly<GameState>): boolean {
    switch (obj.type) {
      case 'flag_check':
        return obj.flag ? this.state.flags.has(obj.flag) : false;
      case 'location_visit':
        return obj.locationId ? gs.discoveredLocationIds.includes(obj.locationId) : false;
      case 'npc_talk':
        return obj.npcId ? !!gs.npcMemory[obj.npcId] : false;
      case 'item_collect':
        return obj.itemId ? gs.player.inventory.includes(obj.itemId) : false;
      default:
        return false;
    }
  }
}
