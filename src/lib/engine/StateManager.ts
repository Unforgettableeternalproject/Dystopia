// ── StateManager ──────────────────────────────────────────────
// 持有並管理 GameState，提供讀取與更新介面。
// 所有狀態變更都應透過此類進行，確保一致性。

import type { GameState, PlayerAction, Thought } from '../types';
import { EventBus, GameEvents } from './EventBus';
import { FlagSystem } from './FlagSystem';

export class StateManager {
  private state: GameState;
  private bus: EventBus;
  readonly flags: FlagSystem;

  constructor(initialState: GameState, bus: EventBus) {
    this.state = initialState;
    this.bus = bus;
    this.flags = new FlagSystem(bus, Array.from(initialState.player.activeFlags));
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  /** 更新玩家位置 */
  movePlayer(locationId: string): void {
    const prev = this.state.player.currentLocationId;
    this.state.player.currentLocationId = locationId;
    this.bus.emit(GameEvents.LOCATION_CHANGED, { from: prev, to: locationId });
    this.notifyUpdate();
  }

  /** 更新單一數值 */
  modifyStat(key: string, delta: number): void {
    // 支援 primaryStats.strength 這樣的路徑
    const [group, stat] = key.split('.');
    const stats = (this.state.player as Record<string, Record<string, number>>)[group];
    if (stats && stat in stats) {
      stats[stat] = Math.max(0, stats[stat] + delta);
      this.notifyUpdate();
    }
  }

  /** 設定 Thought 列表 */
  setThoughts(thoughts: Thought[]): void {
    this.state.pendingThoughts = thoughts;
    this.notifyUpdate();
  }

  /** 追加歷史紀錄 */
  appendHistory(action: PlayerAction, narrative: string): void {
    this.state.history.push({
      turn: this.state.turn,
      action,
      narrative,
    });
    // 只保留最近 20 筆，避免 context 過長
    if (this.state.history.length > 20) {
      this.state.history.shift();
    }
    this.state.turn += 1;
    this.notifyUpdate();
  }

  /** 更新最後敘述 */
  setLastNarrative(text: string): void {
    this.state.lastNarrative = text;
  }

  private notifyUpdate(): void {
    this.bus.emit(GameEvents.STATE_UPDATED, this.state);
  }
}
