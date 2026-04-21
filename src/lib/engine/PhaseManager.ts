// PhaseManager — checks and applies world phase transitions.
// Most phase effects (npc_override, location_restrict, etc.) are handled
// dynamically by LoreVault.resolve* based on flags, so PhaseManager mainly
// advances the phase state and emits flag_set effects.

import type { LoreVault } from '../lore/LoreVault';
import type { StateManager } from './StateManager';
import type { PhaseEffect, WorldPhaseId } from '../types/phase';

const PHASE_ORDER: WorldPhaseId[] = [
  'grace_period',
  'phase_1',
  'phase_2',
  'phase_3',
  'phase_4',
];

export class PhaseManager {
  constructor(
    private lore: LoreVault,
    private state: StateManager,
  ) {}

  /**
   * Called each turn. Checks whether the next phase's trigger flag is set.
   * If so, advances the world phase and applies its effects.
   * Returns the new phase id if a transition occurred, otherwise undefined.
   */
  checkAdvance(): WorldPhaseId | undefined {
    const { currentPhase } = this.state.getState().worldPhase;
    const currentIdx = PHASE_ORDER.indexOf(currentPhase);
    if (currentIdx < 0 || currentIdx >= PHASE_ORDER.length - 1) return undefined;

    const nextId = PHASE_ORDER[currentIdx + 1];
    const nextPhase = this.lore.getPhase(nextId);
    if (!nextPhase || !nextPhase.triggerFlag) return undefined;

    if (!this.state.flags.has(nextPhase.triggerFlag)) return undefined;

    // Apply effects
    for (const effect of nextPhase.effects) {
      this.applyEffect(effect);
    }
    this.state.advancePhase(nextId);
    return nextId;
  }

  private applyEffect(effect: PhaseEffect): void {
    // flag_set is the only effect PhaseManager applies directly.
    // npc_override / location_restrict / etc. are resolved on-demand by LoreVault
    // based on the flags that are currently set — no extra action needed here.
    if (effect.type === 'flag_set' && effect.flag) {
      if (!effect.condition || this.state.flags.evaluate(effect.condition)) {
        this.state.flags.set(effect.flag);
      }
    }
  }
}
