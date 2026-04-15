// ── EventBus ──────────────────────────────────────────────────
// 簡單的發布/訂閱系統，用於引擎內各模組的解耦通訊。

type Listener<T = unknown> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<string, Listener[]>();

  on<T>(event: string, listener: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener as Listener);

    // 回傳取消訂閱函式
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

// 遊戲系統事件常數
export const GameEvents = {
  STATE_UPDATED: 'state:updated',
  FLAG_SET: 'flag:set',
  FLAG_UNSET: 'flag:unset',
  LOCATION_CHANGED: 'location:changed',
  NPC_INTERACTED: 'npc:interacted',
  EVENT_TRIGGERED: 'event:triggered',
  ACTION_REJECTED: 'action:rejected',
  NARRATIVE_STREAM: 'narrative:stream',
  NARRATIVE_COMPLETE: 'narrative:complete',
} as const;
