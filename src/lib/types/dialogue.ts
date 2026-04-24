// Dialogue types.
//
// Two dialogue modes:
//   Scripted  — fixed nodes with player choices; bypasses DM entirely.
//               Triggered by first meeting, flag conditions, or probability rolls.
//   LLM       — DM generates freely using defaultContext + relationship history.
//               Fires when no scripted trigger matches.

import type { ItemRequirement } from './item';

// ── Attitude ──────────────────────────────────────────────────

/** Player attitude toward a specific NPC, updated by DM <<NPC>> signals. */
export type PlayerAttitude = 'friendly' | 'neutral' | 'cautious' | 'hostile';

// ── Scripted Dialogue ─────────────────────────────────────────

export interface ScriptedLine {
  /** Who speaks this line. */
  speaker: 'npc' | 'narrator' | 'player';
  text: string;
}

export interface ChoiceEffects {
  /** Delta applied to NPC affinity. */
  affinity?: number;
  /** Faction id → reputation delta. */
  reputation?: Record<string, number>;
  flagsSet?: string[];
  flagsUnset?: string[];
  /** Immediately override the stored player attitude for this NPC. */
  attitude?: PlayerAttitude;

  /**
   * Grant intel IDs to the player's knowledge.
   * Each id is added to knownIntelIds and can be checked via knowledgeIds conditions.
   */
  grantIntel?: string[];

  /** Accept a quest by questId (player does not need to manually accept). */
  grantQuest?: string;

  /** Advance a quest to a specific stage. */
  advanceQuestStage?: { questId: string; stageId: string };

  /** Mark a quest objective as completed. */
  completeObjective?: { questId: string; objectiveId: string };
}

/**
 * Post-condition branch: evaluated after a choice is selected.
 * Evaluated in array order — first matching condition routes to its nodeId.
 * Falls back to the choice's `nextNodeId` if none match.
 * Supports flag expressions; use knowledgeIds conditions to check player intel.
 */
export interface ChoiceBranch {
  condition: string;
  nodeId: string;
}

export interface ScriptedChoice {
  id: string;
  /** Text shown on the choice button (what the player says / does). */
  text: string;

  /**
   * Fallback destination node, or null to end the dialogue.
   * If `branches` is defined, this is only used when no branch condition matches.
   */
  nextNodeId: string | null;

  /**
   * Post-condition branching. Evaluated after effects are applied.
   * First branch whose condition is true wins. Falls back to nextNodeId.
   */
  branches?: ChoiceBranch[];

  /**
   * Lines to display before showing the target node's choices.
   * When set, the target node's own `lines` are SKIPPED — only its choices are shown.
   * Use this for returning to a previous node without repeating its setup text.
   *
   * Example: returning to kach_intro_follow_up after exploring push_forest,
   * showing a short transition instead of repeating the full opening.
   */
  transitionLines?: ScriptedLine[];

  /**
   * Pre-condition: flag expression — choice is hidden if this evaluates false.
   * Supports all FlagSystem operators: &, |, !
   */
  condition?: string;

  /**
   * Pre-condition: all listed intel IDs must be in player's knownIntelIds.
   * Choice is hidden if any are missing.
   */
  knowledgeIds?: string[];

  /**
   * Pre-condition: player must hold ALL listed items (AND).
   * Choice is hidden if any item is missing or expired.
   * Example: 需要特定象限移動許可、任務道具等 key item。
   */
  itemRequirements?: ItemRequirement[];

  /**
   * Pre-condition: player must hold at least this many Melphin.
   * Choice is hidden if player's melphin < minMelphin.
   */
  minMelphin?: number;

  /**
   * Pre-condition: advanced date-time conditions (array is OR — any one passing shows the choice).
   * Supports before / after / between with year/month/day/hour/minute fields (all optional, default 0).
   * Choice is hidden if none of the conditions match the current game time.
   */
  dateTimeConditions?: import('./world').GameDateTimeCondition[];

  /**
   * Pre-condition: faction reputation minimums (AND).
   * key = factionId, value = minimum reputation required.
   * Choice is hidden if any faction reputation falls short.
   */
  minReputation?: Record<string, number>;

  /**
   * Pre-condition: faction reputation maximums (AND).
   * key = factionId, value = maximum reputation allowed.
   */
  maxReputation?: Record<string, number>;

  /**
   * Pre-condition: NPC affinity minimums (AND).
   * key = npcId, value = minimum affinity required.
   */
  minAffinity?: Record<string, number>;

  /**
   * Pre-condition: NPC affinity maximums (AND).
   * key = npcId, value = maximum affinity allowed.
   */
  maxAffinity?: Record<string, number>;

  effects?: ChoiceEffects;
}

export interface ScriptedNode {
  lines: ScriptedLine[];
  /**
   * Choices offered after lines play.
   * Empty array = auto-end the scripted dialogue after lines are displayed.
   */
  choices: ScriptedChoice[];
}

// ── Triggers ──────────────────────────────────────────────────

/**
 * A trigger defines when a scripted node fires instead of LLM dialogue.
 * All specified conditions must pass for the trigger to activate.
 * Triggers are evaluated in array order; the first match wins.
 */
export interface DialogueTrigger {
  /** Node to start when this trigger fires. */
  nodeId: string;
  /** Only fires on the very first interaction (interactionCount === 0). */
  firstMeetingOnly?: boolean;
  /** Flag expression — must evaluate true. */
  condition?: string;
  /**
   * Probability roll (0–100). Default: 100 (always fires if other conditions pass).
   * Rolled after flag conditions are confirmed.
   */
  probability?: number;
}

// ── Context Snippets ──────────────────────────────────────────

/**
 * A context snippet injects extra DM guidance when its condition is met.
 * Condition supports flag expressions and `intel:<id>` syntax:
 *   "crambell_elowan_trusted"          — flag is set
 *   "intel:kach_treffen_member"        — player holds this intel
 *   "intel:kach_treffen_member & ..."  — combined
 * Use intel: for knowledge the player gained about the NPC (secret layers, hidden identity, etc.).
 * Use flags for world-state changes (relationship shifts, events, etc.).
 */
export interface ContextSnippet {
  /** Optional design note — not injected into prompts. */
  label?: string;
  /** Condition expression; snippet is active when true. */
  condition: string;
  /**
   * Context text injected into DM prompt when active.
   * Should describe what the NPC knows/feels/plans in this situation.
   */
  context: string;
}

// ── Profile ───────────────────────────────────────────────────

/**
 * Full dialogue profile for one NPC.
 * Stored at lore/.../dialogues/<dialogueId>.json.
 */
export interface DialogueProfile {
  id: string;
  npcId: string;

  /**
   * LLM context for free-form dialogue (injected when no scripted trigger fires).
   * Focus on: speech patterns, tone, vocabulary, topics the NPC will/won't discuss,
   * and typical disposition toward repeat visitors.
   * Do NOT repeat personality — that is in the NPC's publicDescription / secretLayers.
   */
  defaultContext: string;

  /**
   * Scripted dialogue nodes keyed by node ID.
   * Each node contains lines (displayed directly) and choices (shown as buttons).
   */
  nodes: Record<string, ScriptedNode>;

  /**
   * Ordered list of scripted triggers.
   * First trigger whose conditions all pass fires; remaining triggers are skipped.
   */
  triggers: DialogueTrigger[];

  /**
   * Conditional context snippets injected into the DM prompt for LLM-mode dialogue.
   * Each snippet is active when its condition evaluates true.
   * Supports flag expressions and `intel:<id>` syntax.
   */
  contextSnippets?: ContextSnippet[];
}
