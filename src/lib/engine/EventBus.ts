// EventBus — simple pub/sub for decoupled engine communication.

type Listener<T = unknown> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<string, Listener[]>();

  on<T>(event: string, listener: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener as Listener);
    return () => this.off(event, listener as Listener);
  }

  off(event: string, listener: Listener): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit<T>(event: string, payload: T): void {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }
}

export const GameEvents = {
  STATE_UPDATED:        'state:updated',
  FLAG_SET:             'flag:set',
  FLAG_UNSET:           'flag:unset',
  LOCATION_CHANGED:     'location:changed',
  NPC_INTERACTED:       'npc:interacted',
  GAME_EVENT_TRIGGERED: 'gameevent:triggered',
  ACTION_REJECTED:      'action:rejected',
  NARRATIVE_STREAM:     'narrative:stream',
  NARRATIVE_COMPLETE:   'narrative:complete',
  PHASE_ADVANCED:       'phase:advanced',
  QUEST_STARTED:        'quest:started',
  QUEST_STAGE_ADVANCED: 'quest:stage_advanced',
  QUEST_COMPLETED:      'quest:completed',
} as const;
