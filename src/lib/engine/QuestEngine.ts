// QuestEngine — grant, track, and resolve quests.
//
// Quest lifecycle:
//   1. Grant  — grantQuest() / acceptQuest() adds to GameState.activeQuests
//   2. Check  — checkObjectives() evaluates objectives each turn
//   3. Resolve — complete / fail / ditch / reset (repeatable)
//
// Entry points for external code:
//   grantQuest(questId, options)       — system/NPC/event grants a quest
//   acceptQuest(questId)               — player manually accepts (NPC quests)
//   ditchQuest(questId)                — player abandons a ditch-able quest
//   checkObjectives()                  — call each turn
//   checkTimeLimits(totalMinutes)      — call each turn (after time advance)
//   autoGrantOriginQuests(origin)      — call once at game start

import type { LoreVault }         from '../lore/LoreVault';
import type { StateManager }      from './StateManager';
import type {
  QuestDefinition, QuestInstance,
  QuestObjective, QuestSource,
  QuestStageOutcome,
} from '../types/quest';
import type { GameState } from '../types';
import { GameEvents } from './EventBus';

export interface GrantQuestOptions {
  source?: QuestSource;
  giverNpcId?: string;
  sourceEventId?: string;
}

export class QuestEngine {
  constructor(
    private lore:  LoreVault,
    private state: StateManager,
  ) {}

  // ── Grant / Accept ────────────────────────────────────────────

  /**
   * System-level quest grant.
   * Used by: origin auto-grant at start, event triggers, NPC dialogue.
   * Bypasses "already completed" check for repeatable quests.
   */
  grantQuest(questId: string, options: GrantQuestOptions = {}): boolean {
    const def = this.lore.getQuest(questId);
    if (!def) return false;

    const gs = this.state.getState();

    // Skip if already active
    if (gs.activeQuests[questId]) return false;

    // For non-repeatable: skip if already completed or failed
    if (!def.isRepeatable && gs.completedQuestIds.includes(questId)) return false;

    const source = options.source ?? def.source;
    const now    = gs.time.totalMinutes;

    this.state.startQuest(questId, def.entryStageId, {
      source,
      giverNpcId:        options.giverNpcId  ?? def.giverNpcId,
      sourceEventId:     options.sourceEventId,
      acceptedAtMinutes: now,
      expiresAtMinutes:  def.timeLimit ? now + def.timeLimit : undefined,
    });

    this.state.emit(GameEvents.QUEST_GRANTED, {
      questId,
      source,
      factionId:   def.factionId,
      giverNpcId:  options.giverNpcId ?? def.giverNpcId,
    });

    return true;
  }

  /**
   * Player-initiated quest acceptance (from NPC conversation).
   * Fails if already active, or completed (non-repeatable).
   */
  acceptQuest(questId: string): boolean {
    return this.grantQuest(questId, { source: 'npc' });
  }

  /**
   * Player abandons a ditch-able quest.
   * Applies ditchConsequences from current stage (if defined), then definition level.
   */
  ditchQuest(questId: string): boolean {
    const def      = this.lore.getQuest(questId);
    const instance = this.state.getState().activeQuests[questId];
    if (!def || !instance || !def.canDitch) return false;

    // Stage-level ditch outcomes first
    const stage = instance.currentStageId ? def.stages[instance.currentStageId] : undefined;
    if (stage?.onDitch) {
      const od = stage.onDitch;
      od.flagsSet?.forEach(f => this.state.flags.set(f));
      od.flagsUnset?.forEach(f => this.state.flags.unset(f));
      if (od.statChanges) {
        for (const [key, delta] of Object.entries(od.statChanges)) {
          if (delta !== undefined) this.state.modifyStat(key, delta);
        }
      }
      if (od.reputationChanges) {
        for (const [fid, delta] of Object.entries(od.reputationChanges)) {
          this.applyReputation(fid, delta);
        }
      }
    }

    this.state.ditchQuest(questId, def.ditchConsequences);
    return true;
  }

  // ── Origin auto-grant ─────────────────────────────────────────

  /**
   * Called once at game start.
   * Finds all quests with source='origin' and autoAccept=true
   * that match the player's origin, and grants them.
   */
  autoGrantOriginQuests(origin: string): void {
    // LoreVault exposes all quests; we filter here
    const all = this.lore.getAllQuests();
    for (const def of all) {
      if (def.source !== 'origin' || !def.autoAccept) continue;
      if (def.originFilter && !def.originFilter.includes(origin)) continue;
      this.grantQuest(def.id, { source: 'origin' });
    }
  }

  // ── Objective checking ────────────────────────────────────────

  /**
   * Scan all active quests for newly satisfied objectives or completed stages.
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

  /**
   * Check time-limited quests for expiry.
   * Call each turn after time has been advanced.
   */
  checkTimeLimits(totalMinutes: number): void {
    const gs = this.state.getState();
    for (const [questId, instance] of Object.entries(gs.activeQuests)) {
      if (instance.isCompleted || instance.isFailed) continue;
      if (instance.expiresAtMinutes !== undefined && totalMinutes >= instance.expiresAtMinutes) {
        this.state.flags.set(questId + ':expired');
        this.state.failQuest(questId);
      }
    }
  }

  // ── Internal ──────────────────────────────────────────────────

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

    // Re-read instance after possible mutations
    const updated = this.state.getState().activeQuests[questId];
    if (!updated) return;
    const allDone = stage.objectives.every(o => updated.completedObjectiveIds.includes(o.id));
    if (!allDone) return;

    // Stage complete — apply stage outcome
    this.applyStageOutcome(stage.onComplete);

    if (stage.onComplete.nextStageId === null) {
      // Quest done
      if (def.isRepeatable) {
        // Repeatable: reset instead of completing
        this.state.resetQuest(questId, def.entryStageId);
      } else {
        this.state.completeQuest(questId, def.rewards);
        // Set faction flag if faction quest
        if (def.isFactionQuest && def.factionId) {
          this.state.flags.set('player_joined_' + def.factionId);
        }
      }
    } else {
      this.state.advanceQuestStage(questId, stage.onComplete.nextStageId);
    }
  }

  private applyStageOutcome(outcome: QuestStageOutcome): void {
    outcome.flagsSet?.forEach(f => this.state.flags.set(f));
    outcome.flagsUnset?.forEach(f => this.state.flags.unset(f));
    if (outcome.statChanges) {
      for (const [key, delta] of Object.entries(outcome.statChanges)) {
        if (delta !== undefined) this.state.modifyStat(key, delta);
      }
    }
    if (outcome.reputationChanges) {
      for (const [fid, delta] of Object.entries(outcome.reputationChanges)) {
        this.applyReputation(fid, delta);
      }
    }
  }

  private applyReputation(factionId: string, delta: number): void {
    this.state.modifyReputation(factionId, delta);
  }

  private evaluateObjective(obj: QuestObjective, gs: Readonly<GameState>): boolean {
    switch (obj.type) {
      case 'flag_check':
        return obj.flag ? this.state.flags.has(obj.flag) : false;

      case 'flag_expression':
        return obj.flagExpression ? this.state.flags.evaluate(obj.flagExpression) : false;

      case 'location_visit':
        return obj.locationId ? gs.discoveredLocationIds.includes(obj.locationId) : false;

      case 'npc_talk':
        return obj.npcId ? !!gs.npcMemory[obj.npcId] : false;

      case 'item_collect':
        return obj.itemId ? gs.player.inventory.includes(obj.itemId) : false;

      case 'reputation': {
        if (!obj.factionId || obj.minReputation === undefined) return false;
        const rep = gs.player.externalStats.reputation[obj.factionId] ?? 0;
        return rep >= obj.minReputation;
      }

      default:
        return false;
    }
  }
}
