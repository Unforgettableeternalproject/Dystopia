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
   *   1. Initial quest → join faction (derived from coupling) + credit bonus
   *   2. Credit reward for non-initial quests (weighted by coupling)
   *   3. Checkpoint advancement check
   *
   * Faction affiliation is inferred from coupling values, not factionId.
   * The faction with the highest coupling is the "primary faction" for join purposes.
   */
  onQuestComplete(questId: string): void {
    const def = this.lore.getQuest(questId);
    if (!def) return;

    // Collect all coupled factions
    const coupledFactions = this.getCoupledFactions(def);
    if (coupledFactions.length === 0) return; // general quest, no faction interaction

    // 1. Initial quest → join the primary faction (highest coupling) + credit bonus
    if (def.questCategory === 'initial') {
      const primaryFactionId = coupledFactions[0].factionId; // sorted by coupling desc
      this.initFactionRelation(primaryFactionId);
      const faction = this.lore.getFactionDefinition(primaryFactionId);
      if (faction?.credit) {
        this.state.modifyCredit(primaryFactionId, faction.credit.initialQuestBonus, {
          negativeLimit: faction.credit.negativeLimit,
          positiveLimit: faction.credit.positiveLimit,
        });
      }
      this.state.updateFactionRelation(primaryFactionId, { isJoined: true });
    }

    // 2. Credit reward for completed quest (weighted by coupling)
    if (def.questCategory !== 'initial') {
      for (const { factionId, coupling } of coupledFactions) {
        const faction = this.lore.getFactionDefinition(factionId);
        if (!faction?.credit) continue;
        const relation = this.state.getFactionRelation(factionId);
        if (!relation) continue;
        // Base credit reward scaled by coupling
        const baseReward = 5; // TODO: make configurable per quest/faction
        this.state.modifyCredit(factionId, baseReward * coupling, {
          negativeLimit: faction.credit.negativeLimit,
          positiveLimit: faction.credit.positiveLimit,
        });
      }
    }

    // 3. Check checkpoint advancement for all coupled factions
    for (const { factionId } of coupledFactions) {
      this.checkCheckpointAdvancement(factionId, questId);
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
   * Returns false if the player has hit the credit breakpoint for any coupled faction.
   * Non-faction quests and 'general' category quests are always available.
   * Uses coupling to determine faction affiliation (not factionId).
   */
  isEpicQuestAvailable(questId: string): boolean {
    const def = this.lore.getQuest(questId);
    if (!def) return true;
    if (def.questCategory === 'general') return true;

    const coupledFactions = this.getCoupledFactions(def);
    if (coupledFactions.length === 0) return true; // No coupling = always available

    // Check the primary faction (highest coupling) for breakpoint
    const primaryFactionId = coupledFactions[0].factionId;
    const relation = this.state.getFactionRelation(primaryFactionId);
    if (!relation) return true; // No relation yet = available

    return !relation.creditBreakpointHit;
  }

  // ── Internal ────────────────────────────────────────────────────

  /**
   * Derive faction affiliations from a quest's coupling values.
   * Returns factions sorted by coupling descending (highest = primary).
   * Falls back to factionId if no coupling is defined.
   */
  private getCoupledFactions(
    def: { coupling?: Record<string, number>; factionId?: string },
  ): { factionId: string; coupling: number }[] {
    const result: { factionId: string; coupling: number }[] = [];

    if (def.coupling) {
      for (const [fid, val] of Object.entries(def.coupling)) {
        if (val > 0) result.push({ factionId: fid, coupling: val });
      }
    }

    // Fallback: use legacy factionId if no coupling defined
    if (result.length === 0 && def.factionId) {
      result.push({ factionId: def.factionId, coupling: 1.0 });
    }

    // Sort by coupling descending — first element is "primary faction"
    result.sort((a, b) => b.coupling - a.coupling);
    return result;
  }

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
