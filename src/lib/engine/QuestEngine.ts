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
  QuestStageOutcome, QuestStageFailOutcome,
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

    // cannotCoexist: block grant if any mutually exclusive quest is currently active
    if (def.cannotCoexist?.length) {
      for (const conflictId of def.cannotCoexist) {
        const conflict = gs.activeQuests[conflictId];
        if (conflict && !conflict.isCompleted && !conflict.isFailed) return false;
      }
    }

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
   * 重新授予已完成且有 repeatCondition 的循環任務。
   * 每回合呼叫一次（在 checkObjectives 之後）。
   */
  checkPendingRepeats(): void {
    const gs  = this.state.getState();
    const all = this.lore.getAllQuests();
    for (const def of all) {
      if (!def.isRepeatable || !def.repeatCondition) continue;
      // 只處理已完成但目前不在 activeQuests 的任務
      if (gs.activeQuests[def.id]) continue;
      if (!gs.completedQuestIds.includes(def.id)) continue;
      if (this.state.flags.evaluate(def.repeatCondition)) {
        this.grantQuest(def.id, { source: def.source });
      }
    }
  }

  /**
   * 玩家主動放棄任務（MVP v1 Abandon 語意）。
   * 條件：quest 可被放棄（type !== 'main'，或作者顯式設 canAbandon = false 時封鎖）。
   * 行為：直接呼叫 applyQuestFail(questId, { isAbandoned: true })。
   */
  abandonQuest(questId: string): boolean {
    const def      = this.lore.getQuest(questId);
    const instance = this.state.getState().activeQuests[questId];
    if (!def || !instance || instance.isCompleted || instance.isFailed) return false;

    // canAbandon 顯式設 false = 不可放棄（優先於 type 推導）
    if (def.canAbandon === false) return false;
    // type = 'main' 預設不可放棄，除非作者顯式設 canAbandon = true
    if (def.type === 'main' && def.canAbandon !== true) return false;

    this.applyQuestFail(questId, { isAbandoned: true });

    // Guarantee the quest is marked as failed even when no onFail handler is defined.
    // applyQuestFail is a no-op when the quest stage lacks onFail/onFailDefault.
    const current = this.state.getState().activeQuests[questId];
    if (current && !current.isFailed) {
      this.state.failQuest(questId, { recordAsCompleted: !def.isRepeatable });
    }

    return true;
  }

  /**
   * 外部觸發任務階段失敗（由 EventOutcome.failQuestId、EncounterChoiceEffects.failQuestId
   * 或 failCondition 自動掃描觸發）。
   * 套用當前階段的 onFail 效果（若無則嘗試 onFailDefault）並根據 nextStageId 決定後續：
   *   nextStageId = null      → 任務完全失敗
   *   nextStageId = string    → 退回指定階段（可重試）
   *   nextStageId = undefined → 僅套用效果，停留在當前階段
   *
   * 回傳 { startEventId } 讓 GameController 決定是否直接觸發事件。
   * options.isAbandoned = true 時，代表由玩家主動放棄觸發（語意標記，供事件/log使用）。
   */
  applyQuestFail(questId: string, options?: { isAbandoned?: boolean }): { startEventId?: string } {
    const gs       = this.state.getState();
    const instance = gs.activeQuests[questId];
    if (!instance || instance.isCompleted || instance.isFailed) return {};

    const def   = this.lore.getQuest(questId);
    const stage = instance.currentStageId ? def?.stages[instance.currentStageId] : undefined;

    // Use stage's onFail, falling back to quest-level onFailDefault
    const failOutcome = stage?.onFail ?? def?.onFailDefault;

    if (failOutcome) {
      this.applyFailOutcome(failOutcome);

      if (failOutcome.nextStageId === null) {
        this.state.failQuest(questId, { recordAsCompleted: !def?.isRepeatable });
        if (def?.isRepeatable) {
          this.state.removeEndedQuest(questId);
        }
      } else if (typeof failOutcome.nextStageId === 'string') {
        this.state.advanceQuestStage(questId, failOutcome.nextStageId);
      }
      // undefined = stay at current stage; effects already applied

      return { startEventId: failOutcome.startEventId };
    }
    // No onFail or onFailDefault defined = silent, do nothing
    return {};
  }

  /**
   * 處理 DM <<QUEST>> 信號。
   * type 'flag'      → 設置任務本地旗標，觸發目標重新評估。
   * type 'objective' → 直接標記目標為已完成，觸發階段推進。
   */
  applyQuestSignal(questId: string, type: 'flag' | 'objective', value: string): void {
    const gs       = this.state.getState();
    const instance = gs.activeQuests[questId];
    if (!instance || instance.isCompleted || instance.isFailed) return;

    if (type === 'flag') {
      this.state.setQuestLocalFlag(questId, value);
      // 重新評估該任務的目標
      const def = this.lore.getQuest(questId);
      if (def) this.processStage(questId, this.state.getState().activeQuests[questId]!, def);
    } else if (type === 'objective') {
      this.state.completeObjective(questId, value);
      const def = this.lore.getQuest(questId);
      if (def) this.processStage(questId, this.state.getState().activeQuests[questId]!, def);
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
        const def = this.lore.getQuest(questId);
        this.state.failQuest(questId, { recordAsCompleted: !def?.isRepeatable });
        if (def?.isRepeatable) {
          this.state.removeEndedQuest(questId);
        }
      }
    }
  }

  // ── Internal ──────────────────────────────────────────────────

  private processStage(questId: string, instance: QuestInstance, def: QuestDefinition): void {
    const stage = def.stages[instance.currentStageId!];
    if (!stage) return;

    const gs = this.state.getState();

    // Determine which objectives to evaluate this pass
    let toEvaluate: QuestObjective[];
    if (stage.ordered) {
      // Only check the first uncompleted objective in sequence
      const next = stage.objectives.find(o => !instance.completedObjectiveIds.includes(o.id));
      toEvaluate = next ? [next] : [];
    } else {
      toEvaluate = stage.objectives.filter(o => !instance.completedObjectiveIds.includes(o.id));
    }

    for (const obj of toEvaluate) {
      if (this.evaluateObjective(obj, gs, instance)) {
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
        if (def.repeatCondition) {
          // 有條件的循環：完成後進入 completedQuestIds，等到條件成立再重新授予
          this.state.completeQuest(questId, def.rewards);
          // 從 activeQuests 移除，讓 checkPendingRepeats 在條件成立時可重新授予
          this.state.removeActiveQuest(questId);
        } else {
          // 無條件循環：立即重置
          this.state.resetQuest(questId, def.entryStageId);
        }
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
    if (outcome.affinityChanges) {
      for (const [nid, delta] of Object.entries(outcome.affinityChanges)) {
        if (delta !== undefined) this.state.modifyAffinity(nid, delta);
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
    if (outcome.grantQuestId) {
      this.grantQuest(outcome.grantQuestId);
    }
  }

  private applyFailOutcome(outcome: QuestStageFailOutcome): void {
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
    if (outcome.affinityChanges) {
      for (const [nid, delta] of Object.entries(outcome.affinityChanges)) {
        if (delta !== undefined) this.state.modifyAffinity(nid, delta);
      }
    }
  }

  private applyReputation(factionId: string, delta: number): void {
    this.state.modifyReputation(factionId, delta);
  }

  private evaluateObjective(obj: QuestObjective, gs: Readonly<GameState>, instance: QuestInstance): boolean {
    switch (obj.type) {
      case 'flag_check':
        return obj.flag ? this.state.flags.has(obj.flag) : false;

      case 'flag_expression':
        return obj.flagExpression ? this.state.flags.evaluate(obj.flagExpression) : false;

      case 'quest_flag':
        return obj.questFlag ? instance.localFlags.includes(obj.questFlag) : false;

      case 'location_visit':
        return obj.locationId ? gs.discoveredLocationIds.includes(obj.locationId) : false;

      case 'npc_talk':
        return obj.npcId ? !!gs.npcMemory[obj.npcId] : false;

      case 'item_collect':
        return obj.itemId ? gs.player.inventory.some(i => i.itemId === obj.itemId && !i.isExpired) : false;

      case 'reputation': {
        if (!obj.factionId || obj.minReputation === undefined) return false;
        const rep = gs.player.externalStats.reputation[obj.factionId] ?? 0;
        return rep >= obj.minReputation;
      }

      case 'encounter_completed': {
        if (!obj.encounterCompletedId) return false;
        const encId = obj.encounterCompletedId;
        if (!this.state.flags.has(`encounter_${encId}_completed`)) return false;
        if (obj.requiredOutcomeType) {
          return this.state.flags.has(`encounter_${encId}_${obj.requiredOutcomeType}`);
        }
        return true;
      }

      default:
        return false;
    }
  }
}
