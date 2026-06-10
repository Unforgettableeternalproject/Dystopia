// FactionTreeEngine — manages the Faction Tree system.
//
// Standalone engine, independent of GameController.
// Injected into QuestEngine for quest completion/ditch hooks.
//
// Responsibilities:
//   - Track faction relations (join, checkpoints, credit, breakpoint)
//   - Apply credit changes on quest ditch (coupling-weighted penalty)
//   - Advance checkpoints on quest completion
//   - Guard epic quest availability (breakpoint protection)
//
// Design ref: PM note「陣營樹系統設計（核心架構決策 2026-06-10）」
// Credit ref: PM note「陣營樹 — 信用計算規則與數值設計（2026-06-10 確認）」

import type { LoreVault } from '../lore/LoreVault';
import type { StateManager } from './StateManager';
import type { FactionDefinition, CreditConfig } from '../types/faction';
import type { FactionRelationState } from '../types/game';

export class FactionTreeEngine {
  constructor(
    private lore:  LoreVault,
    private state: StateManager,
  ) {}

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Initialize faction relation when player first contacts a faction.
   * Safe to call multiple times — no-op if already initialized.
   * Called by QuestEngine when a faction quest is granted,
   * or by StateManager.contactFaction for early initialization.
   */
  initFactionRelation(factionId: string): void {
    if (this.state.getFactionRelation(factionId)) return;

    const faction = this.lore.getFactionDefinition(factionId);

    // Initialize credit if faction has credit config
    if (faction?.credit) {
      const initialVal = faction.credit.initialValue ?? 0;
      if (initialVal !== 0) {
        this.state.modifyCredit(factionId, initialVal, {
          negativeLimit: faction.credit.negativeLimit,
          positiveLimit: faction.credit.positiveLimit,
        });
      }
    }

    this.state.initFactionRelation(factionId, {
      isJoined: false,
      completedCheckpointIds: [],
      creditBreakpointHit: false,
    });
  }

  /**
   * Called when a quest completes successfully.
   * Handles:
   *   1. Initial quest → join faction + credit bonus
   *   2. Checkpoint advancement check
   */
  onQuestComplete(questId: string): void {
    const def = this.lore.getQuest(questId);
    if (!def) return;

    // 1. Initial quest → join faction + credit bonus
    if (def.questCategory === 'initial' && def.factionId) {
      this.initFactionRelation(def.factionId);
      const faction = this.lore.getFactionDefinition(def.factionId);
      if (faction?.credit) {
        this.state.modifyCredit(def.factionId, faction.credit.initialQuestBonus, {
          negativeLimit: faction.credit.negativeLimit,
          positiveLimit: faction.credit.positiveLimit,
        });
      }
      this.state.updateFactionRelation(def.factionId, { isJoined: true });
    }

    // 2. Check checkpoint advancement for all factions this quest is coupled to
    const factionIds = new Set<string>();
    if (def.factionId) factionIds.add(def.factionId);
    if (def.coupling) {
      for (const fid of Object.keys(def.coupling)) factionIds.add(fid);
    }

    for (const fid of factionIds) {
      this.checkCheckpointAdvancement(fid, questId);
    }
  }

  /**
   * Called when a quest is ditched (betrayed/abandoned).
   * Applies coupling-weighted credit penalty.
   *
   * Ditch penalty formula:
   *   distance = |currentCredit - negativeLimit|
   *   basePenalty = distance × (ditchPenaltyPercent / 100)
   *   weightedPenalty = basePenalty × couplingValue
   *   newCredit = currentCredit - weightedPenalty
   */
  onQuestDitch(questId: string): void {
    const def = this.lore.getQuest(questId);
    if (!def || !def.coupling) return;

    for (const [factionId, couplingValue] of Object.entries(def.coupling)) {
      if (couplingValue <= 0) continue;

      const faction = this.lore.getFactionDefinition(factionId);
      if (!faction?.credit) continue;

      this.initFactionRelation(factionId);

      const currentCredit =
        this.state.getState().player.externalStats.credit?.[factionId] ?? 0;
      const distance = Math.abs(currentCredit - faction.credit.negativeLimit);
      const basePenalty = distance * (faction.credit.ditchPenaltyPercent / 100);
      const weightedPenalty = basePenalty * couplingValue;

      this.state.modifyCredit(factionId, -weightedPenalty, {
        negativeLimit: faction.credit.negativeLimit,
        positiveLimit: faction.credit.positiveLimit,
      });

      this.checkBreakpoint(factionId, faction.credit);
    }
  }

  /**
   * Check if a faction quest can be granted.
   * Returns false if the player has hit the credit breakpoint for that faction.
   * Non-faction quests and 'general' category quests are always available.
   */
  isEpicQuestAvailable(questId: string): boolean {
    const def = this.lore.getQuest(questId);
    if (!def || !def.factionId) return true;
    if (def.questCategory === 'general') return true;

    const relation = this.state.getFactionRelation(def.factionId);
    if (!relation) return true; // No relation yet = available

    return !relation.creditBreakpointHit;
  }

  // ── Internal ────────────────────────────────────────────────────

  /**
   * Check if completing a quest advances any checkpoint for a faction.
   * Iterates through all checkpoints in order and advances any that are newly satisfied.
   */
  private checkCheckpointAdvancement(factionId: string, completedQuestId: string): void {
    const faction = this.lore.getFactionDefinition(factionId);
    if (!faction?.epic) return;

    const relation = this.state.getFactionRelation(factionId);
    if (!relation) return;

    const sortedCheckpoints = [...faction.epic.checkpoints].sort(
      (a, b) => a.order - b.order,
    );

    let advanced = false;

    for (const checkpoint of sortedCheckpoints) {
      if (relation.completedCheckpointIds.includes(checkpoint.id)) continue;

      const questMatches = checkpoint.requiredQuestIds?.includes(completedQuestId) ?? false;
      const flagMatches = checkpoint.requiredFlagExpression
        ? this.state.flags.evaluate(checkpoint.requiredFlagExpression)
        : false;

      if (questMatches || flagMatches) {
        // Advance checkpoint
        const newIds = [...relation.completedCheckpointIds, checkpoint.id];
        this.state.updateFactionRelation(factionId, {
          completedCheckpointIds: newIds,
        });

        // Apply checkpoint effects
        checkpoint.flagsSet?.forEach(f => this.state.flags.set(f));

        advanced = true;
      }
    }

    // Check if all checkpoints are done (epic completion)
    if (advanced && faction.epic.completionFlags?.length) {
      const updatedRelation = this.state.getFactionRelation(factionId);
      if (updatedRelation) {
        const allDone = sortedCheckpoints.every(cp =>
          updatedRelation.completedCheckpointIds.includes(cp.id),
        );
        if (allDone) {
          faction.epic.completionFlags.forEach(f => this.state.flags.set(f));
        }
      }
    }
  }

  /**
   * Check if credit has fallen to or below the breakpoint.
   * If so, set creditBreakpointHit and a global flag.
   */
  private checkBreakpoint(factionId: string, credit: CreditConfig): void {
    const relation = this.state.getFactionRelation(factionId);
    if (!relation || relation.creditBreakpointHit) return;

    const currentCredit =
      this.state.getState().player.externalStats.credit?.[factionId] ?? 0;
    const breakpointValue =
      credit.negativeLimit +
      Math.abs(credit.negativeLimit) * (credit.breakpointPercent / 100);

    if (currentCredit <= breakpointValue) {
      this.state.updateFactionRelation(factionId, { creditBreakpointHit: true });
      this.state.flags.set(`faction_breakpoint_${factionId}`);
    }
  }
}
