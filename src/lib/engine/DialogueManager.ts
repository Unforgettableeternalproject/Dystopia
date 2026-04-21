// DialogueManager — scripted dialogue tree + DM context builder.
//
// Two modes:
//   Scripted  — checkScriptedTrigger() fires when trigger conditions pass.
//               Lines displayed directly; DM is bypassed.
//               Choice effects applied via applyChoiceEffects().
//   LLM       — buildNPCDialogueContext() injects profile into DM prompt.
//               Fires when no scripted trigger matches.
//
// DM signal formats valid inside a dialogue encounter:
//   <<FLAGS: +flag_a, -flag_b>>        (handled by FlagRegistry)
//   <<NPC_STATE: attitude:neutral | topic: ...>>
//   <<QUEST: questId | objective:id>>
//   <<END_ENCOUNTER>>                  (DM closes the dialogue naturally)
//
// Signals NOT available inside encounters: <<ENCOUNTER>>, <<MOVE>>

import type { LoreVault }         from '../lore/LoreVault';
import type { StateManager }      from './StateManager';
import type { PlayerAttitude, ScriptedNode, ScriptedChoice, ChoiceEffects } from '../types/dialogue';
import type { FlagSystem }        from './FlagSystem';
import type { InventoryItem }     from '../types/item';

// <<NPC_STATE: attitude:neutral | topic:...>> — updates NPC state within a dialogue encounter.
// npcId is NOT in the signal; it's supplied by the calling context.
const NPC_STATE_SIGNAL_PATTERN     = /<<NPC_STATE:\s*([^>>]+)>>/gi;
const QUEST_SIGNAL_PATTERN         = /<<QUEST:\s*([^|>>]+)\|([^>>]+)>>/gi;
const END_ENCOUNTER_SIGNAL_PATTERN = /<<END_ENCOUNTER>>/gi;

export interface ParsedDialogueSignals {
  /** NPC state update from <<NPC_STATE: ...>>. Applied to the NPC supplied by calling context. */
  npcStateUpdate?: { topic?: string; attitude?: PlayerAttitude };
  questSignals:    Array<{ questId: string; type: 'flag' | 'objective'; value: string }>;
  /** True if DM signaled the dialogue encounter should end naturally. */
  endEncounter:    boolean;
  cleanNarrative:  string;
}

/** Result of a scripted trigger check. */
export interface ScriptedTriggerResult {
  nodeId: string;
  node:   ScriptedNode;
}

export class DialogueManager {
  constructor(
    private lore:  LoreVault,
    private state: StateManager,
  ) {}

  // ── Scripted Dialogue ─────────────────────────────────────────

  /**
   * Check whether any scripted trigger fires for this NPC interaction.
   * Returns the matched node, or null to fall through to LLM dialogue.
   * Triggers are evaluated in array order; first match wins.
   */
  checkScriptedTrigger(
    npcId:            string,
    dialogueId:       string,
    flags:            FlagSystem,
    interactionCount: number,
  ): ScriptedTriggerResult | null {
    const profile = this.lore.getDialogueProfile(npcId, dialogueId);
    if (!profile || !profile.triggers?.length) return null;

    for (const trigger of profile.triggers) {
      // firstMeetingOnly check
      if (trigger.firstMeetingOnly && interactionCount !== 0) continue;

      // Flag condition check
      if (trigger.condition && !flags.evaluate(trigger.condition)) continue;

      // Probability roll (0–100, default 100 = always)
      const prob = trigger.probability ?? 100;
      if (prob < 100 && Math.random() * 100 > prob) continue;

      // All conditions passed — find the node
      const node = profile.nodes?.[trigger.nodeId];
      if (!node) continue;

      return { nodeId: trigger.nodeId, node };
    }
    return null;
  }

  /**
   * Filter a node's choices by pre-conditions:
   *   - `condition`        : flag expression must be true
   *   - `knowledgeRequired`: all listed intel IDs must be in player's knownIntelIds
   *   - `itemRequired`     : all listed items must be held and not expired (AND)
   *   - `minMelphin`       : player's melphin must be >= this value
   */
  filterChoices(choices: ScriptedChoice[], flags: FlagSystem): ScriptedChoice[] {
    const player = this.state.getState().player;
    const known: string[]        = player.knownIntelIds;
    const inventory: InventoryItem[] = player.inventory ?? [];
    const melphin: number        = player.melphin ?? 0;

    return choices.filter(c => {
      if (c.condition && !flags.evaluate(c.condition)) return false;
      if (c.knowledgeRequired?.some(id => !known.includes(id))) return false;
      if (c.itemRequired?.some(req =>
        !inventory.some(i =>
          i.itemId === req.itemId &&
          !i.isExpired &&
          (req.variantId === undefined || i.variantId === req.variantId)
        )
      )) return false;
      if (c.minMelphin !== undefined && melphin < c.minMelphin) return false;
      return true;
    });
  }

  /**
   * Retrieve a scripted node by ID from a dialogue profile.
   * Returns null if the profile or node doesn't exist.
   */
  getNode(npcId: string, dialogueId: string, nodeId: string): ScriptedNode | null {
    const profile = this.lore.getDialogueProfile(npcId, dialogueId);
    return profile?.nodes?.[nodeId] ?? null;
  }

  /**
   * Apply the effects of a chosen scripted choice to game state.
   * Handles: affinity, faction reputation, flag mutations, attitude override.
   */
  applyChoiceEffects(npcId: string, effects: ChoiceEffects | undefined): void {
    if (!effects) return;

    if (effects.affinity !== undefined) {
      this.state.modifyAffinity(npcId, effects.affinity);
    }

    if (effects.reputation) {
      for (const [factionId, delta] of Object.entries(effects.reputation)) {
        this.state.modifyReputation(factionId, delta);
      }
    }

    if (effects.flagsSet) {
      for (const flag of effects.flagsSet) this.state.flags.set(flag);
    }
    if (effects.flagsUnset) {
      for (const flag of effects.flagsUnset) this.state.flags.unset(flag);
    }

    if (effects.attitude) {
      this.state.updateNPCDialogueState(npcId, undefined, effects.attitude);
    }

    if (effects.grantIntel) {
      for (const intelId of effects.grantIntel) this.state.grantIntel(intelId);
    }
  }

  // ── LLM Context Builder ───────────────────────────────────────

  /**
   * Build the DM context block for LLM-mode NPC dialogue.
   * Injected into the scene context when no scripted trigger fires.
   */
  buildNPCDialogueContext(npcId: string, dialogueId: string, flags: FlagSystem): string {
    const profile = this.lore.getDialogueProfile(npcId, dialogueId);
    if (!profile) return '';

    const memory = this.state.getState().npcMemory[npcId];
    const gs     = this.state.getState();
    const parts: string[] = [`### Dialogue: ${npcId}`];

    // ── Relationship status ───────────────────────────────────
    if (!memory || memory.interactionCount === 0) {
      parts.push('**First meeting.**');
    } else {
      parts.push(`Interactions: ${memory.interactionCount} | Attitude: ${memory.playerAttitude}`);
      if (memory.lastTopic) parts.push(`Last topic: ${memory.lastTopic}`);
    }

    // ── Reputation and affinity ───────────────────────────────
    const npc     = this.lore.getNPC(npcId);
    const faction = npc?.factionId;
    const rep     = faction ? (gs.player.externalStats.reputation[faction] ?? 0) : null;
    const aff     = gs.player.externalStats.affinity[npcId] ?? 0;
    const statLine = [
      rep !== null ? `Faction standing (${faction}): ${rep}` : '',
      `Affinity: ${aff}`,
    ].filter(Boolean).join(' | ');
    if (statLine) parts.push(statLine);

    // ── Active context snippets ───────────────────────────────
    // Snippets whose condition evaluates true (supports flag and intel: expressions)
    const activeSnippets = (profile.contextSnippets ?? []).filter(s => flags.evaluate(s.condition));
    if (activeSnippets.length > 0) {
      parts.push('**Current situation context:**');
      for (const s of activeSnippets) parts.push(s.context);
    }

    // ── Speech style context ──────────────────────────────────
    parts.push('**Speech style / dialogue context:**');
    parts.push(profile.defaultContext);

    return parts.join('\n');
  }

  /**
   * Build brief NPC relationship status for all NPCs in the current scene.
   * Always injected into the DM scene context for ambient awareness.
   */
  buildSceneNPCStatus(npcIds: string[]): string {
    if (npcIds.length === 0) return '';
    const gs = this.state.getState();
    const lines = npcIds.map(id => {
      const mem = gs.npcMemory[id];
      if (!mem) return `  ${id}: [首次相遇]`;
      return `  ${id}: ${mem.interactionCount}次互動 | 態度: ${mem.playerAttitude}${mem.lastTopic ? ` | 上次: ${mem.lastTopic}` : ''}`;
    });
    return '### NPC Relationship Status\n' + lines.join('\n');
  }

  // ── Signal Parsing (LLM mode) ─────────────────────────────────

  parseSignals(narrative: string): ParsedDialogueSignals {
    const questSignals: ParsedDialogueSignals['questSignals'] = [];
    let   clean = narrative;
    let   npcStateUpdate: ParsedDialogueSignals['npcStateUpdate'];

    // NPC_STATE signal — only the last occurrence wins (DM may emit multiple in one turn)
    for (const match of narrative.matchAll(NPC_STATE_SIGNAL_PATTERN)) {
      const kvString = match[1];
      const topic    = this.extractKV(kvString, 'topic');
      const rawAtt   = this.extractKV(kvString, 'attitude');
      const attitude = this.parseAttitude(rawAtt);
      npcStateUpdate = { topic: topic ?? undefined, attitude };
    }
    clean = clean.replace(NPC_STATE_SIGNAL_PATTERN, '');

    for (const match of narrative.matchAll(QUEST_SIGNAL_PATTERN)) {
      const questId  = match[1].trim();
      const kvString = match[2];
      const flag     = this.extractKV(kvString, 'flag');
      const obj      = this.extractKV(kvString, 'objective');
      if (flag)      questSignals.push({ questId, type: 'flag',      value: flag.trim() });
      else if (obj)  questSignals.push({ questId, type: 'objective', value: obj.trim() });
    }
    clean = clean.replace(QUEST_SIGNAL_PATTERN, '');

    // END_ENCOUNTER signal
    const endEncounter = END_ENCOUNTER_SIGNAL_PATTERN.test(clean);
    clean = clean.replace(END_ENCOUNTER_SIGNAL_PATTERN, '');

    clean = clean.replace(/\n{3,}/g, '\n\n').trimEnd();
    return { npcStateUpdate, questSignals, endEncounter, cleanNarrative: clean };
  }

  /**
   * Apply dialogue signals to state.
   * npcId must be supplied by the calling context (it is NOT in the signal).
   */
  applySignals(signals: ParsedDialogueSignals, npcId: string): void {
    if (signals.npcStateUpdate) {
      this.state.recordNPCInteraction(npcId);
      this.state.updateNPCDialogueState(npcId, signals.npcStateUpdate.topic, signals.npcStateUpdate.attitude);
    }
  }

  // ── Internal ──────────────────────────────────────────────────

  private extractKV(kv: string, key: string): string | null {
    const match = kv.match(new RegExp(key + '\\s*:\\s*([^|]+)', 'i'));
    return match ? match[1].trim() : null;
  }

  private parseAttitude(raw: string | null): PlayerAttitude | undefined {
    if (!raw) return undefined;
    const valid: PlayerAttitude[] = ['friendly', 'neutral', 'cautious', 'hostile'];
    const lower = raw.toLowerCase().trim();
    return valid.includes(lower as PlayerAttitude) ? (lower as PlayerAttitude) : undefined;
  }
}
