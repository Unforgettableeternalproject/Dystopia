// ── GameController ────────────────────────────────────────────
// 串接所有模組的頂層協調器。UI 層只與此類互動。

import { AnthropicClient } from '../ai/AnthropicClient';
import { DMAgent } from '../ai/DMAgent';
import { Regulator } from '../ai/Regulator';
import { LoreVault } from '../lore/LoreVault';
import { EventBus } from './EventBus';
import { StateManager } from './StateManager';
import type { PlayerAction, GameState, PlayerState } from '../types';
import {
  pushLine,
  appendToLastLine,
  finishLastLine,
  isStreaming,
  inputDisabled,
  thoughts,
  playerUI,
} from '../stores/gameStore';

export class GameController {
  private client: AnthropicClient;
  private dm: DMAgent;
  private regulator: Regulator;
  private lore: LoreVault;
  private bus: EventBus;
  private state: StateManager;
  private mockMode: boolean;

  constructor(apiKey?: string) {
    this.mockMode = !apiKey && !import.meta.env.VITE_ANTHROPIC_API_KEY;
    this.client = new AnthropicClient(apiKey);
    this.dm = new DMAgent(this.client);
    this.regulator = new Regulator(this.client);
    this.lore = new LoreVault();
    this.bus = new EventBus();

    // 初始化空的遊戲狀態（等待 start() 呼叫）
    const initialState = this.buildInitialState();
    this.state = new StateManager(initialState, this.bus);
  }

  /** 載入 lore 資料（從 JSON 物件） */
  loadLore(data: Parameters<LoreVault['load']>[0]): void {
    this.lore.load(data);
  }

  /** 開始遊戲 */
  async start(): Promise<void> {
    const gs = this.state.getState();
    this.syncUIState(gs);

    if (this.mockMode) {
      this.runMockIntro();
      return;
    }

    const sceneCtx = this.lore.buildSceneContext(
      gs.player.currentLocationId,
      this.state.flags
    );
    await this.runDM(
      { type: 'examine', input: '（遊戲開始）' },
      sceneCtx
    );
    await this.refreshThoughts();
  }

  /** 玩家提交動作 */
  async submitAction(input: string): Promise<void> {
    if (!input.trim()) return;

    const action: PlayerAction = {
      type: 'free',
      input: input.trim(),
    };

    inputDisabled.set(true);
    pushLine(`> ${input}`, 'player');

    if (this.mockMode) {
      await this.runMockResponse(input);
      inputDisabled.set(false);
      return;
    }

    // 規制器判定
    const result = await this.regulator.validate(action, this.state.getState().player);

    if (!result.allowed) {
      pushLine(result.reason ?? '那樣做是不可能的。', 'rejected');
      inputDisabled.set(false);
      return;
    }

    const finalAction = result.modifiedAction ?? action;
    const sceneCtx = this.lore.buildSceneContext(
      this.state.getState().player.currentLocationId,
      this.state.flags
    );

    await this.runDM(finalAction, sceneCtx);
    await this.refreshThoughts();
    inputDisabled.set(false);
  }

  // ── 內部方法 ───────────────────────────────────────────────

  private async runDM(action: PlayerAction, sceneCtx: string): Promise<void> {
    isStreaming.set(true);
    pushLine('', 'narrative');

    let fullText = '';
    try {
      for await (const chunk of this.dm.narrate(
        sceneCtx,
        action,
        this.state.getState().history
      )) {
        appendToLastLine(chunk);
        fullText += chunk;
      }
    } finally {
      finishLastLine();
      isStreaming.set(false);
    }

    this.state.appendHistory(action, fullText.slice(0, 120));
    this.state.setLastNarrative(fullText);
    this.syncUIState(this.state.getState());
  }

  private async refreshThoughts(): Promise<void> {
    const sceneCtx = this.lore.buildSceneContext(
      this.state.getState().player.currentLocationId,
      this.state.flags
    );
    const newThoughts = await this.regulator.generateThoughts(
      sceneCtx,
      this.state.getState().player
    );
    thoughts.set(newThoughts);
    this.state.setThoughts(newThoughts);
  }

  private syncUIState(gs: Readonly<GameState>): void {
    const resolved = this.lore.resolveLocation(
      gs.player.currentLocationId,
      this.state.flags
    );
    playerUI.set({
      name: gs.player.name,
      location: resolved?.name ?? gs.player.currentLocationId,
      stamina: gs.player.statusStats.stamina,
      staminaMax: gs.player.statusStats.staminaMax,
      stress: gs.player.statusStats.stress,
      stressMax: gs.player.statusStats.stressMax,
      turn: gs.turn,
    });
  }

  // ── Mock Mode（無 API key 時的示範模式） ──────────────────────

  private async runMockIntro(): Promise<void> {
    thoughts.set([
      { id: 'look', text: '觀察周圍', actionType: 'examine' },
      { id: 'move', text: '查看可以去的地方', actionType: 'move' },
      { id: 'talk', text: '嘗試與人交談', actionType: 'interact' },
    ]);

    const lines = [
      '鬧鐘聲把你從淺眠中拽出來。',
      '公有宿舍的燈光在五點半準時亮起——不是為了讓你好過，是為了讓你準時到達第四象限的配額站。',
      '上方鋪位的人已經起身，金屬床架發出的聲音在沉默的走廊裡格外清脆。',
      '你有十五分鐘。',
    ];

    isStreaming.set(true);
    pushLine('', 'narrative');
    for (const line of lines) {
      for (const char of line) {
        appendToLastLine(char);
        await sleep(18);
      }
      appendToLastLine('\n');
      await sleep(120);
    }
    finishLastLine();
    isStreaming.set(false);

    playerUI.update((p) => ({ ...p, name: '???', location: '戴司 — 公有宿舍' }));
  }

  private async runMockResponse(input: string): Promise<void> {
    isStreaming.set(true);
    pushLine('', 'narrative');

    const response = `（Mock 模式）你嘗試：${input}。\n在沒有 API key 的情況下，DM 無法回應。請在 .env 中設定 VITE_ANTHROPIC_API_KEY。`;

    for (const char of response) {
      appendToLastLine(char);
      await sleep(12);
    }
    finishLastLine();
    isStreaming.set(false);
  }

  private buildInitialState(): GameState {
    return {
      player: {
        id: 'player-1',
        name: '???',
        origin: 'worker',
        currentLocationId: 'delth_bunkhouse',
        primaryStats: { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
        secondaryStats: { consciousness: 2, arcane: 0, technology: 3 },
        statusStats: { stamina: 10, staminaMax: 10, stress: 2, stressMax: 10, mana: 0, manaMax: 0, experience: 0 },
        externalStats: { reputation: {}, affinity: {}, familiarity: {} },
        inventory: [],
        activeFlags: new Set(),
        titles: [],
      },
      turn: 0,
      phase: 'exploring',
      pendingThoughts: [],
      lastNarrative: '',
      history: [],
      discoveredLocationIds: [],
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
