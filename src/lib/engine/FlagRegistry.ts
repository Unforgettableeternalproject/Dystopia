// FlagRegistry — proximity-filtered flag manifest for DM context injection.
//
// The DM never sees all game flags at once. Instead, only the flags that are
// currently actionable (based on location, active quests, existing flags, and
// time period) are injected into the scene context.
//
// Signal format:
//   DM embeds flag changes at the END of its narration:
//   <<FLAGS: +flag_a, -flag_b>>
//   GameController strips this line before displaying to the player.

import type { FlagManifestEntry, TimePeriod } from '../types/world';
import type { FlagSystem } from './FlagSystem';

export interface ProximityContext {
  locationId: string;
  districtId?: string;
  regionId: string;
  activeQuestIds: string[];
  flags: FlagSystem;
  timePeriod: TimePeriod;
}

/** Parsed flag signal from DM output. */
export interface FlagSignal {
  flagId: string;
  action: 'set' | 'unset';
}

const FLAG_SIGNAL_PATTERN = /<<FLAGS:\s*([^>>]+)>>/i;

export class FlagRegistry {
  private entries: FlagManifestEntry[] = [];

  load(entries: FlagManifestEntry[]): void {
    this.entries.push(...entries);
  }

  clear(): void {
    this.entries = [];
  }

  // ── Query ─────────────────────────────────────────────────────

  /**
   * Return all manifest entries relevant to the given proximity context.
   * Already-set flags that have no unsetCondition are excluded (nothing to do).
   */
  getRelevantEntries(ctx: ProximityContext): FlagManifestEntry[] {
    return this.entries.filter(e => {
      // If flag is already set and has no unset condition, skip
      if (!e.unsetCondition && ctx.flags.has(e.flagId)) return false;
      return this.matchesProximity(e, ctx);
    });
  }

  // ── DM Context Builder ────────────────────────────────────────

  /**
   * Build the "Flag Actions Available" section for the DM system prompt.
   * Returns empty string if no relevant flags.
   */
  buildDMContext(ctx: ProximityContext): string {
    const relevant = this.getRelevantEntries(ctx);
    if (relevant.length === 0) return '';

    const lines = [
      '### Flag Actions Available',
      '(Signal flag changes at the END of your narration using: <<FLAGS: +flag_id, -flag_id>>)',
      '(Only use flags listed here. Never mention flag names in the narration itself.)',
      '',
    ];

    for (const e of relevant) {
      const alreadySet = ctx.flags.has(e.flagId);
      const status = alreadySet ? ' [CURRENTLY SET]' : '';
      lines.push(`FLAG [${e.flagId}]${status}: ${e.description}`);
      if (!alreadySet) {
        lines.push(`  → Set when: ${e.setCondition}`);
      }
      if (e.unsetCondition) {
        lines.push(`  → Unset when: ${e.unsetCondition}`);
      }
    }

    return lines.join('\n');
  }

  // ── Signal Parsing ────────────────────────────────────────────

  /**
   * Parse flag signals from a DM response string.
   * Extracts <<FLAGS: +flag_a, -flag_b>> patterns.
   * Returns the signals and the narrative with the signal line stripped.
   */
  parseSignals(narrative: string): { signals: FlagSignal[]; cleanNarrative: string } {
    const match = narrative.match(FLAG_SIGNAL_PATTERN);
    if (!match) return { signals: [], cleanNarrative: narrative };

    const signalStr  = match[1];
    const signals: FlagSignal[] = [];

    for (const token of signalStr.split(',')) {
      const t = token.trim();
      if (t.startsWith('+')) {
        signals.push({ flagId: t.slice(1).trim(), action: 'set' });
      } else if (t.startsWith('-')) {
        signals.push({ flagId: t.slice(1).trim(), action: 'unset' });
      }
    }

    // Strip the signal line from the displayed narrative
    const cleanNarrative = narrative.replace(FLAG_SIGNAL_PATTERN, '').replace(/\n{3,}/g, '\n\n').trimEnd();

    return { signals, cleanNarrative };
  }

  /**
   * Validate that all signals in a DM response reference flags from the
   * current proximity context (prevent DM hallucinating flag names).
   * Returns only valid signals.
   */
  validateSignals(signals: FlagSignal[], ctx: ProximityContext): FlagSignal[] {
    const allowed = new Set(this.getRelevantEntries(ctx).map(e => e.flagId));
    return signals.filter(s => allowed.has(s.flagId));
  }

  // ── Internal ─────────────────────────────────────────────────

  private matchesProximity(entry: FlagManifestEntry, ctx: ProximityContext): boolean {
    const p = entry.proximity;

    if (p.locationIds?.length && !p.locationIds.includes(ctx.locationId)) return false;
    if (p.districtIds?.length && (!ctx.districtId || !p.districtIds.includes(ctx.districtId))) return false;

    if (p.questIds?.length && !p.questIds.some(q => ctx.activeQuestIds.includes(q))) return false;

    if (p.flags?.length    && !ctx.flags.hasAll(p.flags))    return false;
    if (p.anyFlags?.length && !ctx.flags.hasAny(p.anyFlags)) return false;
    if (p.notFlags?.length &&  ctx.flags.hasAny(p.notFlags)) return false;

    if (p.timePeriod?.length && !p.timePeriod.includes(ctx.timePeriod)) return false;

    return true;
  }
}
