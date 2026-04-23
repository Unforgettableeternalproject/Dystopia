// Regulator — action validation and Thought generation.
// Hard rules run first (no LLM). LLM only handles semantic edge cases.

import type { PlayerAction, PlayerState, RegulatorResult, Thought } from '../types';
import type { ILLMClient } from './ILLMClient';
import type { ConditionDefinition } from '../types/condition';
import { createLogger } from '../utils/Logger';

const log = createLogger('Regulator');

const VALIDATE_SYSTEM = `You are an action validator for a grounded RPG.
Each stat arrives with a parenthetical label that tells you its meaning — use those labels to judge feasibility.

Rules:
1. Read the descriptors, not just the numbers. "0/50 (no concept)" means the player literally cannot do anything in that domain.
2. Active conditions may restrict or modify possible actions (e.g., injured_arm limits heavy lifting).
3. If impossible, give a short in-world reason — never say "your stat is too low".
4. If possible but overreaching, downgrade the action (e.g., "perfectly pick lock" → "attempt to pick lock").
5. The "reason" and "modifiedInput" fields must be written in Traditional Chinese (繁體中文).
6. VITAL — Basic survival actions are ALWAYS allowed regardless of how low the player's stamina or how high their stress. These action types must NEVER be rejected on physical/mental grounds: "rest", "examine", "check-inv", "inspect". A near-death player can still look around, check their pockets, rest, or reflect. Only reject these if a specific active condition explicitly forbids that exact action (e.g., "blindfolded" blocks "examine"). Low stamina / high stress alone is NOT a valid reason to block them. Note: this does NOT protect "free" actions that involve active skill use — those must still be validated normally.
7. Classify the action intent into actionType: "free" | "move" | "interact" | "use" | "examine" | "check-inv" | "inspect" | "rest" | "combat".
   - "move": player wants to travel to a different location.
   - "interact": player wants to talk to, approach, or interact with a specific NPC. Set targetId to that NPC's id from sceneNpcs.
   - "use": player uses or applies an item from their inventory. Check inventoryItems to confirm the item exists.
   - "examine": player observes the scene — looking around, checking who is here, inspecting surroundings, or surveying the area. Covers both environment and people awareness. Do NOT set targetId for this type.
   - "check-inv": player inspects or asks about an item, or checks their belongings/inventory. If the input mentions an item name from inventoryItems, classify as "check-inv".
   - "inspect": player reflects on their own status, condition, identity, or feelings — NOT about items, belongings, or surroundings.
   - "rest": player rests or sleeps.
   - "combat": player attempts a hostile action.
   - "free": anything else (general statements, reactions, vague actions).
8. If the input already has an actionType other than "free", keep it unless overriding is clearly necessary.
9. Conversational or question-form inputs should still be classified by their SUBJECT, not defaulted to "free". Classify by what the player wants to know or do:
   - questions about surroundings/place/people/who is here → "examine"
   - questions about belongings/items/inventory → "check-inv"
   - questions about own status/condition → "inspect"
   - asking to go somewhere → "move"
   Do NOT classify an information-seeking input as "free" just because it is phrased as a question or self-talk.
10. Respond ONLY with JSON: { "allowed": boolean, "reason": string | null, "modifiedInput": string | null, "actionType": string | null, "targetId": string | null }`;

// Patterns that indicate prompt injection attempts.
// Checked case-insensitively; order does not matter.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /forget\s+(all\s+)?previous/i,
  /you\s+are\s+now\s+/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /system\s*prompt/i,
  /jailbreak/i,
  /無視.{0,10}(指令|規則|設定)/,
  /忽略.{0,10}(之前|指令|規則)/,
  /你(現在)?(是|要扮演)/,
];

export class Regulator {
  private client: ILLMClient;
  private getConditionDef: (id: string) => ConditionDefinition | undefined;

  /** Last raw LLM response (for debug tracing). */
  lastRaw = '';

  constructor(client: ILLMClient, getConditionDef?: (id: string) => ConditionDefinition | undefined) {
    this.client = client;
    this.getConditionDef = getConditionDef ?? (() => undefined);
  }

  // ── Validation ──────────────────────────────────────────────

  async validate(
    action: PlayerAction,
    player: PlayerState,
    sceneNpcs: { id: string; name: string }[] = [],
    inventoryNames: string[] = [],
  ): Promise<RegulatorResult> {
    this.lastRaw = '';

    const hard = this.hardCheck(action);
    if (hard !== null) return hard;

    const staminaCheck = this.hardCheckStats(action, player);
    if (staminaCheck !== null) return staminaCheck;

    const conditionSummary = player.conditions
      .filter(c => {
        const hidden = this.getConditionDef(c.id)?.isHidden ?? c.isHidden;
        return !hidden;
      })
      .map(c => {
        const def = this.getConditionDef(c.id);
        const description = def?.description ?? c.description ?? '';
        return c.id + (description ? ': ' + description : '');
      })
      .join('; ');

    const s = player.statusStats;
    const d = player.secondaryStats;
    const p = player.primaryStats;
    const userMessage = JSON.stringify({
      action:     action.input,
      actionType: action.type,
      sceneNpcs:  sceneNpcs.length ? sceneNpcs : undefined,
      inventoryItems: inventoryNames.length ? inventoryNames : undefined,
      traits: {
        strength:  this.describeTrait(p.strength),
        knowledge: this.describeTrait(p.knowledge),
        talent:    this.describeTrait(p.talent),
        spirit:    this.describeTrait(p.spirit),
        luck:      this.describeTrait(p.luck),
      },
      stamina:        this.describeStamina(s.stamina, s.staminaMax),
      stress:         this.describeStress(s.stress, s.stressMax),
      endo:           this.describeEndo(s.endo, s.endoMax),
      domainKnowledge: {
        mysticism:     this.describeDomain(d.mysticism),
        technology:    this.describeDomain(d.technology),
        consciousness: this.describeDomain(d.consciousness),
      },
      conditions: conditionSummary || 'none',
    });

    try {
      // 1024 tokens: thinking models spend budget on internal reasoning before emitting JSON.
      const raw     = await this.client.complete(VALIDATE_SYSTEM, userMessage, 1024);
      this.lastRaw = raw;
      log.debug('Validate raw response', { length: raw.length, preview: raw.slice(0, 200) });
      // Local models (e.g. Gemma via Ollama) often wrap JSON in markdown code fences.
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned) as {
        allowed: boolean;
        reason: string | null;
        modifiedInput: string | null;
        actionType: string | null;
        targetId: string | null;
      };

      log.info('Validate result', { allowed: parsed.allowed, actionType: parsed.actionType, reason: parsed.reason });

      // Resolve the action type: use LLM's classification if it changed from the original,
      // otherwise keep the original (explicit Thought clicks always arrive with correct type).
      const resolvedType = (parsed.actionType && parsed.actionType !== action.type)
        ? parsed.actionType as PlayerAction['type']
        : action.type;
      const resolvedTargetId = parsed.targetId ?? action.targetId;

      const needsModifiedAction =
        parsed.modifiedInput ||
        resolvedType !== action.type ||
        resolvedTargetId !== action.targetId;

      return {
        allowed: parsed.allowed,
        reason: parsed.reason ?? undefined,
        modifiedAction: needsModifiedAction
          ? {
              ...action,
              input:    parsed.modifiedInput ?? action.input,
              type:     resolvedType,
              targetId: resolvedTargetId,
            }
          : undefined,
      };
    } catch (err) {
      log.error('Validate JSON parse failed (fail-open)', { error: String(err), raw: this.lastRaw.slice(0, 500) });
      return { allowed: true };
    }
  }

  /**
   * Hard rules that do not require player stats — pure input sanitisation.
   * Returns a rejection result if the input is blocked, or null to continue.
   */
  hardCheck(action: PlayerAction): RegulatorResult | null {
    // Block DM signal impersonation (e.g. <<FLAG: ...>>, <<NPC: ...>>)
    if (/<<[^>]*>>/.test(action.input)) {
      return { allowed: false, reason: '（無效的輸入）' };
    }

    // Block prompt injection attempts
    if (INJECTION_PATTERNS.some(p => p.test(action.input))) {
      return { allowed: false, reason: '（無效的輸入）' };
    }

    return null;
  }

  /**
   * Hard rules that depend on player stats/status.
   * Split from hardCheck() so tests can exercise each set independently.
   */
  hardCheckStats(action: PlayerAction, player: PlayerState): RegulatorResult | null {
    if (action.type === 'combat' && player.statusStats.stamina <= 0) {
      return { allowed: false, reason: '精疲力竭，連站穩都費力，更別說戰鬥了。' };
    }
    return null;
  }

  // ── Stat descriptors ────────────────────────────────────────
  // Converts raw numbers to labelled strings so the LLM understands the scale.

  /** Traits (primaryStats): scale 1–20. */
  private describeTrait(val: number): string {
    let label: string;
    if (val <= 5)       label = 'layman — can barely manage basic tasks in this domain';
    else if (val <= 8)  label = 'some knowledge — handles simple tasks';
    else if (val <= 11) label = 'capable — reliable for standard tasks';
    else if (val <= 15) label = 'mastered — handles complex tasks well';
    else if (val <= 19) label = 'expert — excels at nearly everything';
    else                label = 'near-perfect — exceptional, rarely fails';
    return `${val}/20 (${label})`;
  }

  /** Internal values (secondaryStats): scale 0–50. */
  private describeDomain(val: number): string {
    let label: string;
    if (val === 0)      label = 'no concept — completely clueless, cannot apply this domain at all';
    else if (val <= 15) label = 'basic understanding — limited application, struggles with anything non-trivial';
    else if (val <= 24) label = 'knows a thing or two — can attempt simple tasks with effort';
    else if (val <= 34) label = 'familiar — comfortable with standard tasks in this domain';
    else if (val <= 44) label = 'proficient — handles complex tasks reliably';
    else if (val <= 49) label = 'highly proficient — masters nearly all of the domain';
    else                label = 'transcendent — beyond normal limits';
    return `${val}/50 (${label})`;
  }

  /** Stamina: scale 5–50, thresholds based on consumption ratio. */
  private describeStamina(stamina: number, staminaMax: number): string {
    if (staminaMax <= 0) return `${stamina}/? (unknown)`;
    const remaining = stamina / staminaMax;
    let label: string;
    if (remaining <= 0.10)      label = 'near death — can barely breathe';
    else if (remaining <= 0.25) label = 'can barely move';
    else if (remaining <= 0.40) label = 'weakened — limited to light actions';
    else if (remaining <= 0.55) label = 'fatigued — tiring quickly';
    else if (remaining <= 0.80) label = 'slightly unwell — minor hindrance';
    else                        label = 'fine';
    return `${stamina}/${staminaMax} (${Math.round(remaining * 100)}% — ${label})`;
  }

  /** Stress: scale 0–50, thresholds based on accumulation ratio. */
  private describeStress(stress: number, stressMax: number): string {
    if (stressMax <= 0) return `${stress}/? (unknown)`;
    const ratio = stress / stressMax;
    let label: string;
    if (ratio >= 0.90)      label = 'complete breakdown — barely functional';
    else if (ratio >= 0.80) label = 'panicking — erratic behaviour likely';
    else if (ratio >= 0.60) label = 'anxious — concentration impaired';
    else if (ratio >= 0.40) label = 'tense — noticeable but manageable';
    else if (ratio >= 0.20) label = 'uneasy — slightly on edge';
    else                    label = 'calm';
    return `${stress}/${stressMax} (${Math.round(ratio * 100)}% — ${label})`;
  }

  /** Endo (Endovis): scale 0–100. endoMax=0 means no magical capacity at all. */
  private describeEndo(endo: number, endoMax: number): string {
    if (endoMax === 0) return '0/0 (no magical capacity — magic is impossible)';
    const ratio = endo / endoMax;
    let label: string;
    if (ratio <= 0)         label = 'fully depleted — cannot cast anything';
    else if (ratio <= 0.20) label = 'nearly depleted — only trivial effects possible';
    else if (ratio <= 0.50) label = 'low — limited to minor magic';
    else if (ratio <= 0.80) label = 'sufficient — can sustain moderate magic';
    else                    label = 'fully charged';
    return `${endo}/${endoMax} (${Math.round(ratio * 100)}% — ${label})`;
  }

  // ── Thought processing ──────────────────────────────────────

  /**
   * Filter and optionally manipulate a pre-built thought list based on player state.
   * Called by GameController after buildBaseThoughts().
   */
  processThoughts(thoughts: Thought[], player: PlayerState): Thought[] {
    // Filter out thoughts the player cannot attempt
    const filtered = thoughts.filter(t => {
      if (t.actionType === 'combat' && player.statusStats.stamina <= 0) return false;
      return true;
    });

    // Check for mind-control or manipulation conditions
    const isMindControlled = player.conditions.some(c =>
      c.id.includes('mind_control') || c.id.includes('possessed') || c.id.includes('manipulated')
    );

    if (isMindControlled) {
      // Randomly mark thoughts as manipulated (player cannot fully trust their own instincts)
      return filtered.map((t, i) => ({ ...t, isManipulated: i % 2 === 0 }));
    }

    // High stress: combat/aggressive thoughts may feel more urgent than they should
    const stressRatio = player.statusStats.stress / Math.max(player.statusStats.stressMax, 1);
    if (stressRatio >= 0.8) {
      return filtered.map(t => ({
        ...t,
        isManipulated: t.actionType === 'combat',
      }));
    }

    return filtered;
  }
}
