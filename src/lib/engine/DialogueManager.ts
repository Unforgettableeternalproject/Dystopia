// DialogueManager — builds NPC dialogue context for DM injection and processes DM signals.
//
// DM signal formats (appended at end of narrative, stripped before display):
//   <<FLAGS: +flag_a, -flag_b>>        (handled by FlagRegistry)
//   <<NPC: npc_id | topic: ... | attitude: neutral>>
//   <<MILESTONE: milestone_id>>
//
// Signals are independent lines; multiple can appear in one response.

import type { LoreVault }          from '../lore/LoreVault';
import type { StateManager }       from './StateManager';
import type { GameState }          from '../types';
import type { PlayerAttitude }     from '../types/dialogue';
import type { FlagSystem }         from './FlagSystem';

const NPC_SIGNAL_PATTERN      = /<<NPC:\s*([^|>>]+)\|([^>>]+)>>/gi;
const MILESTONE_SIGNAL_PATTERN = /<<MILESTONE:\s*([^>>]+)>>/gi;

export interface ParsedDialogueSignals {
  npcUpdates:  Array<{ npcId: string; topic?: string; attitude?: PlayerAttitude }>;
  milestones:  Array<{ milestoneId: string }>;
  /** Narrative with all dialogue signals stripped. */
  cleanNarrative: string;
}

export class DialogueManager {
  constructor(
    private lore:  LoreVault,
    private state: StateManager,
  ) {}

  // ── Context Builder ───────────────────────────────────────────

  /**
   * Build the full dialogue context block for an NPC interaction.
   * Injected into the DM scene context when the player is interacting with this NPC.
   */
  buildNPCDialogueContext(npcId: string, dialogueId: string, flags: FlagSystem): string {
    const profile = this.lore.getDialogueProfile(npcId, dialogueId);
    if (!profile) return '';

    const memory = this.state.getState().npcMemory[npcId];
    const gs     = this.state.getState();

    const parts: string[] = [`### Dialogue: ${npcId}`];

    // ── Relationship status ───────────────────────────────────
    if (!memory || memory.interactionCount === 0) {
      parts.push('**First meeting** — use initialContext below.');
    } else {
      parts.push(`Interactions: ${memory.interactionCount} | Attitude: ${memory.playerAttitude}`);
      if (memory.lastTopic) {
        parts.push(`Last topic: ${memory.lastTopic}`);
      }
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

    // ── Permanent milestone memory ────────────────────────────
    if (memory && memory.permanentMilestoneIds.length > 0) {
      parts.push('**NPC permanent memory** (always remembered):');
      for (const msId of memory.permanentMilestoneIds) {
        const ms = profile.milestones.find(m => m.id === msId);
        if (ms?.permanentSummary) parts.push(`  - ${ms.permanentSummary}`);
      }
    }

    // ── Active milestone contexts ─────────────────────────────
    const activeMilestones = profile.milestones.filter(ms => {
      if (memory?.permanentMilestoneIds.includes(ms.id)) return false; // already permanent
      return flags.evaluate(ms.condition);
    });
    if (activeMilestones.length > 0) {
      parts.push('**Current situation context:**');
      for (const ms of activeMilestones) {
        parts.push(ms.context);
        if (ms.isPermanent) {
          parts.push(`(Signal <<MILESTONE: ${ms.id}>> if this exchange is concluded.)`);
        }
      }
    }

    // ── Base contexts ─────────────────────────────────────────
    if (!memory || memory.interactionCount === 0) {
      parts.push('**Initial context:**');
      parts.push(profile.initialContext);
    }
    parts.push('**General character context:**');
    parts.push(profile.defaultContext);

    // ── Signal reminder ───────────────────────────────────────
    parts.push(
      '(After narrating this interaction, signal: ' +
      `<<NPC: ${npcId} | topic: <one-line summary> | attitude: neutral/friendly/cautious/hostile>>)`
    );

    return parts.join('\n');
  }

  /**
   * Build brief NPC status for all NPCs present in scene
   * (shown even without explicit interaction, for DM awareness).
   */
  buildSceneNPCStatus(npcIds: string[]): string {
    if (npcIds.length === 0) return '';
    const gs = this.state.getState();
    const lines = npcIds
      .map(id => {
        const mem = gs.npcMemory[id];
        if (!mem) return `  ${id}: [首次相遇]`;
        return `  ${id}: ${mem.interactionCount}次互動 | 態度: ${mem.playerAttitude}${mem.lastTopic ? ` | 上次: ${mem.lastTopic}` : ''}`;
      });
    if (lines.length === 0) return '';
    return '### NPC Relationship Status\n' + lines.join('\n');
  }

  // ── Signal Parsing ────────────────────────────────────────────

  /**
   * Parse NPC and milestone signals from DM narrative.
   * Called after DM streaming completes.
   */
  parseSignals(narrative: string): ParsedDialogueSignals {
    const npcUpdates: ParsedDialogueSignals['npcUpdates']   = [];
    const milestones: ParsedDialogueSignals['milestones']   = [];
    let   clean = narrative;

    // <<NPC: npc_id | topic: xxx | attitude: yyy>>
    for (const match of narrative.matchAll(NPC_SIGNAL_PATTERN)) {
      const npcId    = match[1].trim();
      const kvString = match[2];
      const topic    = this.extractKV(kvString, 'topic');
      const rawAtt   = this.extractKV(kvString, 'attitude');
      const attitude = this.parseAttitude(rawAtt);
      npcUpdates.push({ npcId, topic: topic ?? undefined, attitude });
    }
    clean = clean.replace(NPC_SIGNAL_PATTERN, '');

    // <<MILESTONE: milestone_id>>
    for (const match of narrative.matchAll(MILESTONE_SIGNAL_PATTERN)) {
      milestones.push({ milestoneId: match[1].trim() });
    }
    clean = clean.replace(MILESTONE_SIGNAL_PATTERN, '');

    clean = clean.replace(/\n{3,}/g, '\n\n').trimEnd();
    return { npcUpdates, milestones, cleanNarrative: clean };
  }

  // ── Apply Signals ─────────────────────────────────────────────

  /**
   * Apply parsed dialogue signals to StateManager.
   * Called by GameController after parsing DM output.
   */
  applySignals(signals: ParsedDialogueSignals, activeNpcIds: string[]): void {
    for (const { npcId, topic, attitude } of signals.npcUpdates) {
      // Only apply updates for NPCs actually in the scene
      if (!activeNpcIds.includes(npcId)) continue;
      this.state.recordNPCInteraction(npcId);
      this.state.updateNPCDialogueState(npcId, topic, attitude);
    }

    for (const { milestoneId } of signals.milestones) {
      // Find which NPC owns this milestone
      const npcId = this.findMilestoneOwner(milestoneId);
      if (npcId) {
        this.state.recordPermanentMilestone(npcId, milestoneId);
      }
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

  private findMilestoneOwner(milestoneId: string): string | null {
    const gs = this.state.getState();
    // Check NPCs the player has interacted with — search their profiles
    for (const npcId of Object.keys(gs.npcMemory)) {
      const npc = this.lore.getNPC(npcId);
      if (!npc) continue;
      const profile = this.lore.getDialogueProfile(npcId, npc.dialogueId);
      if (profile?.milestones.some(m => m.id === milestoneId)) return npcId;
    }
    return null;
  }
}
