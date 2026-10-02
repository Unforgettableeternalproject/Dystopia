// GameController -- top-level coordinator. UI only talks to this class.
//
// Turn pipeline (submitAction):
//   1. Regulator validates the action
//   2. tickConditions -- expire temporary player conditions
//   3. EventEngine.checkAndApply -- trigger lore events at current location
//   4. DM narrates (enriched scene context)
//   5. appendHistory
//   6. QuestEngine.checkObjectives
//   7. PhaseManager.checkAdvance
//   8. syncUIState
//   9. refreshThoughts

import { DMAgent } from '../ai/DMAgent';
import { DM_NARRATION_PROMPT } from '../ai/prompts/exploration';
import { JudgeAgent }       from '../ai/JudgeAgent';
import { Regulator, OUT_OF_BOUNDS_MESSAGE } from '../ai/Regulator';
import { autoClients }      from '../ai/LLMClientFactory';
import type { ILLMClient }  from '../ai/ILLMClient';
import { LoreVault, isSecretLayerRevealed } from '../lore/LoreVault';
import { EventBus, GameEvents } from './EventBus';
import { StateManager }     from './StateManager';
import { EventEngine }      from './EventEngine';
import { PhaseManager }     from './PhaseManager';
import { QuestEngine }      from './QuestEngine';
import { FactionTreeEngine } from './FactionTreeEngine';
import { TimeManager }      from './TimeManager';
import { DialogueManager }  from './DialogueManager';
import { EncounterEngine }  from './EncounterEngine';
import type { ResolvedNode, EncounterPendingEffects } from './EncounterEngine';
import { RestResolver, QUALITY_LABEL } from './RestResolver';
import { parseRestDurationMinutes, resolveRestPreset } from '../utils/restDurationParser';
import { formatClock, interpolateCurfew } from '../utils/curfew';
import { buildClockBlock, curfewLine, upcomingLine, MAX_ACTION_MINUTES } from '../utils/timeContext';
import type { GameTime } from '../types/game';
import type { RestResult }             from './RestResolver';
import type { EncounterDefinition, ScriptLine } from '../types/encounter';
import type { PlayerAction, ActionType, ActionTargetKind, GameState, StarterConfig, ExplorationShadowComparison, DialogueShadowComparison, TurnResolution, DialogueResolution } from '../types';
import type { ObserveSnapshot, RestContext } from '../types/prop';
import { parseItemGrantString } from '../utils/itemGrantParser';
import type { TriggeredEvent }          from './EventEngine';
import type { ProximityContext }        from './FlagRegistry';
import type { Thought }                 from '../types';
import { get } from 'svelte/store';
import {
  pushLine,
  appendToLastLine,
  finishLastLine,
  appendToLine,
  finalizeLine,
  restoreHistoryLines,
  encounterSessionLog,
  appendEncounterLog,
  isStreaming,
  inputDisabled,
  thoughts,
  playerUI,
  narrativeLines,
  type NarrativeLine,
  type MiniMapData,
  type MiniMapNode,
  type MiniMapEdge,
  type RegionMapData,
  observeSnapshot,
  loreItemOpen,
} from '../stores/gameStore';
import type { DialogueLogEntry } from '../ai/DMAgent';
import { createLogger, listenForLogSyncRequests } from '../utils/Logger';
import { startTrace, addTracePhase, updateTraceLabel, listenForSyncRequests } from '../stores/traceStore';
import { warmUpModel }  from '../utils/ModelWarmup';
import { interpolate, type InterpolationContext } from '../utils/textInterpolation';
import * as SaveManager from '../utils/SaveManager';
import type { SlotMeta } from '../utils/SaveManager';
import { stateFingerprint } from '../utils/SaveCodec';
import { activeNpcUI, detailedPlayer, activeScriptedDialogue, activeEncounterUI, storyTypingActive, isSaving, enqueueQuestBanner, showQuestOutcomeFlash, showEventToast, showAcquisitionNotif, triggerBarFlash, showStatDelta, triggerMelphinFlash, triggerSelfCheckGlow, triggerInventoryGlow, gamePhase, endingType, shadowModeActive, pushShadowComparison, restModalOpen, restResultOverlay, previousSnapshot, rewindAction } from '../stores/gameStore';
import type { EndingType } from '../stores/gameStore';
import { ACTION_MINUTES } from './TimeManager';

const log = createLogger('GameCtrl');

/**
 * 固定附加在對話中 thoughts 候選末尾的「結束對話」選項。id 固定，供 UI 層
 * （handleThoughtSelect）辨識並改走 exitDialogue() 而非一般動作送出。
 */
export const END_DIALOGUE_THOUGHT: Thought = { id: 'end_dialogue', text: '結束對話', actionType: 'free' };

const STAT_LABELS: Record<string, Record<string, string>> = {
  statusStats:   { stamina: '體力', staminaMax: '體力上限', stress: '壓力', stressMax: '壓力上限', endo: 'Endo', endoMax: 'Endo 上限', experience: '經驗', fatigue: '疲勞' },
  primaryStats:  { strength: '力量', knowledge: '知識', talent: '才能', spirit: '靈性', luck: '運氣' },
  secondaryStats: { consciousness: '意識', mysticism: '神秘', technology: '技術' },
};

export class GameController {
  private dm:          DMAgent;
  private judge:       JudgeAgent;
  private regulator:   Regulator;
  private dmClient:    ILLMClient | null;  // kept for warmup
  private lore:        LoreVault;
  private bus:         EventBus;
  private state:       StateManager;
  private events:      EventEngine;
  private phases:      PhaseManager;
  private quests:      QuestEngine;
  private factionTree: FactionTreeEngine;
  private timeMgr:     TimeManager;
  private dialogueMgr:  DialogueManager;
  private encounterMgr: EncounterEngine;
  private mockMode:     boolean;
  private _storySkipRequested = false;

  /** ID of the region the player is currently in. Updated on region change. */
  private currentRegionId = 'crambell';

  /**
   * Quest outcomes that happened THIS turn (accumulated via bus events).
   * Promoted to _stagedQuestOutcomes at end of processAction so the DM
   * sees them exactly ONCE — in the NEXT turn's buildSceneCtx — then cleared.
   */
  private _pendingQuestOutcomes: Array<{ name: string; outcome: 'completed' | 'failed' }> = [];
  private _stagedQuestOutcomes:  Array<{ name: string; outcome: 'completed' | 'failed' }> = [];
  /** 「已儲存」基準的狀態指紋；null = 尚無基準（視為有未儲存變更）。 */
  private _savedFingerprint: string | null = null;
  /** 存檔序號：避免較早開始、較晚完成的存檔把基準蓋回舊狀態。 */
  private _saveSeq = 0;
  private _savedSeq = 0;

  /** Maximum NPC dialogue turns before controller forces a wrap-up. */
  private static readonly MAX_DIALOGUE_TURNS = 8;

  /** 每累積 N 分鐘遊戲時間，疲勞 +1（6 小時） */
  private static readonly FATIGUE_PERIOD_MINUTES = 360;
  /** 行動時長（含狀態乘數）達此分鐘數才做定時事件中斷探測；短行動維持原行為 */
  private static readonly LONG_ACTION_INTERRUPT_MINUTES = 60;

  /** 暫存休息敘述上下文，在 overlay 關閉後由 narrateRestResult() 使用 */
  private _pendingRestNarration: {
    sceneCtx:              string;
    result:                RestResult;
    plannedMinutes:        number;
    wasInterrupted:        boolean;
    wasRestStartInterrupt: boolean;
    interruptTriggered:    TriggeredEvent[];
    /** rest_start 事件觸發的遭遇 ID 佇列，narration 完成後依序啟動。 */
    restEncounterIds?:     string[];
  } | null = null;


  /** Scripted trigger nodeIds that have already fired in the current NPC encounter session. */
  private _sessionFiredTriggers = new Set<string>();

  /** Guard against double-firing endScriptedDialogue via setTimeout race. */
  private _pendingAutoEnd: ReturnType<typeof setTimeout> | null = null;
  /** selectDialogueChoice 重入鎖（防止同一選項在串流期間被重複套用） */
  private _dialogueChoiceBusy = false;
  /** handleDialogueInput 重入鎖（防止自由輸入/想法點選在串流期間被重複觸發，產生兩個 NPC 發言框） */
  private _dialogueInputBusy = false;

  /** 進入對話前的探索想法快照 + 當下狀態指紋（供對話結束時還原，見 exitDialogueThoughts） */
  private _thoughtsSnapshot: Thought[] | null = null;
  private _thoughtsSnapshotFingerprint: string | null = null;

  /**
   * Once a scripted node has fired in the current encounter session,
   * suppress all further scripted trigger checks for the remainder of the session.
   * Reset when the encounter session ends (NPC panel closes or NPC changes).
   */
  private _scriptedFiredThisSession = false;

  /**
   * Sequential encounter queue.
   * All encounter-spawning paths push here; selectEncounterChoice / selectEncounterStoryAdvance
   * drain it automatically when the current encounter concludes.
   * Maintains FIFO order with one exception: fail encounters are unshifted to the front.
   */
  private _encounterQueue: Array<{ id: string; def?: EncounterDefinition }> = [];

  /**
   * Sequential NPC dialogue queue (event-triggered scripted nodes).
   * Drained by startNextQueuedEncounter BEFORE encounter queue.
   * endAfterScript is always true for event-triggered dialogues.
   */
  private _npcDialogueQueue: Array<{ npcId: string; dialogueId: string; nodeId: string }> = [];

  private starterConfig: StarterConfig | null = null;

  constructor(config?: { dm?: ILLMClient; regulator?: ILLMClient }) {
    const auto = autoClients();
    this.mockMode = !config?.dm && !config?.regulator && !auto;
    // In mock mode dm/regulator are never called -- null! casts are safe.
    const dmClient        = config?.dm        ?? auto?.dm        ?? null!;
    const regulatorClient = config?.regulator ?? auto?.regulator ?? null!;
    this.dmClient  = dmClient  ?? null;
    this.dm        = new DMAgent(dmClient);
    this.judge     = new JudgeAgent(dmClient);
    this.lore      = new LoreVault();
    this.regulator = new Regulator(regulatorClient, (id) => this.lore.getCondition(id));
    this.bus       = new EventBus();
    this.timeMgr   = new TimeManager();

    const initialState = this.buildInitialState();
    this.state  = new StateManager(initialState, this.bus);
    this.events      = new EventEngine(this.lore, this.state, this.timeMgr);
    this.phases      = new PhaseManager(this.lore, this.state);
    this.quests      = new QuestEngine(this.lore, this.state);
    this.factionTree = new FactionTreeEngine(this.lore, this.state);
    this.quests.setFactionTree(this.factionTree);
    this.dialogueMgr  = new DialogueManager(this.lore, this.state);
    this.encounterMgr = new EncounterEngine(this.lore, this.state);

    // Auto-save triggers: quest completion and game event start
    const doAutoSave = () => this.autoSave().catch(err => log.warn('Auto-save failed', err));
    this.bus.on(GameEvents.QUEST_COMPLETED,      doAutoSave);
    this.bus.on(GameEvents.GAME_EVENT_TRIGGERED, doAutoSave);
    this.bus.on(GameEvents.QUEST_COMPLETED, ({ questId }: { questId: string }) => {
      const def = this.lore.getQuest(questId);
      if (def) {
        enqueueQuestBanner(def.name, 'completed');
        showQuestOutcomeFlash(questId, def.name, def.type, 'completed');
        this._pendingQuestOutcomes.push({ name: def.name, outcome: 'completed' });
      }
    });
    this.bus.on(GameEvents.QUEST_FAILED, ({ questId }: { questId: string }) => {
      const def = this.lore.getQuest(questId);
      if (def) {
        enqueueQuestBanner(def.name, 'failed');
        showQuestOutcomeFlash(questId, def.name, def.type, 'failed');
        this._pendingQuestOutcomes.push({ name: def.name, outcome: 'failed' });
      }
    });
    // 放棄（ditch）與失敗走相同的 UI 回饋；出賣型放棄標示為背叛。
    // 注意：陣營信用扣減已由 QuestEngine.ditchQuest → FactionTreeEngine.onQuestDitch 直接處理，此處不可再觸發。
    this.bus.on(GameEvents.QUEST_DITCHED, ({ questId, isBetrayalDitch }: { questId: string; isBetrayalDitch?: boolean }) => {
      const def = this.lore.getQuest(questId);
      if (def) {
        const label = isBetrayalDitch ? `${def.name}（背叛）` : def.name;
        enqueueQuestBanner(label, 'failed');
        showQuestOutcomeFlash(questId, def.name, def.type, 'failed');
        this._pendingQuestOutcomes.push({ name: label, outcome: 'failed' });
      }
    });

    // Wire up BroadcastChannel so /console window can request full state
    listenForSyncRequests();
    listenForLogSyncRequests();

    // Register rewind callback so UI can call rewindAndResubmit via the store
    rewindAction.set((input: string) => this.rewindAndResubmit(input));
  }

  /** 將 StateManager 積累的獲取記錄轉成通知顯示。在每段敘事結束後呼叫。 */
  private flushAcquisitions(): void {
    for (const rec of this.state.drainAcquisitions()) {
      if (rec.type === 'item') {
        const item = this.lore.getItem(rec.itemId);
        const baseName = item?.name ?? rec.itemId;
        const variantLabel = rec.variantId ? item?.variants?.find(v => v.id === rec.variantId)?.label : undefined;
        showAcquisitionNotif(`獲得：${variantLabel ? `${baseName} - ${variantLabel}` : baseName}`, true);
        triggerInventoryGlow();
      } else if (rec.type === 'stat') {
        const [group, stat] = rec.key.split('.');
        if (group === 'statusStats') {
          // 狀態數值（體力/壓力/Endo）→ 條狀閃爍 + 就地 delta 提示
          if (stat === 'stamina' || stat === 'endo') {
            const valence = rec.delta > 0 ? 'good' : 'bad' as const;
            triggerBarFlash(stat, valence);
            showStatDelta(stat, rec.delta, valence);
          } else if (stat === 'stress') {
            const valence = (rec.delta > 0 ? 'bad' : 'good') as 'good' | 'bad';
            triggerBarFlash(stat, valence);
            showStatDelta(stat, rec.delta, valence);
          }
        } else {
          // 技能數值（primaryStats / secondaryStats）→ 顯示 notif
          const label = STAT_LABELS[group]?.[stat] ?? stat;
          showAcquisitionNotif(`${label} ${rec.delta > 0 ? '+' : ''}${rec.delta}`, rec.delta > 0);
        }
      } else if (rec.type === 'melphin') {
        const valence = rec.delta > 0 ? 'good' : 'bad' as const;
        triggerMelphinFlash(valence);
        showStatDelta('melphin', rec.delta, valence);
      } else if (rec.type === 'reputation') {
        showStatDelta(`rep:${rec.factionId}`, rec.delta, rec.delta > 0 ? 'good' : 'bad');
      } else if (rec.type === 'affinity') {
        showStatDelta(`aff:${rec.npcId}`, rec.delta, rec.delta > 0 ? 'good' : 'bad');
      } else if (rec.type === 'skillExp') {
        const statLabel = STAT_LABELS['primaryStats']?.[rec.statKey] ?? rec.statKey;
        if (rec.levelUps > 0) {
          const stats = this.state.getState().player.primaryStats as unknown as Record<string, number>;
          const newLevel = stats[rec.statKey] ?? '?';
          showAcquisitionNotif(`${statLabel} 提升至 Lv ${newLevel}！`, true);
        } else {
          showAcquisitionNotif(`${statLabel} +${rec.finalAmount} XP`, true);
        }
      } else if (rec.type === 'characterExp') {
        showAcquisitionNotif(`角色經驗 +${rec.delta}`, true);
      } else if (rec.type === 'intel') {
        const intel = this.lore.getIntel(rec.intelId);
        showAcquisitionNotif(`情報：${intel?.label ?? rec.intelId}`, true);
        triggerSelfCheckGlow();
      }
    }
  }

  // -- Public API -------------------------------------------------------

  loadLore(data: Parameters<LoreVault['load']>[0]): void {
    this.lore.load(data);
    // Refresh schedule for current region after lore load
    this.events.setSchedule(this.lore.getSchedule(this.currentRegionId) ?? null);
    // 門禁設定（同步門禁旗標的唯一來源）
    this.state.setCurfewConfig(this.lore.getSchedule(this.currentRegionId)?.curfew);
  }

  loadStarter(config: StarterConfig): void {
    this.starterConfig = config;
    // Patch the live state directly — loadStarter is called after construction
    // but before start(), so no turns have been played yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = this.state.getState() as any;
    s.player.origin                = config.player.origin;
    s.player.currentLocationId     = config.world.startLocationId;
    Object.assign(s.player.primaryStats,   config.player.primaryStats);
    Object.assign(s.player.secondaryStats, config.player.secondaryStats);
    Object.assign(s.player.statusStats, { ...config.player.statusStats, experience: 0 });
    s.player.knownIntelIds = [...config.player.knownIntelIds];
    s.player.inventory     = config.player.inventory.map((raw: string, idx: number) => {
      const parsed = parseItemGrantString(raw);
      const inv: import('../types/item').InventoryItem = {
        instanceId:       `${parsed.itemId}_${idx}`,
        itemId:           parsed.itemId,
        obtainedAtMinute: 0,
        quantity:         1,
        isExpired:        false,
      };
      // Only apply overrides if the base item is marked as isTemplate
      if (parsed.overrides) {
        const baseItem = this.lore.getItem(parsed.itemId);
        if (baseItem?.isTemplate && baseItem.type !== 'key') {
          inv.itemOverrides = parsed.overrides;
        } else {
          log.warn('Inline overrides ignored — base item is not a template or is a key item', { itemId: parsed.itemId });
        }
      }
      return inv;
    });
    if (config.player.title) s.player.titles = [config.player.title];
    s.time = { ...config.world.startTime, totalMinutes: 0 };
    s.timePeriod = config.world.startPeriod;
    s.worldPhase.currentPhase    = config.world.worldPhase;
    s.worldPhase.appliedPhaseIds = [config.world.worldPhase];
    for (const flag of config.world.startingFlags) this.state.flags.set(flag);
  }

  /**
   * Reset to a clean initial state before starting a fresh new game.
   * Must be called before start() when re-using the same GameController instance
   * (e.g. returning to title from a debug session then starting a new game).
   * Not needed inside debugResetGame() which has its own loadState + loadStarter flow.
   */
  resetForNewGame(): void {
    this.loadState(this.buildInitialState(), []);
    if (this.starterConfig) this.loadStarter(this.starterConfig);
    this._pendingQuestOutcomes = [];
    this._stagedQuestOutcomes  = [];
  }

  async start(playerName?: string): Promise<void> {
    if (playerName?.trim()) {
      this.state.setPlayerName(playerName.trim());
    }
    const gs = this.state.getState();
    this.state.discoverLocation(gs.player.currentLocationId);
    log.info('Game started', { turn: gs.turn, location: gs.player.currentLocationId });

    // Grant origin quests based on player's starting background
    this.quests.autoGrantOriginQuests(gs.player.origin);

    // Sync UI after quests are granted so the quest block renders on first load
    this.syncUIState(this.state.getState());

    if (this.mockMode) {
      log.warn('Running in mock mode -- no LLM client configured');
      this.runMockIntro();
      this.markSaved();
      return;
    }

    // Pre-warm model in background; first DM call benefits from it
    if (this.dmClient) warmUpModel(this.dmClient).catch(() => { /* non-fatal */ });

    const sceneCtx = this.buildSceneCtx([]);
    const { suggestions } = await this.runDM({ type: 'examine', input: '(game start)' }, sceneCtx);
    await this.refreshThoughts(suggestions);
    // 新遊戲開場完成即為基準：玩家未做任何行動就關閉不需提示
    this.markSaved();
  }

  /**
   * 使用消耗品物品。立即套用效果，並向 DM 發送沉默行動進行敘述。
   * MVP 採用樂觀套用（engine-side deterministic），不等待 DM 確認。
   */
  async useItem(instanceId: string): Promise<void> {
    if (get(inputDisabled)) return;
    const gs      = this.state.getState();
    const invItem = gs.player.inventory.find(i => i.instanceId === instanceId);
    if (!invItem) return;
    const itemDef = this.lore.getResolvedItem(invItem.itemId);
    if (!itemDef) return;

    // Info items open reading modal instead of consuming
    if (itemDef.type === 'info') {
      const display = this.lore.resolveItemDisplay(invItem);
      loreItemOpen.set({ name: display.name, content: display.content ?? '' });
      return;
    }

    if (itemDef.type !== 'consumable') return;

    // Safeguard: only consume if the item has at least one defined effect.
    // Items like empty_bottle exist as consumables but have no effect — they
    // should not be silently consumed. Instead, narrate via fallbackDescription.
    const fx = itemDef.effect;
    const hasEffect = !!(fx && (
      fx.statusChanges?.stamina !== undefined ||
      fx.statusChanges?.endo    !== undefined ||
      fx.statusChanges?.stress  !== undefined ||
      fx.applyConditionId ||
      fx.removeConditionIds?.length ||
      fx.yieldsItemId ||
      fx.flagsSet?.length ||
      fx.flagsUnset?.length
    ));

    const silentInput = hasEffect
      ? `玩家使用了物品：${itemDef.name}`
      : `玩家嘗試使用物品：${itemDef.name}`;

    inputDisabled.set(true);
    try {
      const baseCtx = this.buildSceneCtx([]);

      if (!hasEffect) {
        // Don't consume — tell DM why it can't be used
        const fallback = itemDef.fallbackDescription
          ?? `${itemDef.name}目前無法直接使用。`;
        const sceneCtx = baseCtx + `\n\n## Item Use Attempt (no effect)\nItem: ${itemDef.name}\n${fallback}`;
        const { suggestions } = await this.runDM({ type: 'use', input: silentInput }, sceneCtx);
        await this.refreshThoughts(suggestions);
        return;
      }

      // Apply effect immediately
      this.state.consumeItem(instanceId, itemDef.effect ?? {}, id => this.lore.getCondition(id), id => this.lore.getItem(id));
      showAcquisitionNotif(`使用：${itemDef.name}`, false);
      this.flushAcquisitions();
      this.syncUIState(this.state.getState());

      const sceneCtx = itemDef.useNarrative
        ? baseCtx + `\n\n## Item Use Narrative\n${itemDef.useNarrative}`
        : baseCtx;
      const { suggestions } = await this.runDM({ type: 'use', input: silentInput }, sceneCtx);
      this.quests.checkObjectives();
      this.syncUIState(this.state.getState());
      this.flushAcquisitions();
      await this.refreshThoughts(suggestions);
    } finally {
      this.releaseInput();
    }
  }

  /**
   * Grant a template item instance to the player.
   * Takes a base item (isTemplate: true) and applies per-instance overrides.
   * Each call creates a unique inventory instance with different content.
   * Also usable by DM signals to grant dynamically-defined items.
   */
  grantTemplateItem(
    baseItemId: string,
    overrides: { name?: string; description?: string; content?: string },
    onceFlag?: string,
  ): boolean {
    const baseItem = this.lore.getItem(baseItemId);
    if (!baseItem || !baseItem.isTemplate || baseItem.type === 'key') return false;
    if (onceFlag && this.state.flags.has(onceFlag)) return false;

    const gs = this.state.getState();
    this.state.addTemplateItem(baseItemId, overrides, gs.time.totalMinutes);
    if (onceFlag) this.state.flags.set(onceFlag);
    return true;
  }

  /**
   * 丟棄物品實例（關鍵物品不可丟棄）。
   * count 省略或為 1 時整堆移除；堆疊物品可傳入小於 quantity 的數量只移除部分。
   */
  discardItem(instanceId: string, count?: number): boolean {
    const gs      = this.state.getState();
    const invItem = gs.player.inventory.find(i => i.instanceId === instanceId);
    if (!invItem) return false;
    const itemDef = this.lore.getItem(invItem.itemId);
    if (!itemDef || itemDef.type === 'key') return false;

    const n = count ?? invItem.quantity;
    const removed = n >= invItem.quantity
      ? this.state.removeItem(instanceId)
      : this.state.removeItemQuantity(instanceId, n);
    if (removed) {
      showAcquisitionNotif(`丟棄：${itemDef.name}`, false);
      this.syncUIState(this.state.getState());
      log.info('Item discarded', { instanceId, itemId: invItem.itemId, count: n });
    }
    return removed;
  }

  /** 除錯用：直接將道具加入物品欄，遵守 stackable/maxStack 規則。 */
  debugAddItem(itemId: string, variantId?: string): void {
    const def = this.lore.getItem(itemId);
    if (!def) return;
    const gs = this.state.getState();
    this.state.addItem(itemId, gs.time.totalMinutes, variantId, {
      stackable:           def.stackable ?? false,
      maxStack:            def.maxStack,
      maxUsesPerInstance:  def.maxUsesPerInstance,
    });
    this.syncUIState(this.state.getState());
  }

  /** 除錯用：建立樣板道具實例（如字條），可自訂名稱/描述/內容。 */
  debugAddTemplateItem(baseItemId: string, overrides: { name?: string; description?: string; content?: string }): void {
    const def = this.lore.getItem(baseItemId);
    if (!def || !def.isTemplate) return;
    const gs = this.state.getState();
    this.state.addTemplateItem(baseItemId, overrides, gs.time.totalMinutes);
    this.syncUIState(this.state.getState());
  }

  async submitAction(input: string, actionType?: ActionType, targetId?: string, targetKind?: ActionTargetKind, silent?: boolean): Promise<void> {
    if (!input.trim()) return;

    const action: PlayerAction = { type: actionType ?? 'free', input: input.trim(), targetId, targetKind };
    inputDisabled.set(true);

    // Bug A 分流保險：對話進行中，若送出的是非對話類動作（examine/move/rest 等 —
    // 例如點了一個殘留的探索想法候選），先結束對話再當作一般行動處理，
    // 而不是把它當成對 NPC 說的話塞進對話 LLM（來源修正見 snapshotThoughtsBeforeDialogue）。
    const dialogueBeforeAction = get(activeNpcUI);
    if (dialogueBeforeAction && !get(activeScriptedDialogue)) {
      const isConversational = !actionType || actionType === 'free'
        || (actionType === 'interact' && targetId === dialogueBeforeAction.npcId);
      if (!isConversational) {
        await this.forceCloseDialogue(dialogueBeforeAction.npcId);
      }
    }

    const inDialogue = !!get(activeNpcUI) && !get(activeScriptedDialogue);
    if (!silent) {
      previousSnapshot.set({
        gameState:      JSON.parse(JSON.stringify(this.state.getState())),
        flags:          this.state.flags.toArray(),
        activeFlags:    [...this.state.getState().player.activeFlags],
        narrativeLines: get(narrativeLines),
        originalInput:  input.trim(),
      });
      pushLine(inDialogue ? '「' + input.trim() + '」' : '> ' + input, inDialogue ? 'player-dialogue' : 'player');
    }

    if (this.mockMode) {
      await this.runMockResponse(input);
      inputDisabled.set(false);
      return;
    }

    // 1a. Encounter routing — bypass Regulator if in active structured encounter
    const gs0pre = this.state.getState();
    if (gs0pre.phase === 'event' && gs0pre.activeEncounter) {
      await this.handleEncounterInput(input.trim());
      this.releaseInput();
      return;
    }

    // 1b. Dialogue encounter routing — bypass Regulator if in active NPC encounter
    //    (guard: skip if scripted dialogue is currently showing choices)
    const currentEncounter = get(activeNpcUI);
    if (currentEncounter && !get(activeScriptedDialogue)) {
      if (this.detectLeaveIntent(input.trim())) {
        await this.forceCloseDialogue(currentEncounter.npcId);
        inputDisabled.set(false);
        return;
      }
      await this.handleDialogueInput(input.trim(), currentEncounter.npcId);
      inputDisabled.set(false);
      return;
    }

    // 2. Regulator validation
    log.debug('Action submitted', { input });
    const gs0reg = this.state.getState();

    // 顯示等待指示器（在 Regulator 非同步驗證之前），後續由 Phase 2 替換
    const thinkingLineId = pushLine('···', 'system');

    // ── Trace: start exploration turn ───────────────────────────────────
    const traceId = startTrace(gs0reg.turn, 'exploration', `${actionType ?? 'free'}: ${input.slice(0, 60)}`, {
      locationId: gs0reg.player.currentLocationId,
    });
    addTracePhase(traceId, 'input', { type: actionType ?? 'free', input, targetId, targetKind });

    const resolvedForReg = this.lore.resolveLocation(gs0reg.player.currentLocationId, this.state.flags, gs0reg.timePeriod);
    const sceneNpcsForReg = (resolvedForReg?.npcIds ?? []).map(id => ({
      id,
      name: this.lore.getNPC(id)?.name ?? id,
    }));
    const invNamesForReg = gs0reg.player.inventory
      .filter(i => !i.isExpired)
      .map(i => {
        const def = this.lore.getItem(i.itemId);
        const name = def?.name ?? i.itemId;
        const variant = i.variantId ? def?.variants?.find(v => v.id === i.variantId)?.label : undefined;
        return variant ? `${name}（${variant}）` : name;
      });
    const scenePropsForReg = this.lore.getVisiblePropsForLocation(
      gs0reg.player.currentLocationId, this.state.flags, gs0reg.timePeriod,
      gs0reg.player.knownIntelIds, Object.values(gs0reg.activeQuests), gs0reg.time,
      gs0reg.player.inventory, gs0reg.player.melphin,
    ).map(p => {
      const itemNames = this.lore.getAvailableItemNamesForProp(p, this.state.flags, this.state.getPropFlags(p.id));
      return {
        id: p.id,
        name: p.name,
        ...(p.interactable && p.interaction ? { action: p.interactLabel ?? '互動' } : {}),
        ...(itemNames.length > 0 ? { items: itemNames } : {}),
      };
    });
    const result = await this.regulator.validate(action, gs0reg.player, sceneNpcsForReg, invNamesForReg, scenePropsForReg, this.buildClockContext());

    // ── Trace: regulator result ──────────────────────────────────────────
    addTracePhase(traceId, 'regulator', {
      allowed: result.allowed,
      reason:  result.reason,
      modifiedAction: result.modifiedAction,
    }, { raw: this.regulator.lastRaw || undefined });

    // 第四面牆提問／越權請求：只顯示系統訊息。不推進時間、不改狀態、不寫歷史、
    // 不觸發事件、不呼叫 DM，想法候選維持原樣。
    if (result.inputCategory) {
      log.info('Non-action input', { input, category: result.inputCategory });
      let text = OUT_OF_BOUNDS_MESSAGE;
      if (result.inputCategory === 'meta') {
        text = '【系統】' + await this.regulator.answerMeta(input.trim());
      }
      narrativeLines.update(lines => lines.filter(l => l.id !== thinkingLineId));
      pushLine(text, 'meta');
      inputDisabled.set(false);
      return;
    }

    if (!result.allowed) {
      log.info('Action rejected', { input, reason: result.reason });
      narrativeLines.update(lines => lines.filter(l => l.id !== thinkingLineId));
      pushLine(result.reason ?? 'That is not possible.', 'rejected');
      // Even on rejection, check endings — stress/stamina may have changed from
      // events or condition ticks earlier, and a blocking Regulator should not
      // prevent the game from reaching its ending state.
      if (this.checkEndingConditions()) return;
      inputDisabled.set(false);
      return;
    }

    const finalAction = result.modifiedAction ?? action;

    // ── Trace: update label with resolved action type ────────────────────
    if (finalAction.type !== (actionType ?? 'free')) {
      updateTraceLabel(traceId, `${finalAction.type}: ${input.slice(0, 60)}`);
    }

    // Track active NPC panel — clear when moving
    if (finalAction.type === 'move') {
      activeNpcUI.set(null);
      encounterSessionLog.set([]);
      this._sessionFiredTriggers.clear(); this._scriptedFiredThisSession = false;
    }

    // Intercept rest — open modal instead of going through DM pipeline.
    // Applies regardless of whether the action came from a Thought or manual text input.
    if (finalAction.type === 'rest') {
      narrativeLines.update(lines => lines.filter(l => l.id !== thinkingLineId));
      // 休息時長預填：優先採用 Regulator（LLM）換算的 restMinutes，否則退回確定性解析
      this.openRestModal(input, result.restMinutes);
      inputDisabled.set(false);
      return;
    }

    // 想法候選點選的移動：目的地 id 由引擎產生（buildBaseThoughts），不再交 DM Phase 1 從描述猜。
    // 只採用呼叫端原本帶入的 targetId（不採 Regulator 改寫後的 targetId）；自由輸入的移動仍走 LLM 路徑。
    const directMoveTargetId = actionType === 'move' && targetId && finalAction.type === 'move'
      ? targetId
      : undefined;
    if (directMoveTargetId) {
      const blockedMessage = this.getDirectMoveBlockedMessage(directMoveTargetId);
      if (blockedMessage) {
        log.info('Direct move blocked', { targetId: directMoveTargetId, reason: blockedMessage });
        addTracePhase(traceId, 'resolution', { move: undefined, reasoning: `direct move blocked: ${blockedMessage}` });
        narrativeLines.update(lines => lines.filter(l => l.id !== thinkingLineId));
        pushLine(blockedMessage, 'rejected');
        if (this.checkEndingConditions()) return;
        inputDisabled.set(false);
        return;
      }
    }

    // 1.5. Check for scripted dialogue trigger when player interacts with a scene NPC.
    // Regulator sets type="interact" + targetId when player names a specific NPC.
    const resolvedSceneNpcIds = this.lore.getNPCsByIds(
      this.lore.resolveLocation(this.state.getState().player.currentLocationId, this.state.flags, this.state.getState().timePeriod)?.npcIds ?? [],
      this.state.flags,
      this.state.getState().timePeriod,
    ).map(n => n.id);
    if (finalAction.type === 'interact' && finalAction.targetId && resolvedSceneNpcIds.includes(finalAction.targetId)) {
      const npc = this.lore.resolveNPC(finalAction.targetId, this.state.flags, this.state.getState().timePeriod);
      if (npc) {
        const interactionCount =
          this.state.getState().npcMemory[finalAction.targetId]?.interactionCount ?? 0;
        const scripted = this.dialogueMgr.checkScriptedTrigger(
          finalAction.targetId, npc.activeDialogueId, this.state.flags, interactionCount,
          this._sessionFiredTriggers,
        );
        if (scripted) {
          narrativeLines.update(lines => lines.filter(l => l.id !== thinkingLineId));
          this._sessionFiredTriggers.add(scripted.nodeId);
          this.updateActiveNpcUI(finalAction.targetId);
          await this.activateScriptedNode(
            finalAction.targetId, scripted.dialogueId, npc.name,
            scripted.nodeId, scripted.node, scripted.endAfterScript,
          );
          inputDisabled.set(false);
          return; // Skip normal turn pipeline — scripted dialogue takes over
        }
      }
    }

    // 2. Tick conditions
    this.state.tickConditions(id => this.lore.getCondition(id));

    // 2.5. Advance in-game time (default amount for event/period detection)
    // action.type is a context hint only — use a neutral default here.
    // resolution.timeMinutes (from Judge) is the authoritative cost and corrects this later.
    const gs0            = this.state.getState();
    const initialTime    = { ...gs0.time };
    const schedule       = this.lore.getSchedule(this.currentRegionId) ?? null;
    const defaultMinutes = 10;
    const newTime   = this.timeMgr.advance(gs0.time, defaultMinutes);
    const newPeriod = schedule
      ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs0.player.activeFlags)
      : gs0.timePeriod;
    const periodChanged  = this.state.advanceTime(newTime, newPeriod);
    this.state.tickItemExpiry(id => this.lore.getItem(id)?.expiresAfterMinutes);
    const crossedHours   = this.timeMgr.computeCrossedHours(initialTime, newTime);

    // 疲勞累積：每跨越 FATIGUE_PERIOD_MINUTES（6h）增加 1 點疲勞（上限 5）
    {
      const fp = GameController.FATIGUE_PERIOD_MINUTES;
      const crossed6h = Math.floor(newTime.totalMinutes / fp) - Math.floor(initialTime.totalMinutes / fp);
      if (crossed6h > 0) {
        const cur = this.state.getState().player.statusStats.fatigue ?? 0;
        const delta = Math.min(crossed6h, 5 - cur);
        if (delta > 0) this.state.modifyStat('statusStats.fatigue', delta);
      }
    }

    // Guard: Day 0 suppression.
    // The player starts mid-day-zero (e.g., 21:43). No lore events fire until the clock
    // first crosses midnight (hour 0), which marks the start of Day 1.
    // forceEvent() (debug) bypasses this guard independently.
    if (!this.state.flags.has('game_day1_started') && crossedHours.includes(0)) {
      this.state.flags.set('game_day1_started');
    }
    const eventsEnabled = this.state.flags.has('game_day1_started');

    // Daily prop reset: clear dailyResetFlags on all props at each midnight crossing.
    if (crossedHours.includes(0)) {
      for (const prop of this.lore.getAllProps()) {
        for (const flag of prop.dailyResetFlags ?? []) {
          this.state.unsetPropFlag(prop.id, flag);
        }
      }
    }

    // 2.5. Check quest fail conditions (time-based auto-fail before event sweep)
    const questFailTriggered = eventsEnabled
      ? this.checkQuestFailConditions(crossedHours)
      : [];

    // 3. Check global events (period transitions, broadcasts, hour-based triggers)
    const globalTriggered = eventsEnabled
      ? this.events.checkGlobalEvents(this.currentRegionId, crossedHours)
      : [];

    // 3.5. Check location events
    const locationTriggered = eventsEnabled
      ? this.events.checkAndApply(this.state.getState().player.currentLocationId, crossedHours)
      : [];
    const triggered = [...questFailTriggered, ...globalTriggered, ...locationTriggered];

    const { eventEncounters, extraTriggered } = this.processTriggeredEvents(triggered);
    // Merge sub-events (e.g. from failQuest -> startEventId chains) so DM narration covers them.
    const allTriggered = [...triggered, ...extraTriggered];

    // 4. DM narration
    // NPC dialogue (ongoing) is handled by the early exit at the top of submitAction.
    // New dialogue encounters are initiated via resolution.encounter (line ~554).

    // 4.1. Narrate triggered events in a separate DM pass BEFORE the player-action DM.
    // This keeps event narration and action response from bleeding together.
    if (allTriggered.length > 0) {
      const eventCtx = this.buildSceneCtx(allTriggered, periodChanged);
      const hasNotification = allTriggered.some(t => t.notification);
      await this.runEventDM(eventCtx, hasNotification ? 'event' : 'narrative');
      this.flushAcquisitions();
    }

    // 4.15. Launch event-triggered encounters/NPC dialogues AFTER narration so event text plays first.
    // All encounters are queued; the first starts immediately, the rest fire as each concludes.
    // NPC dialogues (startNpcDialogue) are enqueued in _npcDialogueQueue by processTriggeredEvents.
    if (eventEncounters.length > 0 || this._npcDialogueQueue.length > 0) {
      narrativeLines.update(lines => lines.filter(l => l.id !== thinkingLineId));
      for (const enc of eventEncounters) this.enqueueEncounter(enc.id, enc.def ?? undefined);
      await this.startNextQueuedEncounter();
      this.flushAcquisitions();
      if (this.checkEndingConditions()) return;
      this.releaseInput();
      return;
    }

    // 4.16. Process prop interaction effects (itemGrants, eventIds, encounterId).
    // Runs deterministically after global events so event encounters don't block prop processing.
    const propCtx = await this.applyPropInteract(finalAction);
    if (propCtx === null) {
      // A prop-triggered encounter took over — it handles its own narration.
      this.flushAcquisitions();
      if (this.checkEndingConditions()) return;
      this.releaseInput();
      return;
    }

    // 4.2. Player action DM — events already narrated above, so triggered is empty here.
    const sceneCtx = this.buildSceneCtx([], periodChanged, finalAction, initialTime) + propCtx;
    const navHint  = this.buildNavHint(finalAction);

    // ── Trace: scene context ─────────────────────────────────────────────
    addTracePhase(traceId, 'context', sceneCtx + navHint);

    const { resolution, suggestions } = await this.runDM(finalAction, sceneCtx + navHint, traceId, thinkingLineId, initialTime, directMoveTargetId);
    this.flushAcquisitions();

    // 4.4a. Attempt encounter interception: runDM may have detected an attempt encounter
    //       when the move path was blocked. If so, start the encounter now.
    const attemptSignal = (resolution as any)._attemptEncounter as
      { encounterId: string; connectionKey: string; cooldownMinutes?: number; totalMinutes: number } | undefined;
    if (attemptSignal) {
      log.info('Attempt encounter intercepted', { encounterId: attemptSignal.encounterId });
      if (attemptSignal.cooldownMinutes) {
        this.state.setAttemptCooldown(attemptSignal.connectionKey, attemptSignal.totalMinutes);
      }
      this.enqueueEncounter(attemptSignal.encounterId);
      await this.startNextQueuedEncounter();
      this.flushAcquisitions();
      if (this.checkEndingConditions()) return;
      this.releaseInput();
      return;
    }

    // 4.5. Apply extra time if resolution exceeds the default advance (e.g., sleeping 8 h).
    // Downward correction (resolution < default) is deferred — TimeManager.advance() only
    // supports positive values. Over-advance by a few minutes is acceptable for now.
    // runDM 1c 若因定時事件截斷了長時間行動，直接採用截斷後的總時長（已含狀態乘數）。
    const timeCostMultiplier = this.getActionTimeCostMultiplier();
    const forcedEffective = (resolution as TurnResolution & { _forcedEffectiveMinutes?: number })._forcedEffectiveMinutes;
    const effectiveResolutionTime = forcedEffective != null
      ? forcedEffective
      : resolution.timeMinutes != null
        ? Math.round(resolution.timeMinutes * timeCostMultiplier)
        : null;
    if (effectiveResolutionTime != null && effectiveResolutionTime > defaultMinutes) {
      const extra       = effectiveResolutionTime - defaultMinutes;
      const gs1         = this.state.getState();
      const lateStartTime = { ...gs1.time };
      const laterTime   = this.timeMgr.advance(gs1.time, extra);
      const laterPeriod = schedule
        ? this.timeMgr.getCurrentPeriod(laterTime, schedule, gs1.player.activeFlags)
        : gs1.timePeriod;
      const latePeriodChanged = this.state.advanceTime(laterTime, laterPeriod);
      this.state.tickItemExpiry(id => this.lore.getItem(id)?.expiresAfterMinutes);
      // Fire time-based global events for any additional hours crossed during extended sleep
      const extraCrossed = this.timeMgr.computeCrossedHours(lateStartTime, laterTime);
      if (extraCrossed.length > 0) {
        // Also check for first midnight crossing during extended sleep
        if (!this.state.flags.has('game_day1_started') && extraCrossed.includes(0)) {
          this.state.flags.set('game_day1_started');
        }
        if (extraCrossed.includes(0)) {
          for (const prop of this.lore.getAllProps()) {
            for (const flag of prop.dailyResetFlags ?? []) {
              this.state.unsetPropFlag(prop.id, flag);
            }
          }
        }
        const lateEventsEnabled = this.state.flags.has('game_day1_started');
        const lateQuestFail = lateEventsEnabled ? this.checkQuestFailConditions(extraCrossed) : [];
        const lateGlobal    = lateEventsEnabled ? this.events.checkGlobalEvents(this.currentRegionId, extraCrossed) : [];
        const lateLocation  = lateEventsEnabled ? this.events.checkAndApply(this.state.getState().player.currentLocationId, extraCrossed) : [];
        const lateTriggered = [...lateQuestFail, ...lateGlobal, ...lateLocation];
        const { eventEncounters: lateEventEncounters, extraTriggered: lateExtra } =
          this.processTriggeredEvents(lateTriggered);
        const allLateTriggered = [...lateTriggered, ...lateExtra];

        if (allLateTriggered.length > 0) {
          const lateEventCtx = this.buildSceneCtx(allLateTriggered, latePeriodChanged);
          const hasNotification = allLateTriggered.some(t => t.notification);
          await this.runEventDM(lateEventCtx, hasNotification ? 'event' : 'narrative');
          this.flushAcquisitions();
        }

        if (lateEventEncounters.length > 0 || this._npcDialogueQueue.length > 0) {
          for (const enc of lateEventEncounters) this.enqueueEncounter(enc.id, enc.def ?? undefined);
          await this.startNextQueuedEncounter();
          this.flushAcquisitions();
          if (this.checkEndingConditions()) return;
          this.releaseInput();
          return;
        }
      }
    }

    // 4.6. Process automatic flag unsets (FlagManifest unsetCondition)
    const autoUnset = this.lore.flagRegistry.processFlagUnsets(this.state.flags);
    if (autoUnset.length > 0) log.debug('Auto-unset flags', { flags: autoUnset });

    // 5-7. Post-narration systems
    this.quests.checkTimeLimits(this.state.getState().time.totalMinutes);
    this.quests.checkObjectives();
    this.quests.checkPendingRepeats();
    this.phases.checkAdvance();
    this.syncUIState(this.state.getState());
    this.flushAcquisitions();
    await this.refreshThoughts(suggestions);

    // Handle encounter from resolution (after normal post-DM processing completes)
    const enc = resolution.encounter;
    if (enc) {
      if (enc.type === 'dialogue' && enc.npcId) {
        this.updateActiveNpcUI(enc.npcId);
        // Check scripted trigger before falling through to LLM opener
        const encNpc = this.lore.resolveNPC(enc.npcId, this.state.flags, this.state.getState().timePeriod);
        if (encNpc) {
          const encInteractionCount = this.state.getState().npcMemory[enc.npcId]?.interactionCount ?? 0;
          const encScripted = this.dialogueMgr.checkScriptedTrigger(
            enc.npcId, encNpc.activeDialogueId, this.state.flags, encInteractionCount,
            this._sessionFiredTriggers,
          );
          if (encScripted) {
            this._sessionFiredTriggers.add(encScripted.nodeId);
            await this.activateScriptedNode(
              enc.npcId, encScripted.dialogueId, encNpc.name,
              encScripted.nodeId, encScripted.node, encScripted.endAfterScript,
            );
            inputDisabled.set(false);
            return;
          }
        }
        await this.handleDialogueInput('(opener)', enc.npcId, true);
        inputDisabled.set(false);
      } else if (enc.type === 'event' && enc.encounterId) {
        this.enqueueEncounter(enc.encounterId);
        await this.startNextQueuedEncounter();
        this.flushAcquisitions();
        this.releaseInput();
      }
    }

    // Auto-save on day change
    if (this.state.getState().time.day !== gs0.time.day) {
      this.autoSave().catch(err => log.warn('Auto-save (day change) failed', err));
    }

    // Promote quest outcomes: pending (this turn) → staged (available for next turn's DM context).
    this._stagedQuestOutcomes = [...this._stagedQuestOutcomes, ...this._pendingQuestOutcomes];
    this._pendingQuestOutcomes = [];

    if (!this.checkEndingConditions() && !enc) this.releaseInput();
  }

  acceptQuest(questId: string): boolean {
    return this.quests.acceptQuest(questId);
  }

  ditchQuest(questId: string): boolean {
    const result = this.quests.ditchQuest(questId);
    if (result) this.syncUIState(this.state.getState());
    return result;
  }

  /**
   * 玩家主動放棄任務（MVP v1 Abandon）。
   * 非主線任務可放棄，結果等同 fail，套用 onFail / onFailDefault。
   */
  abandonQuest(questId: string): boolean {
    const result = this.quests.abandonQuest(questId);
    if (result) this.syncUIState(this.state.getState());
    return result;
  }

  // -- Rest -------------------------------------------------------

  /**
   * 開啟休息 Modal。分類當前休息情境並設定 store。
   * 由 UI 在玩家選擇休息動作時呼叫。
   * @param playerInput 玩家原始輸入；若其中指定了時長（「睡五個小時」「睡到早上六點」），預填至 Modal
   * @param llmMinutes Regulator（LLM）依時刻表換算的預計休息分鐘數；優先於 playerInput 的確定性解析
   * @returns false 表示疲勞不足（< 3），無法休息
   */
  openRestModal(playerInput?: string, llmMinutes?: number): boolean {
    const gs = this.state.getState();
    const fatigue = gs.player.statusStats.fatigue ?? 0;
    if (fatigue < 3) {
      pushLine('你還不夠疲勞，無法入睡。', 'system');
      return false;
    }
    const restCtx = this.classifyRestContext();
    const canFullRest = restCtx.mode === 'full_available';
    const presetOpts = { canFullRest, scuffedMaxMinutes: restCtx.maxTimeMinutes };
    // LLM 換算值優先；超出 UI 範圍或未提供時退回確定性解析（Thought 點選路徑不經 LLM）
    const llmPreset = llmMinutes != null ? resolveRestPreset(llmMinutes, presetOpts) : null;
    const presetMinutes = llmPreset ?? (playerInput
      ? resolveRestPreset(parseRestDurationMinutes(playerInput, gs.time), presetOpts)
      : null);
    restModalOpen.set({
      canFullRest,
      scuffedMaxMinutes:  restCtx.maxTimeMinutes,
      ...(presetMinutes !== null ? { presetMinutes } : {}),
    });
    return true;
  }

  /**
   * 執行休息：計算結果、套用數值、推進時間、設定結果 overlay。
   * 由 RestModal 在玩家確認時長後呼叫。
   * DM 敘述將在 overlay 關閉後由 narrateRestResult() 觸發。
   * @returns RestResult 結果資料
   */
  executeRest(plannedMinutes: number): RestResult {
    const gs       = this.state.getState();
    const restCtx  = this.classifyRestContext();
    const s        = gs.player.statusStats;
    const schedule = this.lore.getSchedule(this.currentRegionId) ?? null;

    const resolveArgs = {
      restCtx,
      stamina:    s.stamina,
      staminaMax: s.staminaMax,
      stress:     s.stress,
      stressMax:  s.stressMax,
      fatigue:    s.fatigue ?? 0,
    };

    // ── Rest-start event check ────────────────────────────────────────────────
    // Check for events that should trigger when rest begins, before time advance.
    // If any fire, skip normal resolution and force a minimal "couldn't sleep" outcome.
    const restStartTriggered = this.events.checkRestStartEvents(
      this.currentRegionId,
      gs.player.currentLocationId,
    );
    const hasRestStartInterrupt = restStartTriggered.length > 0;
    let restEncounterIds: string[] = [];
    let restStartExtra: TriggeredEvent[] = [];
    if (hasRestStartInterrupt) {
      const { eventEncounters, extraTriggered } = this.processTriggeredEvents(restStartTriggered);
      restEncounterIds = eventEncounters.map(e => e.id);
      restStartExtra = extraTriggered;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Initial resolve to get projected actual duration
    const fullResult = RestResolver.resolve({ plannedMinutes, ...resolveArgs });

    // ── Sleep interrupt detection ─────────────────────────────────────────────
    // Scan crossed hours to find the earliest triggerHours event. If found,
    // truncate sleep so the player wakes up at that boundary instead.
    // Skipped when rest_start already interrupted (player never fell asleep).
    let interruptMinutes: number | null = null;
    if (!hasRestStartInterrupt) {
      interruptMinutes = this.peekTimedInterruptOffset(fullResult.actualMinutes);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Determine final rest result:
    //   rest_start interrupt → force minimal "couldn't sleep" outcome
    //   hourly interrupt     → re-resolve with truncated duration
    //   normal               → use full projected result
    const result = hasRestStartInterrupt
      ? GameController.buildRestStartInterruptResult(plannedMinutes, s.staminaMax)
      : interruptMinutes !== null
        // 中斷：停點必須精確落在觸發點，不可再疊加 bias/noise；品質沿用預估結果
        ? RestResolver.resolve({
            plannedMinutes,
            ...resolveArgs,
            forcedActualMinutes: interruptMinutes,
            forcedQuality:       fullResult.quality,
          })
        : fullResult;

    // Apply stat changes (stamina recovery + stress reduction)
    if (result.staminaDelta !== 0) {
      this.state.modifyStat('statusStats.stamina', result.staminaDelta);
    }
    if (result.stressDelta !== 0) {
      this.state.modifyStat('statusStats.stress', result.stressDelta);
    }
    // Apply fatigue change (rest always brings fatigue ≤ 2)
    if (result.fatigueDelta !== 0) {
      this.state.modifyStat('statusStats.fatigue', result.fatigueDelta);
    }

    // 依休息品質移除可被治癒的狀態（如扭傷、輕微流血）。
    // 每個 condition 在定義中聲明 curedByRestQuality，此處直接比對並移除，不依賴旗標。
    for (const c of this.state.getState().player.conditions) {
      const def = this.lore.getCondition(c.id);
      if (def?.curedByRestQuality?.includes(result.quality)) {
        this.state.removeCondition(c.id);
      }
    }

    // Advance time by actual rest duration (may be truncated)
    const gs2        = this.state.getState();
    const beforeTime = gs2.time;  // snapshot before advanceTime replaces this.state.time
    const newTime    = this.timeMgr.advance(beforeTime, result.actualMinutes);
    const newPeriod  = schedule
      ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs2.player.activeFlags)
      : gs2.timePeriod;
    this.state.advanceTime(newTime, newPeriod);
    this.state.tickItemExpiry(id => this.lore.getItem(id)?.expiresAfterMinutes);

    // Post-rest system sweeps — fire events at the (possibly truncated) wake time.
    // If sleep was interrupted, these are the events that caused the wake-up.
    let interruptTriggered: TriggeredEvent[] = [...restStartTriggered, ...restStartExtra];
    const crossedHours = this.timeMgr.computeCrossedHours(beforeTime, newTime);
    // 中斷點可能不在整點上（例：窗口起點 06:30），此時 crossedHours 可能為空，仍需檢查事件
    if (crossedHours.length > 0 || interruptMinutes !== null) {
      if (!this.state.flags.has('game_day1_started') && crossedHours.includes(0)) {
        this.state.flags.set('game_day1_started');
      }
      if (crossedHours.includes(0)) {
        for (const prop of this.lore.getAllProps()) {
          for (const flag of prop.dailyResetFlags ?? []) {
            this.state.unsetPropFlag(prop.id, flag);
          }
        }
      }
      if (this.state.flags.has('game_day1_started')) {
        const qfTriggered   = this.checkQuestFailConditions(crossedHours);
        const glTriggered   = this.events.checkGlobalEvents(this.currentRegionId, crossedHours);
        const locTriggered  = this.events.checkAndApply(gs2.player.currentLocationId, crossedHours);
        const timeTriggered = [...qfTriggered, ...glTriggered, ...locTriggered];
        if (timeTriggered.length > 0) {
          const { extraTriggered } = this.processTriggeredEvents(timeTriggered);
          interruptTriggered = [...timeTriggered, ...extraTriggered];
        }
      }
    }
    this.quests.checkTimeLimits(this.state.getState().time.totalMinutes);
    this.quests.checkObjectives();
    this.quests.checkPendingRepeats();
    this.phases.checkAdvance();

    // Flush acquisition notifications
    this.flushAcquisitions();

    // Store narration context for after the overlay closes.
    // Scene ctx includes interrupt events so DM can mention what woke the player.
    const sceneCtx = this.buildSceneCtx(interruptTriggered);
    this._pendingRestNarration = {
      sceneCtx,
      result,
      plannedMinutes,
      wasInterrupted:        interruptMinutes !== null || hasRestStartInterrupt,
      wasRestStartInterrupt: hasRestStartInterrupt,
      interruptTriggered,
      restEncounterIds: restEncounterIds.length > 0 ? restEncounterIds : undefined,
    };

    // Show result overlay
    const wasInterrupted = interruptMinutes !== null || hasRestStartInterrupt;
    restResultOverlay.set({
      plannedMinutes,
      actualMinutes:    result.actualMinutes,
      // When interrupted, show deviation relative to the original planned duration, not the truncated one
      deviationMinutes: wasInterrupted ? result.actualMinutes - plannedMinutes : result.deviationMinutes,
      quality:          result.quality,
      staminaDelta:     result.staminaDelta,
      stressDelta:      result.stressDelta,
      fatigueDelta:     result.fatigueDelta,
      resultTags:       result.resultTags,
      wasInterrupted,
    });

    // Sync UI
    this.syncUIState(this.state.getState());

    return result;
  }

  /**
   * 依 ConditionDefinition 的機制欄位自動生成玩家可見的效果摘要字串。
   */
  private static buildConditionEffectSummary(def: import('../types/condition').ConditionDefinition): string {
    const parts: string[] = [];

    const STAT_LABEL: Record<string, string> = {
      'statusStats.stamina': '體力',
      'statusStats.stress':  '壓力',
      'statusStats.endo':    '靈能',
      'statusStats.fatigue': '疲勞',
      strength:  '力量',
      knowledge: '知識',
      talent:    '才能',
      spirit:    '精神',
      luck:      '運氣',
    };

    if (def.tickEffect) {
      const { everyNTurns, statChanges, maxTicks } = def.tickEffect;
      const effects = Object.entries(statChanges)
        .map(([key, val]) => {
          if (val === undefined) return null;
          const name = STAT_LABEL[key] ?? key;
          return `${name} ${val > 0 ? '+' : ''}${val}`;
        })
        .filter(Boolean)
        .join('、');
      if (effects) {
        parts.push(`每 ${everyNTurns} 回合：${effects}（最多 ${maxTicks} 次）`);
      }
    }

    if (def.statModifiers) {
      const mods = Object.entries(def.statModifiers)
        .map(([key, val]) => {
          if (val === undefined || val === 0) return null;
          const name = STAT_LABEL[key] ?? key;
          return `${name} ${val > 0 ? '+' : ''}${val}`;
        })
        .filter(Boolean)
        .join('、');
      if (mods) parts.push(`主要數值：${mods}`);
    }

    if (def.actionTimeCostMultiplier && def.actionTimeCostMultiplier !== 1) {
      const pct = Math.round((def.actionTimeCostMultiplier - 1) * 100);
      parts.push(`行動時間 ${pct > 0 ? '+' : ''}${pct}%`);
    }

    return parts.join('\n');
  }

  /**
   * 當 rest_start 事件觸發時，直接強制產生「完全沒睡著」的極差休息結果。
   * 不走 RestResolver，品質固定為「喪失時間觀」，體力僅微量回復。
   */
  private static buildRestStartInterruptResult(
    plannedMinutes: number,
    staminaMax: number,
  ): RestResult {
    const actualMinutes = 45;
    return {
      actualMinutes,
      deviationMinutes: actualMinutes - plannedMinutes,
      quality:          'disoriented',
      staminaDelta:     Math.max(1, Math.round(staminaMax * 0.05)),
      stressDelta:      0,
      fatigueDelta:     0,
      resultTags:       ['disoriented', 'undersleep', 'rest_interrupted'],
    };
  }

  /**
   * 休息 overlay 關閉後，觸發 DM 敘述休息結果。
   * 由 RestResultOverlay 在 dismiss 動畫結束後呼叫。
   */
  async narrateRestResult(): Promise<void> {
    const ctx = this._pendingRestNarration;
    this._pendingRestNarration = null;
    if (!ctx || !this.dmClient) return;

    const { sceneCtx, result, plannedMinutes, wasInterrupted, wasRestStartInterrupt, interruptTriggered } = ctx;
    const gs = this.state.getState();

    const fmtMin = (m: number) => {
      if (m < 60) return `${m} min`;
      const h = Math.floor(m / 60), rem = m % 60;
      return rem > 0 ? `${h}h ${rem}min` : `${h}h`;
    };

    const interruptLine = wasInterrupted
      ? wasRestStartInterrupt
        ? `[COULDN'T SLEEP] Player failed to fall asleep due to: ${interruptTriggered.map(t => t.event.name).join(', ')}`
        : `[SLEEP INTERRUPTED] Player was woken up early by: ${interruptTriggered.map(t => t.event.name).join(', ')}`
      : '';

    const restSummary = [
      `Quality: ${QUALITY_LABEL[result.quality] ?? result.quality}`,
      `Planned: ${fmtMin(plannedMinutes)} → Actual: ${fmtMin(result.actualMinutes)} (${result.deviationMinutes > 0 ? '+' : ''}${result.deviationMinutes}min deviation)`,
      result.staminaDelta !== 0 ? `Stamina: ${result.staminaDelta > 0 ? '+' : ''}${result.staminaDelta}` : '',
      result.stressDelta  !== 0 ? `Stress: ${result.stressDelta > 0 ? '+' : ''}${result.stressDelta}`   : '',
      interruptLine,
    ].filter(Boolean).join('\n');

    const traceId = startTrace(gs.turn, 'exploration', `rest: ${result.quality}`);
    addTracePhase(traceId, 'input', { type: 'rest', plannedMinutes, actualMinutes: result.actualMinutes, quality: result.quality });
    addTracePhase(traceId, 'scene', { sceneCtx });
    addTracePhase(traceId, 'rest-result', { restSummary });
    log.debug('Rest narration — scene ctx', { length: sceneCtx.length });
    log.debug('Rest narration — rest summary', { restSummary });

    isStreaming.set(true);
    pushLine('', 'narrative', true);
    let fullText = '';
    let signalCutoff = -1;
    try {
      for await (const chunk of this.dm.narrateRest(sceneCtx, restSummary, gs.history)) {
        const prevLen = fullText.length;
        fullText += chunk;
        if (signalCutoff === -1) {
          const idx = fullText.indexOf('<<');
          if (idx !== -1) {
            if (idx > prevLen) appendToLastLine(fullText.slice(prevLen, idx));
            signalCutoff = idx;
          } else {
            appendToLastLine(chunk);
          }
        }
      }
      const displayText = (signalCutoff === -1 ? fullText : fullText.slice(0, signalCutoff)).trimEnd();
      narrativeLines.update(lines => {
        if (lines.length === 0) return lines;
        const last = lines[lines.length - 1];
        if (last.text === displayText) return lines;
        return [...lines.slice(0, -1), { ...last, text: displayText }];
      });
      addTracePhase(traceId, 'narration', { raw: fullText });
      log.debug('Rest narration — DM response', { length: fullText.length, preview: fullText.slice(0, 200) });
    } catch (err) {
      log.error('Rest DM narration failed', err);
      appendToLastLine('\n[rest narration error]');
    } finally {
      finishLastLine();
      isStreaming.set(false);
    }

    const action: PlayerAction = { type: 'rest', input: '（休息）' };
    this.state.appendHistory(action, this.sanitizeDMOutput(fullText).slice(0, 200));

    // Launch encounters triggered by rest_start event (e.g. restless night), sequentially.
    if (ctx.restEncounterIds?.length || this._npcDialogueQueue.length > 0) {
      if (ctx.restEncounterIds) for (const encId of ctx.restEncounterIds) this.enqueueEncounter(encId);
      await this.startNextQueuedEncounter();
      this.flushAcquisitions();
      this.releaseInput();
      // Thoughts will be refreshed when the encounter ends via selectEncounterChoice.
    } else {
      // 休息敘述末尾的 <<THOUGHTS>> 訊號即為 LLM 候選；缺漏時 refreshThoughts 走中文 fallback
      await this.refreshThoughts(extractEncounterThoughts(fullText));
    }
  }

  /**
   * 玩家取消休息，觸發 DM 簡短敘述。
   * 由 RestModal 的「取消」按鈕呼叫。
   */
  async cancelRest(): Promise<void> {
    this._pendingRestNarration = null;
    if (!this.dmClient) return;

    const gs = this.state.getState();
    const sceneCtx = this.buildSceneCtx([]);

    const traceId = startTrace(gs.turn, 'exploration', 'rest: cancelled');
    addTracePhase(traceId, 'input', { type: 'rest', cancelled: true });
    addTracePhase(traceId, 'scene', { sceneCtx });
    log.debug('Rest cancel narration — scene ctx', { length: sceneCtx.length });

    isStreaming.set(true);
    pushLine('', 'narrative', true);
    let fullText = '';
    let signalCutoff = -1;
    try {
      for await (const chunk of this.dm.narrateRestCancel(sceneCtx, gs.history)) {
        const prevLen = fullText.length;
        fullText += chunk;
        if (signalCutoff === -1) {
          const idx = fullText.indexOf('<<');
          if (idx !== -1) {
            if (idx > prevLen) appendToLastLine(fullText.slice(prevLen, idx));
            signalCutoff = idx;
          } else {
            appendToLastLine(chunk);
          }
        }
      }
      const displayText = (signalCutoff === -1 ? fullText : fullText.slice(0, signalCutoff)).trimEnd();
      narrativeLines.update(lines => {
        if (lines.length === 0) return lines;
        const last = lines[lines.length - 1];
        if (last.text === displayText) return lines;
        return [...lines.slice(0, -1), { ...last, text: displayText }];
      });
      addTracePhase(traceId, 'narration', { raw: fullText });
      log.debug('Rest cancel narration — DM response', { length: fullText.length, preview: fullText.slice(0, 200) });
    } catch (err) {
      log.error('Rest cancel DM narration failed', err);
      appendToLastLine('\n[narration error]');
    } finally {
      finishLastLine();
      isStreaming.set(false);
    }

    await this.refreshThoughts(extractEncounterThoughts(fullText));
  }

  // -- Save / load -------------------------------------------------------

  /**
   * Check whether saving is currently allowed.
   * Blocks: DM is streaming, non-exploring phase, or save_locked flag is active.
   */
  canSave(): { allowed: boolean; reason?: string } {
    if (get(isStreaming)) {
      return { allowed: false, reason: '敘述進行中，無法存檔' };
    }
    const gs = this.state.getState();
    if (gs.phase !== 'exploring') {
      return { allowed: false, reason: '此階段無法存檔' };
    }
    if (this.state.flags.evaluate('save_locked')) {
      return { allowed: false, reason: '此刻無法存檔' };
    }
    return { allowed: true };
  }

  /** Manual save to a numbered slot (1–5). */
  async save(slotId: number, label?: string): Promise<void> {
    const gs       = this.state.getState();
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    const flags    = this.state.flags.toArray();
    // 指紋與存檔內容在同一時刻取得；寫入期間若狀態再變動，關閉時仍會判為未儲存
    const fingerprint = stateFingerprint(gs, flags);
    const seq         = ++this._saveSeq;
    await SaveManager.saveSlot(
      slotId,
      gs,
      flags,
      resolved?.name ?? gs.player.currentLocationId,
      this.timeMgr.formatTime(gs.time),
      label,
    );
    if (seq > this._savedSeq) {
      this._savedSeq         = seq;
      this._savedFingerprint = fingerprint;
    }
    log.info('Game saved', { slotId });
  }

  /** 以目前狀態作為「已儲存」基準（讀檔完成、新遊戲開場後呼叫）。 */
  markSaved(): void {
    this._savedFingerprint = stateFingerprint(this.state.getState(), this.state.flags.toArray());
    this._savedSeq         = this._saveSeq;
  }

  /** 上次存檔（或讀檔／新遊戲基準）之後遊戲狀態是否有變更。 */
  hasUnsavedChanges(): boolean {
    if (this._savedFingerprint === null) return true;
    return stateFingerprint(this.state.getState(), this.state.flags.toArray()) !== this._savedFingerprint;
  }

  /** Auto-save to slot 0. Silently skips if canSave() is false. */
  async autoSave(): Promise<void> {
    if (!this.canSave().allowed) return;
    isSaving.set(true);
    try {
      await this.save(SaveManager.AUTO_SLOT);
      log.debug('Auto-saved to slot 0');
    } finally {
      isSaving.set(false);
    }
  }

  /** Load from a slot. Rebuilds all engine sub-systems and refreshes thoughts. */
  async load(slotId: number): Promise<void> {
    const { state, flags } = await SaveManager.loadSlot(slotId);
    this.loadState(state, flags);

    // Restore narrative history from save, then add a separator
    restoreHistoryLines(state.history);
    pushLine('—— 讀取存檔 ——', 'system');

    let loadSuggestions: string[] = [];
    if (this.mockMode) {
      pushLine('（存檔讀取完成）', 'system');
    } else {
      const sceneCtx = this.buildSceneCtx([]);
      const { suggestions } = await this.runDM({ type: 'examine', input: '(game loaded)' }, sceneCtx);
      loadSuggestions = suggestions;
    }

    await this.refreshThoughts(loadSuggestions);
    // 讀檔（含讀檔開場敘述）完成即為基準
    this.markSaved();
    log.info('Game loaded', { slotId, turn: state.turn });
  }

  /** List all save slots (index 0 = auto-save, 1–5 = manual; null = empty). */
  async listSaves(): Promise<(SlotMeta | null)[]> {
    return SaveManager.listSlots();
  }

  /**
   * Export a slot as a JSON string for the user to save to disk.
   * The Svelte layer is responsible for writing it to the chosen path.
   */
  async exportSave(slotId: number): Promise<string> {
    return SaveManager.exportSlot(slotId);
  }

  /**
   * Import a save from a JSON string (read from disk by the Svelte layer).
   * Validates the codec before overwriting the target slot.
   */
  async importSave(fileContent: string, slotId: number): Promise<void> {
    await SaveManager.importSlot(fileContent, slotId);
    log.info('Save imported', { slotId });
  }

  /** Delete a save slot. */
  async deleteSave(slotId: number): Promise<void> {
    await SaveManager.deleteSlot(slotId);
    log.info('Save deleted', { slotId });
  }

  // -- Scripted dialogue ------------------------------------------------

  /**
   * Called by UI when the player selects a choice in a scripted dialogue node.
   * Applies effects, advances to the next node (or ends the dialogue).
   */
  async selectDialogueChoice(choiceId: string): Promise<void> {
    // 重入鎖：效果同步套用後要等串流結束才更新節點，期間重複點擊會重複推進任務/旗標/物品。
    // 必須在第一個 await 之前同步檢查並設定。
    if (this._dialogueChoiceBusy) return;
    this._dialogueChoiceBusy = true;
    try {
      const current = get(activeScriptedDialogue);
      if (!current) return;

      const choice = current.currentChoices.find(c => c.id === choiceId);
      if (!choice) return;

      // Show the player's choice in the narrative and log to session
      pushLine('> ' + choice.text, 'player');
      appendEncounterLog('player', choice.text);

      // Apply basic side effects (affinity, rep, flags, attitude, intel)
      this.dialogueMgr.applyChoiceEffects(current.npcId, choice.effects);

      // Apply quest effects
      if (choice.effects?.grantQuest) {
        this.quests.grantQuest(choice.effects.grantQuest);
      }
      if (choice.effects?.advanceQuestStage) {
        const { questId, stageId } = choice.effects.advanceQuestStage;
        this.state.advanceQuestStage(questId, stageId);
      }
      if (choice.effects?.completeObjective) {
        const { questId, objectiveId } = choice.effects.completeObjective;
        this.state.completeObjective(questId, objectiveId);
      }
      if (choice.effects?.ditchQuestId) {
        this.quests.ditchQuest(choice.effects.ditchQuestId, {
          skipConsequences: choice.effects.ditchSkipConsequences === true,
        });
      }

      const updatedNarrative = current.collectedNarrative + '\n[玩家]: ' + choice.text;

      // Post-condition branching: evaluate branches after effects are applied
      let targetNodeId = choice.nextNodeId;
      if (choice.branches) {
        for (const branch of choice.branches) {
          if (this.state.flags.evaluate(branch.condition)) {
            targetNodeId = branch.nodeId;
            break;
          }
        }
      }

      if (targetNodeId === null) {
        activeScriptedDialogue.set({ ...current, collectedNarrative: updatedNarrative });
        // 本次選擇已套用完畢；提前釋放鎖，避免吞掉結束後鏈式啟動的下一段對話選擇
        this._dialogueChoiceBusy = false;
        await this.endScriptedDialogue();
        return;
      }

      const nextNode = this.dialogueMgr.getNode(current.npcId, current.dialogueId, targetNodeId);
      if (!nextNode) {
        activeScriptedDialogue.set({ ...current, collectedNarrative: updatedNarrative });
        // 本次選擇已套用完畢；提前釋放鎖，避免吞掉結束後鏈式啟動的下一段對話選擇
        this._dialogueChoiceBusy = false;
        await this.endScriptedDialogue();
        return;
      }

      const ctx = this.buildInterpolationCtx();
      const filteredChoices = this.dialogueMgr.filterChoices(nextNode.choices, this.state.flags);

      // transitionLines: show these instead of target node's lines (return/back pattern)
      let addedNarrative: string;
      isStreaming.set(true);
      if (choice.transitionLines && choice.transitionLines.length > 0) {
        const transLines = this.renderNodeLines(choice.transitionLines, current.npcName, ctx);
        await this.streamScriptedLines(transLines, choice.transitionLines);
        addedNarrative = transLines.join('\n');
      } else {
        const nextLines = this.renderNodeLines(nextNode.lines, current.npcName, ctx);
        await this.streamScriptedLines(nextLines, nextNode.lines);
        addedNarrative = nextLines.join('\n');
      }
      isStreaming.set(false);

      activeScriptedDialogue.set({
        ...current,
        currentNodeId:      targetNodeId,
        currentChoices:     filteredChoices,
        collectedNarrative: updatedNarrative + '\n' + addedNarrative,
      });

      // Auto-end if the node has no choices (guarded to prevent double-fire)
      if (filteredChoices.length === 0) {
        if (this._pendingAutoEnd) clearTimeout(this._pendingAutoEnd);
        this._pendingAutoEnd = setTimeout(() => {
          this._pendingAutoEnd = null;
          this.endScriptedDialogue().catch(err => log.warn('endScriptedDialogue error', err));
        }, 600);
      }
    } finally {
      this._dialogueChoiceBusy = false;
    }
  }

  /** Expose state for save/load. */
  getState(): Readonly<GameState> {
    return this.state.getState();
  }

  getFlags(): string[] {
    return this.state.flags.toArray();
  }

  /**
   * Build the full DM prompt for the current game state — without calling the LLM.
   * Used by the debug route to inspect context structure.
   * @param actionInput  Simulated player action (default: 觀察四周)
   */
  getDMContextPreview(actionInput = '觀察四周'): {
    systemPrompt: string;
    sceneContext:  string;
    fullUserMessage: string;
  } {
    const sceneContext = this.buildSceneCtx([]);
    const gs           = this.state.getState();
    const historyText  = gs.history
      .slice(-5)
      .map(h => {
        const loc = h.locationId ? ` [${h.locationId}]` : '';
        return `Turn ${h.turn}${loc}\nPlayer: ${h.action.input}\nNarrator: ${h.narrative}`;
      })
      .join('\n\n');

    const fullUserMessage = [
      '## Scene Data',
      sceneContext,
      '',
      '## Recent History',
      historyText || '(game start)',
      '',
      '## Player Action',
      actionInput,
    ].join('\n');

    return { systemPrompt: DM_NARRATION_PROMPT, sceneContext, fullUserMessage };
  }

  /** Restore from a decoded SaveSnapshot. */
  loadState(gs: GameState, flags: string[]): void {
    // Migration: old saves may not have propFlags
    if (!gs.propFlags) gs.propFlags = {};
    // Rebuild StateManager with the restored state
    (this as unknown as { state: StateManager }).state = new StateManager(gs, this.bus);
    flags.forEach(f => this.state.flags.set(f));
    const schedule = this.lore.getSchedule(this.currentRegionId) ?? null;
    this.state.setCurfewConfig(schedule?.curfew);
    this.events       = new EventEngine(this.lore, this.state, this.timeMgr, schedule);
    this.phases       = new PhaseManager(this.lore, this.state);
    this.quests       = new QuestEngine(this.lore, this.state);
    this.factionTree  = new FactionTreeEngine(this.lore, this.state);
    this.quests.setFactionTree(this.factionTree);
    this.dialogueMgr  = new DialogueManager(this.lore, this.state);
    this.encounterMgr = new EncounterEngine(this.lore, this.state);
    this.syncUIState(gs);
    log.info('State loaded from save', { turn: gs.turn });
  }

  /** Restore previous snapshot and resubmit with a new input (edit-last-action). */
  async rewindAndResubmit(newInput: string): Promise<void> {
    const snap = get(previousSnapshot);
    if (!snap) return;
    // JSON.parse/stringify converts Set<string> to {} — reconstruct before loadState
    snap.gameState.player.activeFlags = new Set(snap.activeFlags);
    this.loadState(snap.gameState, snap.flags);
    narrativeLines.set(snap.narrativeLines);
    previousSnapshot.set(null);
    await this.submitAction(newInput);
  }

  // -- Quest fail condition scan ----------------------------------------

  /**
   * 掃描所有進行中任務的 failCondition，自動觸發符合條件的失敗。
   * 頂層 failCondition 優先，命中則整個任務失敗；
   * 未命中頂層時再檢查當前階段的 failCondition。
   * 回傳因 onFail.startEventId 直接觸發的事件列表（供 processTriggeredEvents 處理）。
   */
  private checkQuestFailConditions(crossedHours: number[]): import('./EventEngine').TriggeredEvent[] {
    const gs      = this.state.getState();
    const result: import('./EventEngine').TriggeredEvent[] = [];

    for (const [questId, instance] of Object.entries(gs.activeQuests)) {
      if (instance.isCompleted || instance.isFailed || instance.isDitched) continue;

      const def = this.lore.getQuest(questId);
      if (!def) continue;

      const matchesFail = (cond: import('../types/quest').QuestFailCondition): boolean => {
        if (cond.triggerHours?.length && !cond.triggerHours.some(h => crossedHours.includes(h))) return false;
        if (cond.flags?.length      && !this.state.flags.hasAll(cond.flags))   return false;
        if (cond.anyFlags?.length   && !this.state.flags.hasAny(cond.anyFlags)) return false;
        return true;
      };

      // Top-level failCondition: fail entire quest regardless of stage
      if (def.failCondition && matchesFail(def.failCondition)) {
        const r = this.quests.applyQuestFail(questId);
        log.info('Quest auto-failed by top-level failCondition', { questId });
        if (r.startEventId) {
          const ev = this.events.fireEventById(r.startEventId);
          if (ev) result.push(ev);
        }
        continue; // don't also check stage condition
      }

      // Stage-level failCondition
      const stage = instance.currentStageId ? def.stages[instance.currentStageId] : undefined;
      if (stage?.failCondition && matchesFail(stage.failCondition)) {
        const r = this.quests.applyQuestFail(questId);
        log.info('Quest auto-failed by stage failCondition', { questId, stageId: instance.currentStageId });
        if (r.startEventId) {
          const ev = this.events.fireEventById(r.startEventId);
          if (ev) result.push(ev);
        }
      }
    }

    return result;
  }

  // -- Ending conditions ------------------------------------------------

  /**
   * Check whether the current game state satisfies any ending condition.
   * Called at the end of each turn, after syncUIState.
   * Returns true if an ending was triggered (caller should not release input).
   */
  private checkEndingConditions(): boolean {
    const gs = this.state.getState();
    const { stamina, stress, stressMax } = gs.player.statusStats;

    if (stamina <= 0) {
      this.triggerEnding('death');
      return true;
    }
    if (stress >= stressMax) {
      this.triggerEnding('collapse');
      return true;
    }
    if (gs.player.currentLocationId === 'wyar_transit_hub') {
      this.triggerEnding('mvp_complete');
      return true;
    }
    return false;
  }

  private triggerEnding(type: EndingType): void {
    endingType.set(type);
    gamePhase.set('ending');
    log.info('Game ending triggered', { type });
  }

  // -- Context builder --------------------------------------------------

  private buildProximityContext(gs: Readonly<GameState>): ProximityContext {
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    return {
      locationId:     gs.player.currentLocationId,
      districtId:     resolved?.districtId,
      regionId:       this.currentRegionId,
      activeQuestIds: Object.keys(gs.activeQuests).filter(id => {
        const q = gs.activeQuests[id];
        return !q.isCompleted && !q.isFailed;
      }),
      flags:      this.state.flags,
      timePeriod: gs.timePeriod,
    };
  }

  private buildSceneCtx(
    triggered: TriggeredEvent[],
    periodChanged = false,
    action?: PlayerAction,
    /** 本回合行動開始時刻（預設時間推進之前）；提供時 timeMinutes 與接下來的時間點都以此為起點 */
    turnStartTime?: GameTime,
  ): string {
    const gs    = this.state.getState();
    const parts: string[] = [];

    // ── Time & schedule header (always first) ─────────────────────────────
    const timeStr    = this.timeMgr.formatTime(gs.time);
    const periodStr  = this.timeMgr.formatPeriod(gs.timePeriod);
    const periodNote = periodChanged ? ' ← 時段轉換' : '';

    const schedule   = this.lore.getSchedule(this.currentRegionId);
    const schedLine  = schedule
      ? schedule.periods
          .map(p => {
            const fmt = (h: number, m: number) =>
              h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
            return `${p.label} ${fmt(p.startHour, p.startMinute)}–${fmt(p.endHour, p.endMinute)}`;
          })
          .join(' | ')
      : null;

    // 門禁與接下來的公開時間點（只取時間表／門禁設定，不列舉事件）
    const curfewCfg = this.state.getCurfewConfig();
    const timeInput = {
      time:     turnStartTime ?? gs.time,
      schedule: schedule ?? null,
      curfew:   this.state.getEffectiveCurfew(),
      curfewDefaultStart: curfewCfg ? { hour: curfewCfg.startHour, minute: curfewCfg.startMinute } : undefined,
    };
    const startLine = turnStartTime
      ? `Action started at: ${formatClock(turnStartTime.hour, turnStartTime.minute)} — timeMinutes counts from this moment `
        + `(the clock above already includes a provisional ${gs.time.totalMinutes - turnStartTime.totalMinutes} min). `
        + `Max ${MAX_ACTION_MINUTES} min per action.`
      : '';

    parts.push([
      '## Current Time',
      'Time: ' + timeStr + ' | ' + periodStr + periodNote,
      schedLine ? 'Schedule: ' + schedLine : '',
      curfewLine({ ...timeInput, time: gs.time }) ?? '',   // 門禁狀態以目前時鐘判斷，與下方出口的封鎖一致
      startLine,
      upcomingLine(timeInput) ?? '',
    ].filter(Boolean).join('\n'));

    // ── Location context ───────────────────────────────────────────────────
    // NPC details are action-gated: only injected for examine (scene observation).
    // interact routes to dialogue handler before reaching buildSceneCtx.
    // General examine: inject full NPC/prop lists. Targeted Check: only focused target is injected below.
    const isGeneralExamine = action?.type === 'examine' && !action?.targetKind;
    const includeNpcs = isGeneralExamine;
    const includeProps = isGeneralExamine;
    parts.push(
      this.lore.buildSceneContext(
        gs.player.currentLocationId,
        this.state.flags,
        includeNpcs ? gs.npcMemory : undefined,
        { timePeriod: gs.timePeriod, gameTime: gs.time, knownIntelIds: gs.player.knownIntelIds, activeQuests: Object.values(gs.activeQuests), inventory: gs.player.inventory, melphin: gs.player.melphin },
        { includeNpcs, includeProps, propFlags: gs.propFlags, npcMeetingCounts: gs.npcMeetingCounts },
      )
    );

    const visibleConditions = gs.player.conditions
      .filter(c => !(this.lore.getCondition(c.id)?.isHidden ?? c.isHidden))
      .map(c => this.lore.getCondition(c.id)?.label ?? c.label ?? c.id)
      .join(', ');

    parts.push([
      '',
      '## Player Status',
      'Stamina: ' + gs.player.statusStats.stamina + '/' + gs.player.statusStats.staminaMax +
        ' | Stress: ' + gs.player.statusStats.stress + '/' + gs.player.statusStats.stressMax +
        ' | Fatigue: ' + (gs.player.statusStats.fatigue ?? 0) + '/5',
      'World Phase: ' + gs.worldPhase.currentPhase.replace(/_/g, ' '),
      visibleConditions ? 'Conditions: ' + visibleConditions : '',
    ].filter(Boolean).join('\n'));

    const activeQuestLines = Object.values(gs.activeQuests)
      .filter(q => !q.isCompleted && !q.isFailed && q.currentStageId)
      .map(q => {
        const def   = this.lore.getQuest(q.questId);
        const stage = def?.stages[q.currentStageId!];
        if (!stage) return '';
        // 當前階段尚未完成的目標（玩家在任務面板可見的描述），供 DM 在玩家迷惘時以角色內方式暗示方向
        const pending = stage.objectives
          .filter(o => !q.completedObjectiveIds.includes(o.id))
          .map(o => o.description);
        const shownPending = stage.ordered ? pending.slice(0, 1) : pending;
        return '- [Quest] ' + def!.name + ': ' + stage.description
          + (shownPending.length > 0 ? '（目標：' + shownPending.join('；') + '）' : '');
      })
      .filter(Boolean);

    if (activeQuestLines.length > 0) {
      parts.push('\n### Active Quests\n' + activeQuestLines.join('\n'));
    }

    // Quest outcomes from the PREVIOUS turn — injected into the player-action DM only
    // (triggered.length === 0), shown once, then cleared.
    if (this._stagedQuestOutcomes.length > 0 && triggered.length === 0) {
      const lines = this._stagedQuestOutcomes.map(
        o => '- [' + (o.outcome === 'completed' ? 'Completed' : 'Failed') + '] ' + o.name
      );
      parts.push('\n### Quest Outcomes (last turn)\n' + lines.join('\n'));
      this._stagedQuestOutcomes = [];
    }

    if (triggered.length > 0) {
      // {curfewStart} 等結構化佔位符以引擎實際值替換（outcome 效果已套用，讀到的是覆寫後的門禁時間）
      const curfewWindow = this.state.getEffectiveCurfew();
      const evLines = triggered.map(({ event, outcome }) => [
        '- [觸發] ' + interpolateCurfew(event.description, curfewWindow),
        '  [結果] ' + interpolateCurfew(outcome.description, curfewWindow),
      ].join('\n'));
      parts.push('\n### Events This Turn\n' + evLines.join('\n'));
    }

    // Proximity-filtered flag manifest
    const proxCtx  = this.buildProximityContext(gs);
    const flagCtx  = this.lore.flagRegistry.buildDMContext(proxCtx);
    if (flagCtx) parts.push('\n' + flagCtx);

    // ── Action-type context gating ────────────────────────────────────────
    // Each action type injects additional targeted context for the DM.
    // action.type is a hint, not an authority — world outcomes come from resolution.

    // NPC info (presence + relationship status) is only injected for examine.
    // interact routes to dialogue handler before reaching buildSceneCtx.
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags, gs.timePeriod);
    const sceneNpcIds = this.lore.getNPCsByIds(resolved?.npcIds ?? [], this.state.flags, gs.timePeriod).map(n => n.id);

    if (action?.type === 'examine' && sceneNpcIds.length > 0) {
      // NPC relationship status (supplements the NPC list already included via includeNpcs)
      const npcStatus = this.dialogueMgr.buildSceneNPCStatus(sceneNpcIds);
      if (npcStatus) parts.push('\n' + npcStatus);
    }

    // use / check-inv: inject player inventory so DM knows what items are available
    if (action?.type === 'use' || action?.type === 'check-inv') {
      const activeInv = gs.player.inventory.filter(i => !i.isExpired);
      if (activeInv.length > 0) {
        const invLines = activeInv.map(i => {
          const def     = this.lore.getItem(i.itemId);
          const name    = def?.name ?? i.itemId;
          const variant = i.variantId
            ? def?.variants?.find(v => v.id === i.variantId)?.label
            : undefined;
          const label   = variant ? `${name}（${variant}）` : name;
          const qty     = i.quantity > 1 ? ` ×${i.quantity}` : '';
          const uses    = i.usesRemaining !== undefined ? ` [剩 ${i.usesRemaining} 次]` : '';
          const desc    = def?.description ? ': ' + def.description : '';
          return `- ${label}${qty}${uses}${desc}`;
        });
        parts.push('\n### Player Inventory\n' + invLines.join('\n'));
      } else {
        parts.push('\n### Player Inventory\n(空)');
      }

      // Resolve specific item from player input — inject full item definition for DM
      const matched = this.resolveTargetItem(action.input, activeInv);
      if (matched) {
        const itemParts: string[] = [
          `\n### Focused Item: ${matched.def.name}`,
          `Type: ${matched.def.type}`,
          `Description: ${matched.def.description}`,
        ];
        if (matched.variant) {
          itemParts.push(`Variant: ${matched.variant.label}${matched.variant.description ? ' — ' + matched.variant.description : ''}`);
        }
        if (matched.def.useNarrative)       itemParts.push(`Use narrative hint: ${matched.def.useNarrative}`);
        if (matched.def.fallbackDescription) itemParts.push(`Cannot-use hint: ${matched.def.fallbackDescription}`);
        if (matched.def.statBonus) {
          const bonuses = Object.entries(matched.def.statBonus).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${v! > 0 ? '+' : ''}${v}`);
          if (bonuses.length) itemParts.push(`Stat bonus: ${bonuses.join(', ')}`);
        }
        if (matched.def.effect) {
          const fx: string[] = [];
          if (matched.def.effect.statusChanges) {
            const sc = matched.def.effect.statusChanges;
            if (sc.stamina) fx.push(`stamina ${sc.stamina > 0 ? '+' : ''}${sc.stamina}`);
            if (sc.endo)    fx.push(`endo ${sc.endo > 0 ? '+' : ''}${sc.endo}`);
            if (sc.stress)  fx.push(`stress ${sc.stress > 0 ? '+' : ''}${sc.stress}`);
          }
          if (matched.def.effect.applyConditionId) fx.push(`applies: ${matched.def.effect.applyConditionId}`);
          if (matched.def.effect.removeConditionIds?.length) fx.push(`removes: ${matched.def.effect.removeConditionIds.join(', ')}`);
          if (fx.length) itemParts.push(`Effects: ${fx.join(' | ')}`);
        }
        if (matched.inv.usesRemaining !== undefined) itemParts.push(`Uses remaining: ${matched.inv.usesRemaining}`);
        if (matched.inv.quantity > 1) itemParts.push(`Held: ×${matched.inv.quantity}`);
        parts.push(itemParts.join('\n'));
      }
    }

    // Focused target injection when checking via Observe → Check.
    // Re-validates that the target is actually present and visible in the current scene
    // to prevent leaking context for off-scene or invisible targets via direct API calls.
    if (action?.type === 'examine' && action?.targetId && action?.targetKind) {
      const currentResolved = resolved ?? this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags, gs.timePeriod);

      if (action.targetKind === 'prop' && currentResolved) {
        const visibleProps = this.lore.getVisiblePropsForLocation(
          gs.player.currentLocationId, this.state.flags, gs.timePeriod,
          gs.player.knownIntelIds, Object.values(gs.activeQuests), gs.time,
          gs.player.inventory, gs.player.melphin,
        );
        const prop = visibleProps.find(p => p.id === action.targetId);
        if (prop) {
          const grantNames = this.lore.getAvailableItemNamesForProp(prop, this.state.flags, this.state.getPropFlags(prop.id));
          const focusedLines = [
            '\n### Focused Object',
            'Name: ' + prop.name,
            'Description: ' + prop.description,
            prop.restPoint ? 'Rest point: yes' : '',
            grantNames.length > 0 ? 'Obtainable items: ' + grantNames.join(', ') : '',
            prop.checkPrompt ? prop.checkPrompt : '',
          ].filter(Boolean);
          parts.push(focusedLines.join('\n'));
        }
      } else if (action.targetKind === 'npc' && currentResolved) {
        const visibleNpcs = this.lore.getNPCsByIds(currentResolved.npcIds, this.state.flags, gs.timePeriod);
        const npc = visibleNpcs.find(n => n.id === action.targetId);
        if (npc) {
          const npcLocalFlags = this.state.getNPCFlags(npc.id);
          const revealedSecrets = (npc.secretLayers ?? [])
            .filter(s => isSecretLayerRevealed(s, npcLocalFlags, this.state.getNPCMeetingCount(npc.id)))
            .map(s => s.context);
          const mem = gs.npcMemory[npc.id];
          const focusedLines = [
            '\n### Focused NPC',
            'Name: ' + npc.name,
            'Description: ' + npc.publicDescription,
            ...revealedSecrets.map(s => 'Secret: ' + s),
            mem ? 'Relationship: met ' + mem.interactionCount + ' times, attitude: ' + mem.playerAttitude : 'Relationship: first encounter',
          ];
          parts.push(focusedLines.join('\n'));
        }
      } else if (action.targetKind === 'location' && currentResolved) {
        const isExit = currentResolved.connections.some(c => c.targetLocationId === action.targetId);
        if (isExit) {
          const targetLoc = this.lore.resolveLocation(action.targetId!, this.state.flags);
          if (targetLoc) {
            const focusedLines = [
              '\n### Focused Exit',
              'Name: ' + targetLoc.name,
              'Description: ' + targetLoc.description,
              'Tags: ' + targetLoc.tags.join(', '),
            ];
            parts.push(focusedLines.join('\n'));
          }
        }
      }
    }

    // Rest availability context — deterministic rest classification
    if (action?.type === 'rest') {
      const restCtx = this.classifyRestContext();
      if (restCtx.mode === 'scuffed') {
        parts.push([
          '\n### Rest Availability',
          'Mode: scuffed (no rest point available)',
          'Max rest time: ' + restCtx.maxTimeMinutes + ' minutes',
          'The player can only lean against a wall or sit on the ground for a brief rest.',
          'Do NOT narrate the player finding a proper resting place or sleeping for hours.',
        ].join('\n'));
      } else {
        const rpNames = restCtx.restPointIds
          .map(id => this.lore.getProp(id)?.name ?? id)
          .join(', ');
        parts.push([
          '\n### Rest Availability',
          'Mode: full rest available',
          'Rest points: ' + rpNames,
          'The player has access to proper resting facilities.',
        ].join('\n'));
      }
    }

    // inspect: inject extended player stats for self-reflection context
    if (action?.type === 'inspect') {
      const p = gs.player.primaryStats;
      const d = gs.player.secondaryStats;
      const s = gs.player.statusStats;
      parts.push([
        '\n### Player Detail (self-examine)',
        `Origin: ${gs.player.origin}`,
        `Primary — STR: ${p.strength} | KNW: ${p.knowledge} | TLT: ${p.talent} | SPR: ${p.spirit} | LCK: ${p.luck}`,
        `Domain — Mysticism: ${d.mysticism} | Technology: ${d.technology} | Consciousness: ${d.consciousness}`,
        `Status — Stamina: ${s.stamina}/${s.staminaMax} | Stress: ${s.stress}/${s.stressMax} | Endo: ${s.endo}/${s.endoMax} | Fatigue: ${s.fatigue ?? 0}/5`,
      ].join('\n'));
    }

    return parts.join('\n');
  }

  // -- Item targeting -----------------------------------------------------

  /**
   * Try to match the player's input against inventory item names.
   * Returns the best match (longest name wins) or null if no match.
   */
  private resolveTargetItem(
    input: string,
    activeInv: import('../types/item').InventoryItem[],
  ): { inv: import('../types/item').InventoryItem; def: import('../types/item').ItemNode; variant?: import('../types/item').ItemVariant } | null {
    const lower = input.toLowerCase();
    let best: { inv: import('../types/item').InventoryItem; def: import('../types/item').ItemNode; variant?: import('../types/item').ItemVariant; matchLen: number } | null = null;

    for (const inv of activeInv) {
      const def = this.lore.getItem(inv.itemId);
      if (!def) continue;

      // Match base name
      const nameLower = def.name.toLowerCase();
      if (lower.includes(nameLower) && nameLower.length > (best?.matchLen ?? 0)) {
        const variant = inv.variantId ? def.variants?.find(v => v.id === inv.variantId) : undefined;
        best = { inv, def, variant, matchLen: nameLower.length };
      }

      // Match variant label (longer match = more specific)
      if (inv.variantId && def.variants) {
        const variant = def.variants.find(v => v.id === inv.variantId);
        if (variant) {
          const variantLower = variant.label.toLowerCase();
          if (lower.includes(variantLower) && variantLower.length > (best?.matchLen ?? 0)) {
            best = { inv, def, variant, matchLen: variantLower.length };
          }
        }
      }
    }

    if (best) {
      log.debug('Item resolved from input', { itemId: best.def.id, name: best.def.name, variantId: best.inv.variantId });
    }

    return best ? { inv: best.inv, def: best.def, variant: best.variant } : null;
  }

  // -- Direct move (thought candidate) ----------------------------------

  /**
   * 想法候選移動的前置檢查：目的地必須是目前地點的出口，且門禁允許（或可嘗試通行）。
   * 回傳被擋時顯示給玩家的訊息；可通行時回傳 null。
   */
  private getDirectMoveBlockedMessage(targetId: string): string | null {
    const gs = this.state.getState();
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags, gs.timePeriod);
    const conn = resolved?.connections.find(c => c.targetLocationId === targetId);
    if (!conn || !this.lore.getLocation(targetId)) return '那條路已經不在眼前了。';
    const access = this.lore.getConnectionAccessResult(
      conn, this.state.flags, gs.timePeriod, gs.player.knownIntelIds,
      Object.values(gs.activeQuests), gs.time, gs.player.inventory, gs.player.melphin,
      { reputation: gs.player.externalStats.reputation, affinity: gs.player.externalStats.affinity,
        attemptCooldowns: gs.attemptCooldowns, connectionKey: gs.player.currentLocationId + '→' + targetId },
    );
    if (access.allowed || access.attemptEncounterId) return null;
    return conn.access?.lockedMessage ?? '此通道目前無法通行';
  }

  // -- Multi-hop navigation hint ----------------------------------------

  /**
   * When the player's move action names a discovered but non-adjacent location,
   * compute the path and return a compact navigation hint to inject into DM context.
   * Returns '' when not applicable (not a move, adjacent, or no path found).
   *
   * Name matching: checks whether the action input contains the location's display name.
   * If multiple matches exist, the longest name wins (most specific match).
   */
  private buildNavHint(action: PlayerAction): string {
    const gs = this.state.getState();
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    if (!resolved) return '';

    const adjacentIds = new Set(resolved.connections.map(c => c.targetLocationId));

    // 名稱一律用有效顯示名（base.name 覆寫，例：delth_dormitory 顯示為「宿舍大門」），與玩家看到的一致
    const displayName = (locId: string) => this.lore.resolveLocation(locId, this.state.flags)?.name ?? locId;

    let bestMatch: { id: string; name: string; matchLen: number } | null = null;
    for (const locId of gs.discoveredLocationIds) {
      if (locId === gs.player.currentLocationId || adjacentIds.has(locId)) continue;
      const node = this.lore.getLocation(locId);
      if (!node) continue;
      const name = displayName(locId);
      // 比對有效顯示名；原始區域名（如「綜合宿舍區」）仍視為同一地點的別稱
      const matchLen = Math.max(
        action.input.includes(name) ? name.length : 0,
        action.input.includes(node.name) ? node.name.length : 0,
      );
      if (matchLen > 0 && (!bestMatch || matchLen > bestMatch.matchLen)) {
        bestMatch = { id: locId, name, matchLen };
      }
    }
    if (!bestMatch) return '';

    const discovered = new Set([...gs.discoveredLocationIds, gs.player.currentLocationId]);
    const pathResult = this.lore.findPath(
      gs.player.currentLocationId,
      bestMatch.id,
      this.state.flags,
      {
        timePeriod:    gs.timePeriod,
        gameTime:      gs.time,
        knownIntelIds: gs.player.knownIntelIds,
        activeQuests:  Object.values(gs.activeQuests),
        inventory:     gs.player.inventory,
        melphin:       gs.player.melphin,
      },
      discovered,
    );
    if (!pathResult) return '';

    const routeNames = pathResult.path.map(displayName);
    const bypassNote = pathResult.usedBypass ? ' [partial bypass]' : '';

    return [
      '',
      '### Navigation Route (engine-resolved)',
      'Destination: [' + bestMatch.id + '] ' + bestMatch.name,
      'Route: ' + routeNames.join(' → ') + ' (~' + pathResult.totalTime + ' min' + bypassNote + ')',
      'If the player successfully departs, emit <<MOVE: ' + bestMatch.id + '>>.',
      'Set <<TIME: ' + pathResult.totalTime + '>> to reflect the full journey.',
    ].join('\n');
  }

  // -- DM narration -----------------------------------------------------

  /**
   * Narrate world events that fired this turn as a separate DM pass.
   * Runs BEFORE the player-action DM so their outputs stay distinct in the narrative.
   * No signal processing — state changes were already applied by EventEngine.
   */
  private async runEventDM(sceneCtx: string, lineType: 'event' | 'narrative' = 'event'): Promise<void> {
    isStreaming.set(true);
    pushLine('', lineType, true);
    let fullText = '';
    let signalCutoff = -1;
    try {
      for await (const chunk of this.dm.narrateWorldEvent(sceneCtx, this.state.getState().history)) {
        const prevLen = fullText.length;
        fullText += chunk;
        if (signalCutoff === -1) {
          const idx = fullText.indexOf('<<');
          if (idx !== -1) {
            if (idx > prevLen) appendToLastLine(fullText.slice(prevLen, idx));
            signalCutoff = idx;
          } else {
            appendToLastLine(chunk);
          }
        }
      }
      // Patch displayed text to strip any signal artifact caused by chunk-boundary splits
      // (e.g. a stray '<' appended before the second '<' arrived to complete '<<').
      const displayText = (signalCutoff === -1 ? fullText : fullText.slice(0, signalCutoff)).trimEnd();
      narrativeLines.update(lines => {
        if (lines.length === 0) return lines;
        const last = lines[lines.length - 1];
        if (last.text === displayText) return lines;
        return [...lines.slice(0, -1), { ...last, text: displayText }];
      });
    } catch (err) {
      log.error('Event DM narration failed', err);
      appendToLastLine('\n[event narration error]');
    } finally {
      finishLastLine();
      isStreaming.set(false);
    }
  }

  private processTriggeredEvents(
    triggered: TriggeredEvent[],
  ): { eventEncounters: { id: string; def: ReturnType<LoreVault['getEncounter']> }[]; extraTriggered: TriggeredEvent[] } {
    const eventEncounters: { id: string; def: ReturnType<LoreVault['getEncounter']> }[] = [];
    const extraTriggered: TriggeredEvent[] = [];

    for (const t of triggered) {
      if (t.grantQuestId) {
        this.quests.grantQuest(t.grantQuestId);
        log.info('Quest granted by event', { questId: t.grantQuestId, eventId: t.event.id });
      }
      if (t.failQuestId) {
        const failResult = this.quests.applyQuestFail(t.failQuestId);
        log.info('Quest fail applied by event', { questId: t.failQuestId, eventId: t.event.id });
        if (failResult.startEventId) {
          const sub = this.events.fireEventById(failResult.startEventId);
          if (sub) {
            // Collect sub-event so the caller can include it in DM narration.
            extraTriggered.push(sub);
            // Recursively process sub-event so its grantQuestId / failQuestId / notification /
            // startEncounterId are all handled rather than silently dropped.
            const { eventEncounters: subEncounters, extraTriggered: subExtra } =
              this.processTriggeredEvents([sub]);
            extraTriggered.push(...subExtra);
            eventEncounters.push(...subEncounters);
          }
        }
      }
      if (t.startEncounterId) {
        eventEncounters.push({ id: t.startEncounterId, def: this.lore.getEncounter(t.startEncounterId) });
        log.info('Encounter queued by event', { encounterId: t.startEncounterId, eventId: t.event.id });
      }
      if (t.startNpcDialogue) {
        this._npcDialogueQueue.push(t.startNpcDialogue);
        log.info('NPC dialogue queued by event', { ...t.startNpcDialogue, eventId: t.event.id });
      }
      if (t.notification) {
        showEventToast(t.event.name ?? t.event.id, t.notificationVariant ?? 'normal');
      }
    }

    return { eventEncounters, extraTriggered };
  }

  private async runDM(
    action: PlayerAction,
    sceneCtx: string,
    traceId?: number,
    thinkingLineId?: string,
    /** 本回合行動開始時刻；提供時啟用長時間行動的中斷探測，並把實際起訖時刻交給 Phase 2 敘述 */
    turnStartTime?: GameTime,
    /** 想法候選點選的移動目的地（引擎已決定）；提供時略過 Phase 1 與 Judge 的 LLM 猜測，直接交給下方確定性驗證 */
    directMoveTargetId?: string,
  ): Promise<{ resolution: TurnResolution; suggestions: string[] }> {
    // Capture scalar values before any awaits — getState() returns a live reference.
    const gs = this.state.getState();
    const sourceLocationId = gs.player.currentLocationId;
    const sourcePeriod     = gs.timePeriod;

    let proposal: TurnResolution;
    let resolution: TurnResolution;
    if (directMoveTargetId) {
      // 確定的移動意圖：等效於 Phase 1 + Judge 輸出 move=targetId；時間由下方 findPath 覆寫
      proposal   = { narrativeSummary: '(engine-resolved move)', move: directMoveTargetId, timeMinutes: 10 };
      resolution = { ...proposal, reasoning: 'direct move from thought candidate — LLM phase 1/judge skipped' };
      if (traceId != null) addTracePhase(traceId, 'dm-phase1', proposal);
    } else {
      // ── Phase 1: DM decides all signals as structured JSON ────────────────
      let dmPhase1Error: string | undefined;
      try {
        proposal = await this.dm.narrateIntent(sceneCtx, action, gs.history);
      } catch (err) {
        log.warn('DM proposal failed', err);
        dmPhase1Error = String(err);
        proposal = { narrativeSummary: '[proposal error]', timeMinutes: 10 };
      }
      // ── Trace: DM Phase 1 ────────────────────────────────────────────────
      if (traceId != null) {
        addTracePhase(traceId, 'dm-phase1', proposal, {
          raw: this.dm.lastRaw || undefined,
          error: dmPhase1Error ?? (proposal.narrativeSummary === '[intent parse error]' ? 'JSON parse failed' : undefined),
        });
      }

      // ── Judge validates constraints; accepts DM values by default ─────────
      let judgeError: string | undefined;
      try {
        resolution = await this.judge.resolve(proposal, action, sceneCtx);
      } catch (err) {
        log.warn('Judge resolve failed', err);
        judgeError = String(err);
        resolution = { timeMinutes: proposal.timeMinutes ?? 10, suggestions: proposal.suggestions, reasoning: '[judge error]' };
      }
      // ── Trace: Judge ─────────────────────────────────────────────────────
      if (traceId != null) {
        addTracePhase(traceId, 'judge', resolution, {
          raw: this.judge.lastRaw || undefined,
          error: judgeError ?? (resolution.reasoning === '[judge parse error]' ? 'JSON parse failed' : undefined),
        });
      }
    }

    // ── Deterministic post-validation (engine-side) ───────────────────────

    // 0. Action-type gate: only free/move actions may resolve to movement.
    //    Targeted examine, use, rest, etc. must never be reinterpreted as a move.
    if (resolution.move && action.type !== 'free' && action.type !== 'move') {
      log.debug('Move cleared — action type does not allow movement', { type: action.type, move: resolution.move });
      resolution.move = undefined;
    }

    // 1. Move validation: accept direct exits OR multi-hop navigation destination.
    //    If accepted, override timeMinutes with engine-calculated path time.
    if (resolution.move) {
      const resolvedLoc  = this.lore.resolveLocation(sourceLocationId, this.state.flags);
      const isDirectExit = resolvedLoc?.connections.some(c => c.targetLocationId === resolution.move) ?? false;
      const isNavTarget  = sceneCtx.includes(`Destination: [${resolution.move}]`);
      if (!isDirectExit && !isNavTarget) {
        const invalidMove = resolution.move;
        const connList = resolvedLoc?.connections.map(c => c.targetLocationId).join(',') ?? 'null';
        resolution.move      = undefined;
        resolution.reasoning = (resolution.reasoning ? resolution.reasoning + '; ' : '') +
          `move "${invalidMove}" not in exits or nav route — cleared (src=${sourceLocationId}, conns=[${connList}])`;
      } else {
        const accessCtx = {
          timePeriod:    sourcePeriod,
          gameTime:      gs.time,
          knownIntelIds: gs.player.knownIntelIds,
          activeQuests:  Object.values(gs.activeQuests),
          inventory:     gs.player.inventory,
          melphin:       gs.player.melphin,
        };
        const discovered = new Set([...gs.discoveredLocationIds, sourceLocationId]);
        for (const locId of [...discovered]) {
          const loc = this.lore.resolveLocation(locId, this.state.flags);
          if (loc) for (const conn of loc.connections) discovered.add(conn.targetLocationId);
        }
        discovered.add(resolution.move);
        const pathResult = this.lore.findPath(sourceLocationId, resolution.move, this.state.flags, accessCtx, discovered);
        if (pathResult) resolution.timeMinutes = pathResult.totalTime;
      }
    }

    // 1b. Non-move time: DM's decided time is authoritative.
    if (!resolution.move && proposal.timeMinutes) {
      resolution.timeMinutes = proposal.timeMinutes;
    }

    // 1c. 長時間行動（等待、消磨時間）：時長仍由 LLM 決定，但夾在上限內；
    //     與休息相同，若途中會跨越定時事件（triggerHours 整點／timeRanges 窗口起點），
    //     在觸發點截斷，事件於 4.5 的時間推進後觸發並另行敘述。
    let forcedEffectiveMinutes: number | undefined;
    if (!resolution.move && resolution.timeMinutes && turnStartTime) {
      resolution.timeMinutes = Math.min(MAX_ACTION_MINUTES, resolution.timeMinutes);
      const effective   = Math.round(resolution.timeMinutes * this.getActionTimeCostMultiplier());
      const provisional = gs.time.totalMinutes - turnStartTime.totalMinutes;
      const remaining   = effective - provisional;
      if (effective >= GameController.LONG_ACTION_INTERRUPT_MINUTES && remaining > 0) {
        const offset = this.peekTimedInterruptOffset(remaining);
        if (offset !== null && offset < remaining) {
          forcedEffectiveMinutes = provisional + offset;
          (resolution as TurnResolution & { _forcedEffectiveMinutes?: number })._forcedEffectiveMinutes = forcedEffectiveMinutes;
          resolution.reasoning = (resolution.reasoning ? resolution.reasoning + '; ' : '') +
            `long action truncated at scheduled event: ${effective} → ${forcedEffectiveMinutes} min`;
        }
      }
    }

    // 2. Flag validation: only allow flags that pass proximity + manifest check.
    const proxCtx = this.buildProximityContext(gs);
    if (resolution.flagsSet?.length) {
      const signals = resolution.flagsSet.map(id => ({ action: 'set' as const, flagId: id }));
      resolution.flagsSet = this.lore.flagRegistry.validateSignals(signals, proxCtx).map(s => s.flagId);
    }
    if (resolution.flagsUnset?.length) {
      const signals = resolution.flagsUnset.map(id => ({ action: 'unset' as const, flagId: id }));
      resolution.flagsUnset = this.lore.flagRegistry.validateSignals(signals, proxCtx).map(s => s.flagId);
    }

    // 3. Encounter validation: entity must be present and visible in the current scene.
    if (resolution.encounter) {
      const resolvedLoc = this.lore.resolveLocation(sourceLocationId, this.state.flags, sourcePeriod);
      const enc = resolution.encounter;
      if (enc.type === 'dialogue') {
        const inLocation = enc.npcId && (resolvedLoc?.npcIds.includes(enc.npcId) ?? false);
        const visibleNow = inLocation && !!this.lore.resolveNPC(enc.npcId!, this.state.flags, sourcePeriod);
        if (!visibleNow) {
          const reason = !inLocation
            ? `NPC ${enc.npcId} is not in location npcIds`
            : `NPC ${enc.npcId} is not visible in current time period (${sourcePeriod ?? 'unknown'})`;
          resolution.encounter = undefined;
          resolution.reasoning = (resolution.reasoning ? resolution.reasoning + '; ' : '') + reason;
        }
      } else if (enc.type === 'event') {
        const encId = enc.encounterId;
        const reachable = encId && (resolvedLoc?.eventIds ?? []).some(eid => {
          const evt = this.lore.getEvent(eid);
          return evt?.outcomes.some(o => o.startEncounterId === encId);
        });
        if (!reachable) {
          resolution.encounter = undefined;
          resolution.reasoning = (resolution.reasoning ? resolution.reasoning + '; ' : '') +
            `Event encounter ${encId} not reachable from current location`;
        }
      }
    }

    // ── Apply flags from resolution ───────────────────────────────────────
    if (resolution.flagsSet?.length) {
      log.debug('Resolution flags set', { flags: resolution.flagsSet });
      for (const flagId of resolution.flagsSet) this.state.flags.set(flagId);
    }
    if (resolution.flagsUnset?.length) {
      log.debug('Resolution flags unset', { flags: resolution.flagsUnset });
      for (const flagId of resolution.flagsUnset) this.state.flags.unset(flagId);
    }

    // ── Apply CONSUME from resolution ────────────────────────────────────
    if (resolution.consumeItemInstanceId) {
      const instanceId = resolution.consumeItemInstanceId;
      const invItem    = this.state.getState().player.inventory.find(i => i.instanceId === instanceId);
      const itemDef    = invItem ? this.lore.getItem(invItem.itemId) : undefined;
      if (itemDef?.type === 'consumable') {
        const consumed = this.state.consumeItem(instanceId, itemDef.effect ?? {}, id => this.lore.getCondition(id), id => this.lore.getItem(id));
        if (consumed) log.info('Item consumed', { instanceId, itemId: invItem!.itemId });
      }
    }

    // ── Apply MOVE from resolution ────────────────────────────────────────
    // Once deterministic validation keeps resolution.move, treat it as authoritative.
    // Raw text turns and DM suggestion clicks often begin as "free" before Judge resolves
    // them into a concrete movement, so re-gating on action.type can drop valid moves.
    if (resolution.move) {
      const gsCurrent  = this.state.getState();
      const discovered = new Set(gsCurrent.discoveredLocationIds);
      discovered.add(gsCurrent.player.currentLocationId);
      for (const locId of [...discovered]) {
        const loc = this.lore.resolveLocation(locId, this.state.flags);
        if (loc) for (const conn of loc.connections) discovered.add(conn.targetLocationId);
      }
      discovered.add(resolution.move);

      const pathResult = this.lore.findPath(
        gsCurrent.player.currentLocationId,
        resolution.move,
        this.state.flags,
        {
          timePeriod:    sourcePeriod,
          gameTime:      gsCurrent.time,
          knownIntelIds: gsCurrent.player.knownIntelIds,
          activeQuests:  Object.values(gsCurrent.activeQuests),
          inventory:     gsCurrent.player.inventory,
          melphin:       gsCurrent.player.melphin,
        },
        discovered,
      );

      if (pathResult) {
        for (const nodeId of pathResult.path) this.state.discoverLocation(nodeId);
        this.state.movePlayer(resolution.move);
        resolution.timeMinutes = pathResult.totalTime;
        log.info('Player moved', { to: resolution.move, hops: pathResult.path.length - 1, time: pathResult.totalTime, bypass: pathResult.usedBypass });
      } else if (!this.lore.resolveLocation(resolution.move, this.state.flags)) {
        log.warn('Resolution MOVE references unknown location', { locationId: resolution.move });
        resolution.move = undefined;
      } else {
        // Check for attempt encounter before clearing the move
        const attemptLoc = this.lore.resolveLocation(gsCurrent.player.currentLocationId, this.state.flags, gsCurrent.timePeriod);
        const attemptConn = attemptLoc?.connections.find(c => c.targetLocationId === resolution.move);
        if (attemptConn) {
          const attemptResult = this.lore.getConnectionAccessResult(
            attemptConn, this.state.flags, gsCurrent.timePeriod, gsCurrent.player.knownIntelIds,
            Object.values(gsCurrent.activeQuests), gsCurrent.time, gsCurrent.player.inventory, gsCurrent.player.melphin,
            { reputation: gsCurrent.player.externalStats.reputation, affinity: gsCurrent.player.externalStats.affinity,
              attemptCooldowns: gsCurrent.attemptCooldowns, connectionKey: gsCurrent.player.currentLocationId + '→' + attemptConn.targetLocationId },
          );
          if (!attemptResult.allowed && attemptResult.attemptEncounterId) {
            // Signal the attempt encounter back to submitAction via a special field
            (resolution as any)._attemptEncounter = {
              encounterId: attemptResult.attemptEncounterId,
              connectionKey: gsCurrent.player.currentLocationId + '→' + attemptConn.targetLocationId,
              cooldownMinutes: attemptConn.access?.attemptCooldownMinutes,
              totalMinutes: gsCurrent.time.totalMinutes,
            };
          }
        }
        log.warn('Resolution MOVE: no accessible path found', { from: gsCurrent.player.currentLocationId, to: resolution.move });
        resolution.move = undefined;
      }
    }

    // ── Trace: final resolution (after deterministic validation) ───────
    if (traceId != null) {
      addTracePhase(traceId, 'resolution', resolution);
    }

    // ── Log to shadow comparisons (for DebugPanel / tests) ───────────────
    if (get(shadowModeActive)) {
      const divergences: string[] = [];
      if (proposal.move !== resolution.move) {
        divergences.push(`MOVE: DM="${proposal.move ?? 'null'}" → Judge="${resolution.move ?? 'null'}"`);
      }
      if (proposal.timeMinutes !== resolution.timeMinutes) {
        divergences.push(`TIME: DM=${proposal.timeMinutes ?? 'null'} → Judge=${resolution.timeMinutes ?? 'null'}`);
      }
      const pFlags = [...(proposal.flagsSet   ?? [])].sort();
      const rFlags = [...(resolution.flagsSet  ?? [])].sort();
      if (JSON.stringify(pFlags) !== JSON.stringify(rFlags)) {
        divergences.push(`FLAGS+: DM=[${pFlags.join(',')}] → Judge=[${rFlags.join(',')}]`);
      }
      const encKey = (enc: TurnResolution['encounter']) =>
        enc ? `${enc.type}:${enc.npcId ?? enc.encounterId ?? ''}` : 'null';
      if (encKey(proposal.encounter) !== encKey(resolution.encounter)) {
        divergences.push(`ENCOUNTER: DM="${encKey(proposal.encounter)}" → Judge="${encKey(resolution.encounter)}"`);
      }
      const entry: ExplorationShadowComparison = {
        type:            'exploration',
        turn:            gs.turn,
        actionInput:     action.input,
        dmProposal:      proposal,
        judgeResolution: resolution,
        divergences,
      };
      pushShadowComparison(entry);
    }

    // ── Phase 2: Stream DM narration ─────────────────────────────────────
    // 引擎已決定的實際起訖時刻（結構化插值），避免敘述與實際時間矛盾
    let resolvedTimeCtx = '';
    if (turnStartTime && resolution.timeMinutes) {
      // 與 4.5 的時間推進同一算法：forced（中斷）優先，否則 timeMinutes × 狀態乘數
      const totalMinutes = forcedEffectiveMinutes
        ?? Math.round(resolution.timeMinutes * this.getActionTimeCostMultiplier());
      const end = this.timeMgr.advance(turnStartTime, Math.max(totalMinutes, gs.time.totalMinutes - turnStartTime.totalMinutes));
      resolvedTimeCtx = '\n\n## Resolved Time (engine)\n'
        + `This action lasts ${end.totalMinutes - turnStartTime.totalMinutes} min: `
        + `${formatClock(turnStartTime.hour, turnStartTime.minute)} → ${formatClock(end.hour, end.minute)}. `
        + 'Narrate consistently with this end time; do not state a different duration or clock time.'
        + (forcedEffectiveMinutes !== undefined
          ? ' The wait is cut short at this time by a scheduled happening, which will be narrated separately — do not describe it.'
          : '');
    }
    // 確定移動：Phase 2 沒有 Phase 1 JSON 可依，明確告知引擎的移動結果，避免敘述成走到別處
    if (directMoveTargetId) {
      const dest = this.lore.resolveLocation(directMoveTargetId, this.state.flags, sourcePeriod);
      const destName = dest?.name ?? directMoveTargetId;
      resolvedTimeCtx += '\n\n## Resolved Move (engine)\n' + (resolution.move
        ? `The player moves to [${directMoveTargetId}] ${destName}. Destination: ${dest?.description ?? ''}\n`
          + 'Narrate the departure and arrival at this destination only; do not send the player anywhere else.'
        : `The player tries to go to ${destName} but cannot get through. Narrate the failed attempt; the player stays here.`);
    }
    isStreaming.set(true);
    // Use pre-existing thinking line (pushed before Regulator) if available, else push a new one
    const effectiveThinkingId = thinkingLineId ?? pushLine('···', 'system');
    let thinkingCleared = false;

    let fullText = '';
    let signalCutoff = -1;
    try {
      for await (const chunk of this.dm.narrate(sceneCtx + resolvedTimeCtx, action, this.state.getState().history)) {
        // Replace thinking indicator with narrative line on first chunk
        if (!thinkingCleared) {
          narrativeLines.update(lines => lines.filter(l => l.id !== effectiveThinkingId));
          pushLine('', 'narrative');
          thinkingCleared = true;
        }
        const prevLen = fullText.length;
        fullText += chunk;
        if (signalCutoff === -1) {
          const idx = fullText.indexOf('<<');
          if (idx !== -1) {
            if (idx > prevLen) appendToLastLine(fullText.slice(prevLen, idx));
            signalCutoff = idx;
          } else {
            appendToLastLine(chunk);
          }
        }
        // signalCutoff set → swallow remaining chunks silently
      }
    } catch (err) {
      log.error('DM narration failed', err);
      if (!thinkingCleared) {
        narrativeLines.update(lines => lines.filter(l => l.id !== effectiveThinkingId));
        pushLine('', 'narrative');
      }
      appendToLastLine('\n[narration error -- please retry]');
    } finally {
      isStreaming.set(false);
    }

    // Suggestions come from Judge resolution, not DM narrative stream
    const suggestions: string[] = resolution.suggestions ?? [];

    const cleanNarrative = this.sanitizeDMOutput(fullText);

    if (cleanNarrative !== fullText) {
      narrativeLines.update(lines => {
        if (lines.length === 0) return lines;
        const last = lines[lines.length - 1];
        return [...lines.slice(0, -1), { ...last, text: cleanNarrative, isStreaming: false }];
      });
    } else {
      finishLastLine();
    }

    this.state.appendHistory(action, cleanNarrative.slice(0, 200));
    this.state.setLastNarrative(cleanNarrative);

    return { resolution, suggestions };
  }

  // -- Dialogue encounter -----------------------------------------------

  /**
   * Handle player input while in a dialogue encounter with npcId.
   * Bypasses Regulator; routes DM Phase 1 → Judge → Phase 2 narration.
   * @param opener  true = NPC opens conversation (post-scripted or encounter start), skip scripted
   *                trigger re-check and don't log a player line.
   */
  /**
   * Detect whether the player's input expresses clear intent to leave the conversation.
   * Patterns must be unambiguous — avoid bare words that appear in normal questions
   * (e.g. "離開" alone would match "離開這裡要多久？").
   */
  private detectLeaveIntent(input: string): boolean {
    const patterns = [
      /告辭/, /我先走/, /我走了/, /我得走/, /先告辭/, /不打擾/, /我回去了/, /再見/, /掰掰/,
      /\bbye\b/i, /\bgoodbye\b/i, /\bfarewell\b/i,
    ];
    return patterns.some(p => p.test(input));
  }

  /**
   * Immediately close the NPC dialogue without waiting for DM.
   * Used when player expresses clear leave intent or clicks the exit button.
   */
  async forceCloseDialogue(npcId: string): Promise<void> {
    const npc  = this.lore.getNPC(npcId);
    const name = npc?.name ?? 'NPC';
    pushLine(`（你結束了與 ${name} 的對話。）`, 'system');
    this.state.appendHistory(
      { type: 'interact', input: `（與 ${name} 交談）`, targetId: npcId },
      '（對話結束）',
    );
    activeNpcUI.set(null);
    encounterSessionLog.set([]);
    this._sessionFiredTriggers.clear(); this._scriptedFiredThisSession = false;
    this.syncUIState(this.state.getState());
    await this.exitDialogueThoughts();
  }

  /** Public alias for the UI exit button in NPCPanel. */
  exitDialogue(): void {
    const enc = get(activeNpcUI);
    if (!enc) return;
    void this.forceCloseDialogue(enc.npcId);
  }

  private async handleDialogueInput(text: string, npcId: string, opener = false): Promise<void> {
    // 重入鎖：必須在第一個 await 之前同步檢查並設定，否則自由輸入/想法點選的
    // 連續觸發（例如 opener 期間又送出一次輸入）會並發跑兩次，產生兩個 NPC 發言框，
    // 第一個因 "last line" 位置被第二個蓋過而永遠空白（即 to-do 的殘留 bug）。
    if (this._dialogueInputBusy) {
      log.warn('handleDialogueInput re-entrant call ignored', { npcId, opener });
      return;
    }
    this._dialogueInputBusy = true;
    try {
      await this.handleDialogueInputInner(text, npcId, opener);
    } finally {
      this._dialogueInputBusy = false;
      // 集中在此釋放 input——被重入鎖擋下的呼叫不會執行到這裡，避免它提前把
      // 仍在進行中的第一個呼叫的 inputDisabled 重新打開。
      inputDisabled.set(false);
    }
  }

  private async handleDialogueInputInner(text: string, npcId: string, opener = false): Promise<void> {
    const npc = this.lore.resolveNPC(npcId, this.state.flags, this.state.getState().timePeriod);
    if (!npc) {
      // NPC gone — exit encounter silently
      activeNpcUI.set(null);
      encounterSessionLog.set([]);
      this._sessionFiredTriggers.clear(); this._scriptedFiredThisSession = false;
      return;
    }

    // Check for scripted trigger before LLM dialogue (skip in opener mode — already checked).
    // Also skip if a scripted node already fired in this encounter session — once scripted
    // dialogue transitions to LLM, no further scripted triggers should fire until the session resets.
    if (!opener && !this._scriptedFiredThisSession) {
      const interactionCount = this.state.getState().npcMemory[npcId]?.interactionCount ?? 0;
      const scripted = this.dialogueMgr.checkScriptedTrigger(
        npcId, npc.activeDialogueId, this.state.flags, interactionCount,
        this._sessionFiredTriggers,
      );
      if (scripted) {
        this._sessionFiredTriggers.add(scripted.nodeId);
        await this.activateScriptedNode(npcId, scripted.dialogueId, npc.name, scripted.nodeId, scripted.node, scripted.endAfterScript);
        return;
      }
    }

    const npcContext = this.dialogueMgr.buildNPCDialogueContext(npcId, npc.activeDialogueId, this.state.flags);

    // ── Trace: start dialogue turn ────────────────────────────────────
    const gs = this.state.getState();
    const dlgTraceId = startTrace(gs.turn, 'dialogue', `dialogue: ${npc.name} — ${text.slice(0, 40)}`, {
      locationId: gs.player.currentLocationId,
      npcId,
    });
    addTracePhase(dlgTraceId, 'input', { playerInput: text, npcId, npcName: npc.name, opener });
    addTracePhase(dlgTraceId, 'context', npcContext);

    // Snapshot log BEFORE appending current player turn (playerInput is passed separately to DM)
    const sessionLog = get(encounterSessionLog) as DialogueLogEntry[];

    // Turn budget: each completed turn = 2 log entries (player + NPC).
    // On the second-to-last turn, hint DM Phase 1 to set endEncounter; after max turns, force-close.
    const completedTurns = Math.floor(sessionLog.length / 2);
    const wrapUp = completedTurns >= GameController.MAX_DIALOGUE_TURNS - 1;

    // ── Phase 1: DM decides signals ────────────────────────────────────
    let proposal: DialogueResolution;
    let dmDlgError: string | undefined;
    try {
      proposal = await this.dm.narrateDialogueIntent(npcContext, sessionLog, text, { wrapUp });
    } catch (err) {
      log.error('Dialogue DM Phase 1 failed', err);
      dmDlgError = String(err);
      proposal = { endEncounter: false };
    }
    addTracePhase(dlgTraceId, 'dm-phase1', proposal, {
      raw: this.dm.lastRaw || undefined,
      error: dmDlgError ?? (proposal.narrativeSummary === '[dialogue intent parse error]' ? 'JSON parse failed' : undefined),
    });

    // ── Judge: validate constraints ────────────────────────────────────
    let resolution: DialogueResolution;
    let judgeDlgError: string | undefined;
    try {
      resolution = await this.judge.resolveDialogue(proposal, npcId, npcContext);
    } catch (err) {
      log.error('Dialogue Judge failed', err);
      judgeDlgError = String(err);
      resolution = { ...proposal };
    }
    addTracePhase(dlgTraceId, 'judge', resolution, {
      raw: this.judge.lastRaw || undefined,
      error: judgeDlgError ?? (resolution.reasoning === '[dialogue judge parse error]' ? 'JSON parse failed' : undefined),
    });

    // ── Apply flags (engine-validated, same whitelist as exploration path) ──
    const dialogueProxCtx = this.buildProximityContext(this.state.getState());
    if (resolution.flagsSet?.length) {
      const signals = resolution.flagsSet.map(id => ({ action: 'set' as const, flagId: id }));
      resolution.flagsSet = this.lore.flagRegistry.validateSignals(signals, dialogueProxCtx).map(s => s.flagId);
    }
    if (resolution.flagsUnset?.length) {
      const signals = resolution.flagsUnset.map(id => ({ action: 'unset' as const, flagId: id }));
      resolution.flagsUnset = this.lore.flagRegistry.validateSignals(signals, dialogueProxCtx).map(s => s.flagId);
    }
    for (const f of (resolution.flagsSet ?? []))   this.state.flags.set(f);
    for (const f of (resolution.flagsUnset ?? [])) this.state.flags.unset(f);

    // Force-close if turn budget exceeded
    const forceClose = !resolution.endEncounter
      && completedTurns >= GameController.MAX_DIALOGUE_TURNS;
    const shouldEnd = resolution.endEncounter || forceClose;

    // ── Log to shadow comparisons (for DebugPanel) ─────────────────────
    if (get(shadowModeActive)) {
      const dialogueDivergences: string[] = [];
      if (proposal.endEncounter !== resolution.endEncounter) {
        dialogueDivergences.push(`END: DM=${proposal.endEncounter} → Judge=${resolution.endEncounter}`);
      }
      if (proposal.npcState?.attitude !== resolution.npcState?.attitude) {
        dialogueDivergences.push(`ATTITUDE: DM="${proposal.npcState?.attitude ?? '—'}" → Judge="${resolution.npcState?.attitude ?? '—'}"`);
      }
      if (proposal.timeMinutes !== resolution.timeMinutes) {
        dialogueDivergences.push(`TIME: DM=${proposal.timeMinutes ?? '—'} → Judge=${resolution.timeMinutes ?? '—'}`);
      }
      const pFlags = [...(proposal.flagsSet ?? [])].sort();
      const rFlags = [...(resolution.flagsSet ?? [])].sort();
      if (JSON.stringify(pFlags) !== JSON.stringify(rFlags)) {
        dialogueDivergences.push(`FLAGS+: DM=[${pFlags.join(',')}] → Judge=[${rFlags.join(',')}]`);
      }
      const dlgGs = this.state.getState();
      const dialogueEntry: DialogueShadowComparison = {
        type:            'dialogue',
        turn:            dlgGs.turn,
        npcId,
        playerInput:     text,
        dmProposal:      proposal,
        judgeResolution: resolution,
        divergences:     dialogueDivergences,
      };
      pushShadowComparison(dialogueEntry);
    }

    // Guard: if dialogue was closed during Phase 1 / Judge (user clicked exit), abort.
    if (get(activeNpcUI) === null) return;

    // ── Phase 2: stream narration ──────────────────────────────────────
    isStreaming.set(true);
    // 以回傳的 line id 定位，而非「最後一行」——避免與併發/被打斷的呼叫互相覆蓋，
    // 也讓串流中途被強制結束對話時能正確收尾（見下方 aborted 分支）。
    const npcLineId = pushLine(npc.name + '：', 'dialogue', true);

    let fullText     = '';
    let signalCutoff = -1;
    let streamError  = false;
    let aborted      = false;
    try {
      for await (const chunk of this.dm.narrateDialogue(npcContext, sessionLog, text, { endEncounter: shouldEnd })) {
        // 對話在串流期間被強制結束（玩家點退出／偵測到離開意圖）——立刻停止，
        // 不再把後續 chunk 誤寫到別的行（修正 to-do：結束對話後仍有一次 LLM 輸出殘留）。
        if (get(activeNpcUI) === null) { aborted = true; break; }
        const prevLen = fullText.length;
        fullText += chunk;
        if (signalCutoff === -1) {
          const idx = fullText.indexOf('<<');
          if (idx !== -1) {
            if (idx > prevLen) appendToLine(npcLineId, fullText.slice(prevLen, idx));
            signalCutoff = idx;
          } else {
            appendToLine(npcLineId, chunk);
          }
        }
      }
    } catch (err) {
      streamError = true;
      log.error('Dialogue DM narration failed', err);
      appendToLine(npcLineId, '\n[narration error -- please retry]');
      finalizeLine(npcLineId, undefined, npc.name + '：');
    } finally {
      isStreaming.set(false);
    }

    if (streamError) return;

    // Guard: if the encounter was force-closed during streaming (e.g. player clicked exit),
    // discard the in-flight response and do not reopen the NPC panel. Finalize (or remove,
    // if empty) the placeholder line first so it never lingers as a blank cursor — the line
    // starts life as just "NPC名：" (pushLine's seed text), so blank-ness must be judged on
    // what comes AFTER that prefix, not the raw (always non-empty) text.
    if (aborted || get(activeNpcUI) === null) {
      finalizeLine(npcLineId, undefined, npc.name + '：');
      return;
    }

    // 對話中的候選改由敘述串流末尾的 <<THOUGHTS>> 訊號提供（比照休息流程），而非 Phase 1
    // JSON 的 suggestions 欄位——同一來源即顯示文字，較不會混入探索類候選。
    // LLM 未給訊號時維持空陣列；refreshThoughts 會補上固定的「結束對話」選項。
    const suggestions: string[] = extractEncounterThoughts(fullText);

    // Clean narration: strip signal markers
    const cleanNarrative = this.sanitizeDMOutput(fullText);

    // Patch displayed line with NPC name prefix, finalized as dialogue type.
    // Empty narration (e.g. parse/stream edge case) removes the line instead of
    // leaving an empty bubble behind — blank-check is on cleanNarrative, not the
    // (always non-empty once prefixed) full text.
    finalizeLine(npcLineId, npc.name + '：' + cleanNarrative, npc.name + '：');

    // ── Apply NPC state from resolution ────────────────────────────────
    if (resolution.npcState) {
      this.state.recordNPCInteraction(npcId);
      this.checkNPCKnowledgeTriggers(npcId);
      this.state.updateNPCDialogueState(npcId, resolution.npcState.topic, resolution.npcState.attitude);
    }

    // ── Apply quest signals from resolution ────────────────────────────
    // Discard any signal whose type is not a known enum value — prevents LLM typos
    // (e.g. "complete", "fail") from accidentally advancing quest state.
    for (const qs of (resolution.questSignals ?? [])) {
      if (qs.type !== 'flag' && qs.type !== 'objective') continue;
      this.quests.applyQuestSignal(qs.questId, qs.type, qs.value);
    }

    // Append this turn to session log (skip player entry in opener mode)
    if (!opener) appendEncounterLog('player', text);
    appendEncounterLog('npc', cleanNarrative);

    // ── Advance time + sweep time-crossing events ──────────────────────
    const rawTimeMinutes = resolution.timeMinutes;
    const dlgTimeMinutes = rawTimeMinutes
      ? Math.round(rawTimeMinutes * this.getActionTimeCostMultiplier())
      : undefined;
    let timeTriggeredEncounters: { id: string; def: ReturnType<LoreVault['getEncounter']> }[] = [];
    if (dlgTimeMinutes) {
      const gs         = this.state.getState();
      const beforeTime = gs.time;  // snapshot before advanceTime replaces this.state.time
      const schedule   = this.lore.getSchedule(this.currentRegionId) ?? null;
      const newTime    = this.timeMgr.advance(beforeTime, dlgTimeMinutes);
      const newPeriod  = schedule
        ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs.player.activeFlags)
        : gs.timePeriod;
      const periodChanged = this.state.advanceTime(newTime, newPeriod);
      this.state.tickItemExpiry(id => this.lore.getItem(id)?.expiresAfterMinutes);

      // Sweep time-crossing events so dialogue turns don't silently skip quest fails,
      // broadcasts, or location events (mirrors the exploration main path).
      const crossedHours = this.timeMgr.computeCrossedHours(beforeTime, newTime);
      if (crossedHours.length > 0) {
        if (!this.state.flags.has('game_day1_started') && crossedHours.includes(0)) {
          this.state.flags.set('game_day1_started');
        }
        if (crossedHours.includes(0)) {
          for (const prop of this.lore.getAllProps()) {
            for (const flag of prop.dailyResetFlags ?? []) {
              this.state.unsetPropFlag(prop.id, flag);
            }
          }
        }
        const eventsEnabled = this.state.flags.has('game_day1_started');
        const qfTriggered  = eventsEnabled ? this.checkQuestFailConditions(crossedHours) : [];
        const glTriggered  = eventsEnabled ? this.events.checkGlobalEvents(this.currentRegionId, crossedHours) : [];
        const locTriggered = eventsEnabled ? this.events.checkAndApply(gs.player.currentLocationId, crossedHours) : [];
        const timeTriggered = [...qfTriggered, ...glTriggered, ...locTriggered];
        if (timeTriggered.length > 0) {
          const { eventEncounters, extraTriggered } = this.processTriggeredEvents(timeTriggered);
          const allTimeTriggered = [...timeTriggered, ...extraTriggered];
          const timeEventCtx = this.buildSceneCtx(allTimeTriggered, periodChanged);
          await this.runEventDM(timeEventCtx, allTimeTriggered.some(t => t.notification) ? 'event' : 'narrative');
          this.flushAcquisitions();
          timeTriggeredEncounters = eventEncounters;
        }
      }
    }

    // ── Handle encounter end ───────────────────────────────────────────
    // Must happen BEFORE updateActiveNpcUI to prevent interaction count increment
    // from triggering a scripted dialogue restart.
    if (shouldEnd) {
      if (forceClose) {
        log.info('Dialogue force-closed: turn budget exhausted', { npcId });
      } else {
        log.info('Encounter ended naturally', { npcId });
      }
      activeNpcUI.set(null);
      encounterSessionLog.set([]);
      this._sessionFiredTriggers.clear(); this._scriptedFiredThisSession = false;
      this.state.appendHistory(
        { type: 'interact', input: `（與 ${npc.name} 交談）`, targetId: npcId },
        cleanNarrative.slice(0, 200),
      );
    } else {
      // Refresh NPC panel with updated affinity/attitude only if encounter is still active
      this.updateActiveNpcUI(npcId);
    }

    this.syncUIState(this.state.getState());

    // Launch any encounters triggered by time events during this dialogue turn, sequentially.
    // If dialogue hasn't ended naturally, force-close it first — encounters take priority
    // and cannot run concurrently with an active NPC conversation.
    if (timeTriggeredEncounters.length > 0 || this._npcDialogueQueue.length > 0) {
      if (!shouldEnd) {
        log.info('Dialogue interrupted by time-triggered encounter', { npcId, encounterId: timeTriggeredEncounters[0]?.id });
        activeNpcUI.set(null);
        encounterSessionLog.set([]);
        this._sessionFiredTriggers.clear(); this._scriptedFiredThisSession = false;
        this.state.appendHistory(
          { type: 'interact', input: `（與 ${npc.name} 交談）`, targetId: npcId },
          cleanNarrative.slice(0, 200),
        );
        this.syncUIState(this.state.getState());
      }
      // 對話被事件打斷結束——不還原快照（接下來立刻啟動另一個遭遇，由它自己的流程
      // 決定結束後的想法；快照留著會在未來某次不相關的對話結束時被誤用）。
      this._thoughtsSnapshot = null;
      this._thoughtsSnapshotFingerprint = null;
      for (const enc of timeTriggeredEncounters) this.enqueueEncounter(enc.id, enc.def ?? undefined);
      await this.startNextQueuedEncounter();
      this.flushAcquisitions();
      if (this.checkEndingConditions()) return;
      this.releaseInput();
      return;
    }

    if (shouldEnd) {
      // 對話已結束——還原進入對話前的探索想法快照（或視狀態變化改呼叫輕量 LLM），
      // 不再沿用 LLM 的 dialogue suggestions（endEncounter 時給的探索建議品質不穩定）。
      await this.exitDialogueThoughts();
    } else {
      // Refresh thoughts with dialogue-mode suggestions (still mid-conversation)
      await this.refreshThoughts(suggestions);
    }
  }

  // -- Structured encounter ---------------------------------------------

  /**
   * Called by UI when the player selects a choice in an active encounter.
   * Routes to EncounterEngine.selectChoice() and renders the resulting node.
   */
  async selectEncounterChoice(choiceId: string): Promise<void> {
    inputDisabled.set(true);

    // Pre-capture encounter state and definition BEFORE selectChoice() may clear them.
    // This is needed for (a) passing def to renderEncounterNode so outcome DM narration
    // works correctly, and (b) building the closing summary if the encounter ends.
    const preState   = this.state.getState();
    const preActive  = preState.activeEncounter;
    const preDef     = preActive ? this.lore.getEncounter(preActive.encounterId) : null;

    const resolved = this.encounterMgr.selectChoice(choiceId);
    let encounterEnded = false;

    // Handle high-level effects that EncounterEngine stored for us
    const pending = this.encounterMgr.flushPendingEffects();
    // Ditch must run before grant: if ditch fails the dependent grant is suppressed
    let questGrantAllowed = true;
    if (pending.questDitch) {
      questGrantAllowed = this.quests.ditchQuest(pending.questDitch);
      log.info('Quest ditched by encounter choice', { questId: pending.questDitch, success: questGrantAllowed });
    }
    if (questGrantAllowed && pending.questGrant) {
      this.quests.grantQuest(pending.questGrant);
      log.info('Quest granted by encounter choice', { questId: pending.questGrant });
    }
    if (pending.advanceQuestStage) {
      const { questId, stageId } = pending.advanceQuestStage;
      this.state.advanceQuestStage(questId, stageId);
      log.info('Quest stage advanced by encounter choice', { questId, stageId });
    }
    if (pending.completeQuestObjective) {
      const { questId, objectiveId } = pending.completeQuestObjective;
      this.quests.applyQuestSignal(questId, 'objective', objectiveId);
      log.info('Quest objective completed by encounter choice', { questId, objectiveId });
    }
    if (pending.movePlayer) {
      this.state.movePlayer(pending.movePlayer);
      log.info('Player moved by encounter choice', { locationId: pending.movePlayer });
    }
    if (pending.timeAdvance) {
      this.applyTimeAdvance(pending.timeAdvance);
      log.info('Time advanced by encounter choice', { minutes: pending.timeAdvance });
    }
    if (pending.questFail) {
      const failResult = this.quests.applyQuestFail(pending.questFail);
      log.info('Quest fail applied by encounter choice', { questId: pending.questFail });
      if (failResult.startEventId) {
        const sub = this.events.fireEventById(failResult.startEventId);
        if (sub) {
          const { eventEncounters: failEncs } = this.processTriggeredEvents([sub]);
          // Unshift so fail encounters run before any pre-queued interactions (e.g. prop)
          this._encounterQueue.unshift(...failEncs.map(e => ({ id: e.id, def: e.def ?? undefined })));
        }
      }
    }
    if (resolved) {
      // Render node via DM (passing def explicitly so it works even after endEncounter clears state)
      const nodeSuggestions = await this.renderEncounterNode(resolved, preDef ?? undefined);
      this.flushAcquisitions();

      if (pending.outcomeType !== undefined) {
        // Outcome node rendered — now conclude the encounter
        this.encounterMgr.conclude(pending.outcomeType);
        this.quests.checkObjectives();
        activeEncounterUI.set(null);
        this.syncUIState(this.state.getState());
        await this.refreshThoughts(nodeSuggestions);
        encounterEnded = true;
      }
    } else {
      // Encounter ended without an outcome node (nextNodeId === null or __continue__).
      // Generate a DM closing summary before returning to exploration.
      let closeSuggestions: string[] = [];
      if (preDef && preActive && !this.mockMode) {
        closeSuggestions = await this.streamEncounterClose(preDef, preActive.collectedNarrative);
      }
      this.flushAcquisitions();
      activeEncounterUI.set(null);
      this.syncUIState(this.state.getState());
      await this.refreshThoughts(closeSuggestions);
      encounterEnded = true;
    }

    // Drain encounter queue (fail encounters, prop interactions, etc.)
    if (encounterEnded && await this.startNextQueuedEncounter()) {
      this.flushAcquisitions();
      if (this.checkEndingConditions()) return;
      this.releaseInput();
      return;
    }

    // Encounter effects (stat changes, etc.) may have pushed the player past
    // an ending threshold — check before releasing input.
    if (this.checkEndingConditions()) return;

    this.releaseInput();
  }

  /**
   * story 型別遭遇專用：玩家點「繼續」推進到下一行。
   * 純效果行自動跳過並套用；最後一行結束後套用 result，清除 UI，恢復探索。
   */
  async selectEncounterStoryAdvance(): Promise<void> {
    inputDisabled.set(true);

    const preState  = this.state.getState();
    const preActive = preState.activeEncounter;
    const preDef    = preActive ? this.lore.getEncounter(preActive.encounterId) : null;

    const prevLineIndex = preActive?.currentLineIndex ?? -1;
    const result = this.encounterMgr.advanceLine();

    if (result) {
      // More batches remain — type out newly revealed lines (effects applied per-line inside)
      await this.renderStoryScript(result.script, prevLineIndex + 1, result.currentLineIndex, preDef ?? undefined);
    } else {
      // Last batch — render remaining lines, then apply result effects and end encounter
      if (preDef?.script) {
        const lastIdx = preDef.script.length - 1;
        if (prevLineIndex < lastIdx) {
          await this.renderStoryScript(preDef.script, prevLineIndex + 1, lastIdx, preDef ?? undefined);
        }
      }
      this.encounterMgr.concludeStory();
      this.applyStoryPendingEffects(this.encounterMgr.flushPendingEffects());
      this.quests.checkObjectives();
      this.flushAcquisitions();
      activeEncounterUI.set(null);
      this.syncUIState(this.state.getState());
      await this.refreshThoughts();

      // Drain encounter queue (e.g. follow-up encounters queued before this story ran)
      if (await this.startNextQueuedEncounter()) {
        this.flushAcquisitions();
        if (this.checkEndingConditions()) return;
        this.releaseInput();
        return;
      }
    }

    if (this.checkEndingConditions()) return;
    this.releaseInput();
  }

  /**
   * 計算玩家當前所有 condition 的行動時間乘數（相乘疊加）。
   * 供各個 timeMinutes 應用點呼叫。
   */
  /**
   * 長時間推進（休息、等待）的定時事件中斷探測：從目前時刻起 durationMinutes 內，
   * 找出最早會觸發的 triggerHours 事件整點，或 timeRanges 型非重複事件的窗口起點，
   * 回傳距今的分鐘偏移；無則回傳 null。不套用任何效果。
   */
  private peekTimedInterruptOffset(durationMinutes: number): number | null {
    const gs = this.state.getState();
    let best: number | null = null;

    const projectedEnd = this.timeMgr.advance(gs.time, durationMinutes);
    const startMins    = gs.time.hour * 60 + gs.time.minute;
    for (const h of this.timeMgr.computeCrossedHours(gs.time, projectedEnd)) {
      let diff = h * 60 - startMins;
      if (diff <= 0) diff += 1440;   // overnight wrap
      if (best !== null && diff >= best) continue;
      const wouldFire = this.events.peekHourlyInterrupts(
        this.currentRegionId,
        gs.player.currentLocationId,
        [h],
      );
      if (wouldFire.length > 0) best = diff;
    }

    // timeRanges 型非重複事件：跨越其時間窗起點時同樣中斷，停在窗口起點，
    // 避免一次推進跨過整個窗口而永久錯過（例：02:00 睡到 09:00 跨過 06:00–06:59）。
    const rangeOffset = this.events.peekTimeRangeInterrupt(
      this.currentRegionId,
      gs.player.currentLocationId,
      durationMinutes,
    );
    if (rangeOffset !== null && (best === null || rangeOffset < best)) best = rangeOffset;
    return best;
  }

  /** 目前時刻、時段表、門禁與接下來的公開時間點（供 Regulator 換算休息時長）。 */
  private buildClockContext(): string {
    const gs  = this.state.getState();
    const cfg = this.state.getCurfewConfig();
    return buildClockBlock({
      time:     gs.time,
      schedule: this.lore.getSchedule(this.currentRegionId) ?? null,
      curfew:   this.state.getEffectiveCurfew(),
      curfewDefaultStart: cfg ? { hour: cfg.startHour, minute: cfg.startMinute } : undefined,
    });
  }

  private getActionTimeCostMultiplier(): number {
    const conditions = this.state.getState().player.conditions;
    let multiplier = 1;
    for (const c of conditions) {
      const def = this.lore.getCondition(c.id);
      if (def?.actionTimeCostMultiplier) multiplier *= def.actionTimeCostMultiplier;
    }
    return multiplier;
  }

  /**
   * 推進遊戲時間（分鐘）。供遭遇效果的 timeAdvance 欄位使用。
   * 更新時鐘、時段、物品過期，但不觸發全域/地點事件掃描。
   */
  private applyTimeAdvance(minutes: number): void {
    const gs       = this.state.getState();
    const schedule = this.lore.getSchedule(this.currentRegionId) ?? null;
    const newTime  = this.timeMgr.advance(gs.time, minutes);
    const newPeriod = schedule
      ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs.player.activeFlags)
      : gs.timePeriod;
    this.state.advanceTime(newTime, newPeriod);
    this.state.tickItemExpiry(id => this.lore.getItem(id)?.expiresAfterMinutes);
  }

  /**
   * 套用 story 遭遇的 EncounterPendingEffects（quest grant / move / time 等高層效果）。
   * 供 renderStoryScript 每行後及 concludeStory 後使用，避免重複代碼。
   */
  private applyStoryPendingEffects(pending: EncounterPendingEffects): void {
    if (pending.questFail)  this.quests.applyQuestFail(pending.questFail);
    // Ditch before grant: grant is suppressed if ditch fails
    let storyGrantAllowed = true;
    if (pending.questDitch) {
      storyGrantAllowed = this.quests.ditchQuest(pending.questDitch);
    }
    if (storyGrantAllowed && pending.questGrant) this.quests.grantQuest(pending.questGrant);
    if (pending.advanceQuestStage) {
      const { questId, stageId } = pending.advanceQuestStage;
      this.state.advanceQuestStage(questId, stageId);
    }
    if (pending.completeQuestObjective) {
      const { questId, objectiveId } = pending.completeQuestObjective;
      this.quests.applyQuestSignal(questId, 'objective', objectiveId);
    }
    if (pending.movePlayer) {
      this.state.movePlayer(pending.movePlayer);
      log.info('Player moved by story line', { locationId: pending.movePlayer });
    }
    if (pending.timeAdvance) {
      this.applyTimeAdvance(pending.timeAdvance);
      log.info('Time advanced by story line', { minutes: pending.timeAdvance });
    }
  }

  /**
   * Renders a ResolvedNode to the narrative log and updates activeEncounterUI.
   * If the node has a dmNarrative (no hardcoded displayText), streams DM-generated narration.
   * Returns DM-generated thought suggestions when the node is an outcome node.
   */
  private async renderEncounterNode(
    resolved: ResolvedNode,
    def?: EncounterDefinition,
    isDebug = false,
  ): Promise<string[]> {
    const gs = this.state.getState();
    // Use the explicitly-passed def when available (e.g., after endEncounter clears state).
    const effectiveDef = def ?? this.lore.getEncounter(gs.activeEncounter?.encounterId ?? '');

    // Map encounter type to narrative line style.
    const encType = effectiveDef?.type ?? 'event';
    const lineType =
      encType === 'event'    ? 'event'    :  // blue — event encounter
      encType === 'story'    ? 'scene'    :  // gray italic — story/cutscene encounter
      encType === 'interact' ? 'interact' :  // prop interaction encounter
                               'narrative';  // default white — dialogue etc.

    // Stat check result prefix — always shown as a system line
    if (resolved.statCheckResult) {
      const { stat, dc, passed } = resolved.statCheckResult;
      const statLabel = stat.split('.').pop() ?? stat;
      pushLine(
        passed
          ? `[判定成功 — ${statLabel} ≥ ${dc}]`
          : `[判定失敗 — ${statLabel} < ${dc}]`,
        'system',
      );
    }

    let nodeText: string;

    if (resolved.node.displayText) {
      // Hardcoded text — display directly, no DM call
      nodeText = resolved.node.displayText;
      pushLine(nodeText, lineType);
      activeEncounterUI.set({
        encounterId:     resolved.node.id,
        encounterName:   effectiveDef?.name ?? '遭遇',
        type:            effectiveDef?.type ?? 'event',
        nodeText,
        choices:         resolved.visibleChoices,
        statCheckResult: resolved.statCheckResult,
      });
    } else if (resolved.node.dmNarrative && effectiveDef && !this.mockMode) {
      // DM-generated narration — show encounter frame immediately (no choices yet)
      // statCheckResult is omitted here — it was already shown via the first set;
      // including it again would re-trigger the overlay because of reference inequality.
      activeEncounterUI.set({
        encounterId:     resolved.node.id,
        encounterName:   effectiveDef.name,
        type:            effectiveDef.type ?? 'event',
        nodeText:        '',
        choices:         [],
      });
      // Stream narration — outcome nodes use a prompt that appends <<THOUGHTS:...>>
      let ctx = this.buildEncounterContext(effectiveDef, resolved);
      if (isDebug) {
        ctx = `[DEBUG MODE — 此遭遇由開發人員手動觸發，玩家實際位置可能與遭遇預期地點不符。請直接根據以下 Context 描述遭遇情況，無需顧慮地點一致性，以模擬測試為目的即可。]\n\n` + ctx;
      }
      nodeText = '';
      isStreaming.set(true);
      pushLine('', lineType, true);
      let encSignalCutoff = -1;
      try {
        for await (const chunk of this.dm.narrateEncounterNode(ctx, gs.history, resolved.isOutcome)) {
          const prevLen = nodeText.length;
          nodeText += chunk;
          if (encSignalCutoff === -1) {
            const idx = nodeText.indexOf('<<THOUGHTS');
            if (idx !== -1) {
              if (idx > prevLen) appendToLastLine(nodeText.slice(prevLen, idx));
              encSignalCutoff = idx;
            } else {
              appendToLastLine(chunk);
            }
          }
        }
      } catch (err) {
        log.error('Encounter DM narration failed', err);
        nodeText = resolved.node.dmNarrative;
        appendToLastLine(resolved.node.dmNarrative);
      } finally {
        isStreaming.set(false);
        finishLastLine();
      }
      // Reveal choices after narration completes
      const displayText = (encSignalCutoff === -1 ? nodeText : nodeText.slice(0, encSignalCutoff)).trimEnd();
      // Patch narrative line to remove any signal artifact at the cutoff boundary
      if (encSignalCutoff !== -1) {
        narrativeLines.update(lines => {
          if (lines.length === 0) return lines;
          const last = lines[lines.length - 1];
          if (last.text === displayText) return lines;
          return [...lines.slice(0, -1), { ...last, text: displayText }];
        });
      }
      activeEncounterUI.set({
        encounterId:     resolved.node.id,
        encounterName:   effectiveDef.name,
        type:            effectiveDef.type ?? 'event',
        nodeText:        displayText,
        choices:         resolved.visibleChoices,
        statCheckResult: resolved.statCheckResult,
      });
      // Return extracted thoughts suggestions for outcome nodes
      if (resolved.isOutcome) {
        return extractEncounterThoughts(nodeText);
      }
    } else {
      // Fallback: raw dmNarrative or placeholder (mock mode / no definition)
      nodeText = resolved.node.dmNarrative ?? '...';
      pushLine(nodeText, lineType);
      activeEncounterUI.set({
        encounterId:     resolved.node.id,
        encounterName:   effectiveDef?.name ?? '遭遇',
        type:            effectiveDef?.type ?? 'event',
        nodeText,
        choices:         resolved.visibleChoices,
        statCheckResult: resolved.statCheckResult,
      });
    }
    return [];
  }

  /**
   * 跳過目前進行中的打字機動畫，立即顯示所有剩餘文字。
   * 對應 EncounterPanel 的「跳過」按鈕。
   */
  selectEncounterStorySkip(): void {
    this._storySkipRequested = true;
  }

  /**
   * Renders story script lines [fromIndex..toIndex] with typewriter effect.
   * Each line is typed character-by-character into the narrative box.
   * Story scripts never go through DM — text is displayed directly.
   */
  private async renderStoryScript(
    script: ScriptLine[],
    fromIndex: number,
    toIndex: number,
    def?: EncounterDefinition,
  ): Promise<void> {
    const gs = this.state.getState();
    const effectiveDef = def ?? this.lore.getEncounter(gs.activeEncounter?.encounterId ?? '');

    // Update encounter header — script content goes into narrative box
    activeEncounterUI.set({
      encounterId:   effectiveDef?.id ?? '',
      encounterName: effectiveDef?.name ?? '劇情',
      type:          'story',
      nodeText:      '',
      choices:       [],
    });

    this._storySkipRequested = false;
    storyTypingActive.set(true);

    type LineCategory = 'narrator' | 'dialogue';
    let prevCategory: LineCategory | null = null;

    for (let i = fromIndex; i <= toIndex; i++) {
      const line = script[i];

      // Render text (if present)
      if (line?.text) {
        const isNarrator = !line.speaker || line.speaker === 'narrator';
        const isPlayer   = line.speaker === 'player';
        const lineType: NarrativeLine['type'] = isNarrator ? 'scene' : isPlayer ? 'player' : 'dialogue';
        const category: LineCategory = isNarrator ? 'narrator' : 'dialogue';
        const displayText = this.formatStoryLineText(line);

        // Blank spacer line when toggling between narrator and dialogue
        if (prevCategory !== null && prevCategory !== category) {
          pushLine('', 'scene');
        }

        if (this._storySkipRequested) {
          pushLine(displayText, lineType);
        } else {
          pushLine('', lineType, true);
          for (let ci = 0; ci < displayText.length; ci++) {
            if (this._storySkipRequested) {
              appendToLastLine(displayText.slice(ci));
              break;
            }
            appendToLastLine(displayText[ci]);
            await new Promise<void>(r => setTimeout(r, 22));
          }
          finishLastLine();
        }

        prevCategory = category;
      }

      // Apply this line's effects after it has been rendered (or immediately for effect-only lines)
      this.encounterMgr.applyLineEffects(i);
      this.applyStoryPendingEffects(this.encounterMgr.flushPendingEffects());
      this.flushAcquisitions();
      this.syncUIState(this.state.getState());

      // Inter-line pause (only when text rendered and not skipping)
      if (line?.text && !this._storySkipRequested && i < toIndex) {
        await new Promise<void>(r => setTimeout(r, 320));
      }
    }

    storyTypingActive.set(false);
  }

  /** Format a story script line for display in the narrative box. */
  private formatStoryLineText(line: ScriptLine): string {
    if (!line.text) return '';
    if (!line.speaker || line.speaker === 'narrator') return line.text;
    if (line.speaker === 'player') return `你「${line.text}」`;
    return `${line.speaker}「${line.text}」`;
  }

  /**
   * 啟動遭遇並渲染第一個節點／幕。
   * 統一路由 story（cutscene）與 event/dialogue 型別，減少重複 call site 代碼。
   */
  /** Push an encounter to the back of the sequential queue. */
  private enqueueEncounter(id: string, def?: EncounterDefinition): void {
    this._encounterQueue.push({ id, def });
  }

  /**
   * Dequeue the next encounter and start it.
   * Returns true if an encounter was started (caller should return without releasing input),
   * false if the queue was empty.
   */
  private async startNextQueuedEncounter(): Promise<boolean> {
    // NPC dialogue queue drains first (event-triggered scripted nodes).
    const dlg = this._npcDialogueQueue.shift();
    if (dlg) {
      await this.activateEventNpcDialogue(dlg);
      return true;
    }
    const next = this._encounterQueue.shift();
    if (!next) return false;
    await this.startAndRenderEncounter(next.id, next.def);
    return true;
  }

  private async startAndRenderEncounter(
    encounterId: string,
    def?: EncounterDefinition,
    isDebug = false,
  ): Promise<void> {
    const result = this.encounterMgr.start(encounterId);
    if (!result) return;
    const effectiveDef = def ?? this.lore.getEncounter(encounterId) ?? undefined;
    if (result.kind === 'node') {
      await this.renderEncounterNode(result.resolved, effectiveDef, isDebug);
    } else {
      await this.renderStoryScript(result.script, 0, result.currentLineIndex, effectiveDef);
    }
  }

  /**
   * Activate an NPC scripted dialogue node triggered by an event (startNpcDialogue).
   * Resolves the NPC, fetches the dialogue node, and launches it as a scripted encounter.
   * endAfterScript is always true for event-triggered dialogues.
   */
  private async activateEventNpcDialogue(
    dlg: { npcId: string; dialogueId: string; nodeId: string },
  ): Promise<void> {
    const npc = this.lore.resolveNPC(dlg.npcId, this.state.flags, this.state.getState().timePeriod);
    if (!npc) {
      log.warn('Event NPC dialogue skipped: NPC not found', dlg);
      return;
    }
    const node = this.dialogueMgr.getNode(dlg.npcId, dlg.dialogueId, dlg.nodeId);
    if (!node) {
      log.warn('Event NPC dialogue skipped: node not found', dlg);
      return;
    }
    this.updateActiveNpcUI(dlg.npcId);
    this._sessionFiredTriggers.add(dlg.nodeId);
    await this.activateScriptedNode(
      dlg.npcId, dlg.dialogueId, npc.name,
      dlg.nodeId, node, true, // endAfterScript = true
    );
  }

  /**
   * Streams a DM closing narration when an encounter ends without an explicit outcome node.
   * Called when selectChoice() returns null (nextNodeId === null or __continue__).
   * Returns DM-generated thought suggestions parsed from the <<THOUGHTS:...>> signal.
   */
  private async streamEncounterClose(
    def: EncounterDefinition,
    collectedNarrative: string,
  ): Promise<string[]> {
    const gs = this.state.getState();
    const parts: string[] = [];
    parts.push(`## 遭遇名稱：${def.name}`);
    if (def.description) parts.push(def.description);
    parts.push('');
    if (collectedNarrative.trim()) {
      parts.push('## 遭遇經過摘要');
      parts.push(collectedNarrative.trim().slice(0, 400));
      parts.push('');
    }
    parts.push('## 當前環境');
    parts.push(`地點：${gs.player.currentLocationId} ／ 時段：${gs.timePeriod}`);
    const closeCtx = parts.join('\n');
    const closeLineType =
      def.type === 'event'    ? 'event'    :
      def.type === 'story'    ? 'scene'    :
      def.type === 'interact' ? 'interact' :
                                'narrative';

    let fullText = '';
    let closeSignalCutoff = -1;
    isStreaming.set(true);
    pushLine('', closeLineType, true);
    try {
      for await (const chunk of this.dm.narrateEncounterClose(closeCtx, gs.history)) {
        const prevLen = fullText.length;
        fullText += chunk;
        if (closeSignalCutoff === -1) {
          const idx = fullText.indexOf('<<THOUGHTS');
          if (idx !== -1) {
            if (idx > prevLen) appendToLastLine(fullText.slice(prevLen, idx));
            closeSignalCutoff = idx;
          } else {
            appendToLastLine(chunk);
          }
        }
      }
      // Patch displayed text to exact cutoff
      const displayText = (closeSignalCutoff === -1 ? fullText : fullText.slice(0, closeSignalCutoff)).trimEnd();
      narrativeLines.update(lines => {
        if (lines.length === 0) return lines;
        const last = lines[lines.length - 1];
        if (last.text === displayText) return lines;
        return [...lines.slice(0, -1), { ...last, text: displayText }];
      });
    } catch (err) {
      log.error('Encounter close narration failed', err);
    } finally {
      isStreaming.set(false);
      finishLastLine();
    }
    return extractEncounterThoughts(fullText);
  }

  /**
   * Builds the context string passed to DMAgent.narrateEncounterNode().
   */
  private buildEncounterContext(def: EncounterDefinition, resolved: ResolvedNode): string {
    const gs     = this.state.getState();
    const active = gs.activeEncounter;
    const parts: string[] = [];

    parts.push(`## 遭遇名稱：${def.name}`);
    if (def.description) parts.push(def.description);
    parts.push('');

    // Most recent player choice (extracted from collectedNarrative)
    if (active?.collectedNarrative) {
      const lastChoice = active.collectedNarrative
        .split('\n')
        .reverse()
        .find(l => l.startsWith('[玩家]:'));
      if (lastChoice) {
        parts.push('## 玩家剛才的選擇');
        parts.push(lastChoice.replace('[玩家]: ', '').trim());
        parts.push('');
      }
    }

    if (resolved.statCheckResult) {
      const { stat, dc, passed } = resolved.statCheckResult;
      const statLabel = stat.split('.').pop() ?? stat;
      parts.push('## 數值判定');
      parts.push(passed
        ? `${statLabel} 判定通過（DC ${dc}）— 請描述成功的情境`
        : `${statLabel} 判定失敗（DC ${dc}）— 請描述失敗的情境`,
      );
      parts.push('');
    }

    parts.push('## 本節點 DM 指示');
    parts.push(resolved.node.dmNarrative ?? '');
    parts.push('');

    parts.push('## 當前環境');
    parts.push(`地點：${gs.player.currentLocationId} ／ 時段：${gs.timePeriod}`);

    return parts.join('\n');
  }

  /**
   * Guard called from submitAction when phase === 'event'.
   * Free-text input is disabled during encounters — choices are button-driven.
   */
  /**
   * Re-enables text input only when no encounter choice panel is blocking it.
   * If an active encounter has pending choices, the input stays locked until
   * the player selects one — preventing out-of-order free-text submissions.
   */
  private releaseInput(): void {
    const encUI = get(activeEncounterUI);
    if (encUI && encUI.choices.length > 0) return;
    inputDisabled.set(false);
  }

  /**
   * Normalise raw DM output before signal parsing.
   * Strips known meta-tokens (TIME, THOUGHTS) and malformed pseudo-signals
   * such as 》(stage direction) or 《(stage direction) that some models emit
   * in place of the expected <<SIGNAL>> format.
   */
  private sanitizeDMOutput(text: string): string {
    return text
      // Legitimate signals handled separately — strip scheduling meta-tokens
      .replace(/<<TIME:\s*\d+>>\s*\n?/gi, '')
      .replace(/<<THOUGHTS:[^>]+?>>\s*\n?/gi, '')
      // Malformed pseudo-signals: any CJK/ASCII angle bracket (《«》») + parenthetical
      // e.g.  》(stage direction)  or  《（stage direction）
      .replace(/[《«》»]{1,2}[（(][^）)]*[）)]\s*/g, '')
      // Malformed 《SIGNAL》 where the model used CJK book-title brackets instead of <<>>.
      // Only strips when bracketed content contains no CJK characters, so legitimate
      // book titles like 《三國演義》 are preserved.
      .replace(/《[^\u4e00-\u9fff\n《》]{1,100}》\s*/g, '')
      .trimEnd();
  }

  private async handleEncounterInput(_input: string): Promise<void> {
    pushLine('請選擇一個選項。', 'system');
  }

  // -- Thought generation -----------------------------------------------

  /**
   * 粗略的遊戲狀態指紋，供 exitDialogueThoughts 判斷對話期間狀態是否有「實質變化」。
   * 只取會影響探索候選內容的欄位；時間以 timePeriod（時段）比對而非分鐘——對話本身推進
   * 的少量時間幾乎每次都會跨過細粒度的分鐘桶，導致幾乎每次結束都誤判為「有變化」而重新
   * 呼叫 LLM；時段變動才代表場景候選（如「找個地方休息」）可能真的需要更新。
   */
  private computeThoughtsFingerprint(): string {
    const gs = this.state.getState();
    const flagsPart = this.state.flags.toArray().sort().join(',');
    const questsPart = Object.values(gs.activeQuests)
      .map(q => `${q.questId}:${q.currentStageId ?? ''}:${q.completedObjectiveIds.length}`)
      .sort()
      .join(',');
    const invPart = gs.player.inventory
      .map(i => `${i.itemId}:${i.variantId ?? ''}:${i.isExpired ? 'x' : 'o'}`)
      .sort()
      .join(',');
    const repPart = Object.entries(gs.player.externalStats.reputation).sort().map(([k, v]) => `${k}=${v}`).join(',');
    const affPart = Object.entries(gs.player.externalStats.affinity).sort().map(([k, v]) => `${k}=${v}`).join(',');
    return [
      gs.player.currentLocationId, gs.timePeriod, flagsPart, questsPart, invPart, repPart, affPart,
    ].join('|');
  }

  /**
   * 進入對話前呼叫：快照當下探索想法與狀態指紋，清空 thoughts（對話中改由
   * resolution.suggestions 驅動），供 exitDialogueThoughts 在對話結束時還原。
   */
  private snapshotThoughtsBeforeDialogue(): void {
    this._thoughtsSnapshot = get(thoughts);
    this._thoughtsSnapshotFingerprint = this.computeThoughtsFingerprint();
    thoughts.set([]);
    this.state.setThoughts([]);
  }

  /**
   * 對話結束時呼叫（所有結束路徑：強制離開、自然結束、劇本 endAfterScript、事件打斷）。
   * 快照存在且狀態指紋未變 → 直接還原快照，不呼叫 LLM。
   * 狀態有變化 → 呼叫一次輕量、無敘述的 THOUGHTS-only LLM；失敗則退回快照。
   * 無快照 → 退回一般 fallback（refreshThoughts 的中文 fallback）。
   */
  private async exitDialogueThoughts(): Promise<void> {
    const snapshot    = this._thoughtsSnapshot;
    const snapshotFp   = this._thoughtsSnapshotFingerprint;
    this._thoughtsSnapshot = null;
    this._thoughtsSnapshotFingerprint = null;

    if (snapshot && snapshotFp !== null && snapshotFp === this.computeThoughtsFingerprint()) {
      const final = this.regulator.processThoughts(snapshot, this.state.getState().player);
      thoughts.set(final);
      this.state.setThoughts(final);
      return;
    }

    if (!snapshot || this.mockMode) {
      await this.refreshThoughts([]);
      return;
    }

    try {
      const sceneCtx = this.buildSceneCtx([]);
      const raw      = await this.dm.generateExitThoughts(sceneCtx);
      const sugg     = extractEncounterThoughts(raw);
      if (sugg.length > 0) {
        await this.refreshThoughts(sugg);
      } else {
        const final = this.regulator.processThoughts(snapshot, this.state.getState().player);
        thoughts.set(final);
        this.state.setThoughts(final);
      }
    } catch (err) {
      log.warn('exitDialogueThoughts LLM failed, falling back to snapshot', err);
      const final = this.regulator.processThoughts(snapshot, this.state.getState().player);
      thoughts.set(final);
      this.state.setThoughts(final);
    }
  }

  private async refreshThoughts(dmSuggestions: string[] = []): Promise<void> {
    const gs = this.state.getState();
    // Scripted dialogue nodes show their own choice panel, not thoughts — don't attach
    // the "結束對話" sentinel while one is active (free-form dialogue only).
    const inFreeDialogue = !!get(activeNpcUI) && !get(activeScriptedDialogue);
    let base: Thought[];
    if (inFreeDialogue) {
      // 對話進行中：候選一律是「對這位 NPC 可說的話／問的事」（來自敘述串流的
      // <<THOUGHTS>> 訊號），固定附加一個「結束對話」選項；LLM 沒給訊號時只顯示它。
      let n = 0;
      base = [
        ...dmSuggestions.map(text => ({ id: 'dm_' + (n++), text, actionType: 'free' as const })),
        END_DIALOGUE_THOUGHT,
      ];
    } else if (dmSuggestions.length > 0) {
      let n = 0;
      base = dmSuggestions.map(text => ({
        id: 'dm_' + (n++),
        text,
        actionType: 'free' as const,
      }));
    } else {
      base = this.buildBaseThoughts(gs);
    }
    const final = this.regulator.processThoughts(base, gs.player);
    thoughts.set(final);
    this.state.setThoughts(final);
  }

  /** 預設移動候選上限（想法列為橫向捲動，可容納 4 個） */
  private static readonly MAX_MOVE_THOUGHTS = 4;

  private buildBaseThoughts(gs: Readonly<GameState>): Thought[] {
    const result: Thought[] = [];
    let   n = 0;
    const id = (prefix: string) => prefix + '_' + (n++);

    const currentLocId = gs.player.currentLocationId;
    const resolved = this.lore.resolveLocation(currentLocId, this.state.flags, gs.timePeriod);

    // 無 LLM 候選時的 fallback：以玩家口吻的繁體中文呈現
    result.push({ id: id('examine'), text: '觀察四周', actionType: 'examine' });

    if (resolved) {
      const isVisited = (locId: string) => gs.discoveredLocationIds.includes(locId);
      const isHiddenOnMap = (c: (typeof resolved.connections)[number]) => {
        // 與地圖相同的可見條件：未到訪且 mapVisible 條件未滿足的出口不提示
        if (!c.mapVisible || isVisited(c.targetLocationId)) return false;
        const knowledgeOk = !c.mapVisible.intelIds?.length
          || c.mapVisible.intelIds.every(k => gs.player.knownIntelIds.includes(k));
        const flagsOk = !c.mapVisible.flags || this.state.flags.evaluate(c.mapVisible.flags);
        return !(knowledgeOk && flagsOk);
      };
      // 排序：目前節點的子地點入口 → 尚未到訪的出口 → 其餘（同級維持原順序）
      const rank = (targetId: string) => {
        if (this.lore.getLocation(targetId)?.parentId === currentLocId) return 0;
        return isVisited(targetId) ? 2 : 1;
      };
      const exits = resolved.connections
        .filter(c => {
          if (isHiddenOnMap(c)) return false;
          const r = this.lore.getConnectionAccessResult(
            c, this.state.flags, gs.timePeriod, gs.player.knownIntelIds,
            Object.values(gs.activeQuests), gs.time, gs.player.inventory, gs.player.melphin,
            { reputation: gs.player.externalStats.reputation, affinity: gs.player.externalStats.affinity,
              attemptCooldowns: gs.attemptCooldowns, connectionKey: currentLocId + '→' + c.targetLocationId },
          );
          return r.allowed || !!r.attemptEncounterId;
        })
        .map((c, i) => ({ c, i, r: rank(c.targetLocationId) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .slice(0, GameController.MAX_MOVE_THOUGHTS)
        .map(x => x.c);
      for (const exit of exits) {
        // 帶 targetId：點選後由引擎直接以此 id 移動，不再讓 LLM 從描述猜目的地
        result.push({ id: id('move'), text: '前往：' + exit.description, actionType: 'move', targetId: exit.targetLocationId });
      }

      const npcs = this.lore.getNPCsByIds(resolved.npcIds, this.state.flags, gs.timePeriod).slice(0, 2);
      for (const npc of npcs) {
        result.push({ id: id('talk'), text: '和' + npc.name + '交談', actionType: 'interact', targetId: npc.id });
      }
    }

    const staminaLow  = gs.player.statusStats.stamina < gs.player.statusStats.staminaMax * 0.4;
    const stressHigh  = gs.player.statusStats.stress  > gs.player.statusStats.stressMax  * 0.75;
    if (staminaLow || stressHigh) {
      result.push({ id: id('rest'), text: '找個地方休息', actionType: 'rest' });
    }

    return result;
  }

  // -- Observe / Rest --------------------------------------------------

  /**
   * Returns a deterministic snapshot of the current scene for the Observe panel.
   * No LLM involved — pure game state + lore evaluation.
   */
  getObserveSnapshot(): ObserveSnapshot {
    const gs = this.state.getState();
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags, gs.timePeriod);
    if (!resolved) {
      return { location: { id: '', name: '' }, exits: [], npcs: [], props: [], canFullRest: false };
    }

    // Exits: show all, mark locked. Bypass-accessible = normal (not locked).
    const exits = resolved.connections.map(c => {
      const result = this.lore.getConnectionAccessResult(
        c, this.state.flags, gs.timePeriod, gs.player.knownIntelIds,
        Object.values(gs.activeQuests), gs.time, gs.player.inventory, gs.player.melphin,
        { reputation: gs.player.externalStats.reputation, affinity: gs.player.externalStats.affinity,
          attemptCooldowns: gs.attemptCooldowns, connectionKey: gs.player.currentLocationId + '→' + c.targetLocationId },
      );
      const hasAttempt = !result.allowed && !!result.attemptEncounterId;
      return {
        targetLocationId: c.targetLocationId,
        description: c.description,
        isLocked: !result.allowed && !hasAttempt,
        lockedMessage: !result.allowed && !hasAttempt ? (c.access?.lockedMessage ?? '此通道目前無法通行') : undefined,
        hasAttempt,
        attemptEncounterId: hasAttempt ? result.attemptEncounterId : undefined,
        attemptLabel: hasAttempt ? (result.attemptLabel ?? '可嘗試通行') : undefined,
      };
    });

    // NPCs: filtered by visibility and time period
    const npcs = this.lore.getNPCsByIds(resolved.npcIds, this.state.flags, gs.timePeriod)
      .map(n => ({ id: n.id, name: n.name }));

    // Props: filtered by visibility conditions
    const visibleProps = this.lore.getVisiblePropsForLocation(
      gs.player.currentLocationId, this.state.flags, gs.timePeriod,
      gs.player.knownIntelIds, Object.values(gs.activeQuests), gs.time,
      gs.player.inventory, gs.player.melphin,
    );
    const props = visibleProps.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isRestPoint: !!p.restPoint,
      isInteractable: !!(p.interactable && (p.interaction || p.itemGrants?.length || p.encounterId)),
      interactLabel: p.interactLabel ?? '互動',
    }));

    return {
      location: { id: resolved.id, name: resolved.name },
      exits,
      npcs,
      props,
      canFullRest: visibleProps.some(p => p.restPoint),
    };
  }

  /**
   * Processes deterministic prop interaction effects (itemGrants, eventIds, encounterId).
   * Only runs when action.type === 'interact' and targetId resolves to a visible prop.
   * Returns null  → an encounter was triggered; caller should early-return.
   * Returns string → context snippet (may be empty) to append to the DM scene context.
   */
  private async applyPropInteract(action: PlayerAction): Promise<string | null> {
    if (action.type !== 'interact' || !action.targetId) return '';

    const gs = this.state.getState();
    const visibleProps = this.lore.getVisiblePropsForLocation(
      gs.player.currentLocationId, this.state.flags, gs.timePeriod,
      gs.player.knownIntelIds, Object.values(gs.activeQuests), gs.time,
      gs.player.inventory, gs.player.melphin,
    );
    const prop = visibleProps.find(p => p.id === action.targetId);
    if (!prop || (!prop.interaction && !prop.itemGrants?.length && !prop.eventIds?.length && !prop.encounterId)) {
      return '';
    }

    const now = gs.time.totalMinutes;
    const ctxLines: string[] = [`\n### Prop Interaction: ${prop.name}`];
    const grantedNames: string[] = [];
    const lockedMessages: string[] = [];

    // ── itemGrants ───────────────────────────────────────────────────────
    for (const grant of prop.itemGrants ?? []) {
      if (grant.lockedWhen && this.state.flags.evaluate(grant.lockedWhen)) {
        if (grant.lockedMessage) lockedMessages.push(grant.lockedMessage);
        continue;
      }
      if (grant.onceFlag && this.state.getPropFlags(prop.id).has(grant.onceFlag)) continue;

      const def = this.lore.getItem(grant.itemId);
      if (!def) continue;

      const count = grant.count ?? 1;
      for (let i = 0; i < count; i++) {
        if (grant.itemOverrides && def.isTemplate) {
          this.state.addTemplateItem(grant.itemId, grant.itemOverrides, now);
        } else {
          this.state.addItem(grant.itemId, now, grant.variantId, {
            stackable:          def.stackable,
            maxStack:           def.maxStack,
            maxUsesPerInstance: def.maxUsesPerInstance,
          });
        }
      }

      if (grant.onceFlag) this.state.setPropFlag(prop.id, grant.onceFlag);

      const variantLabel = grant.variantId
        ? def.variants?.find(v => v.id === grant.variantId)?.label
        : undefined;
      const label = variantLabel ? `${def.name}（${variantLabel}）` : def.name;
      grantedNames.push(count > 1 ? `${label} x${count}` : label);
    }

    if (grantedNames.length > 0)  ctxLines.push(`Items obtained: ${grantedNames.join(', ')}`);
    if (lockedMessages.length > 0) ctxLines.push(`Item access blocked: ${lockedMessages.join('; ')}`);

    this.flushAcquisitions();

    // ── eventIds ─────────────────────────────────────────────────────────
    const propTriggered: TriggeredEvent[] = [];
    for (const eventId of prop.eventIds ?? []) {
      const t = this.events.fireEventById(eventId);
      if (t) propTriggered.push(t);
    }

    if (propTriggered.length > 0) {
      const { eventEncounters, extraTriggered } = this.processTriggeredEvents(propTriggered);
      const allPropEvents = [...propTriggered, ...extraTriggered];

      if (allPropEvents.length > 0) {
        const evCtx = this.buildSceneCtx(allPropEvents, false);
        await this.runEventDM(evCtx, 'narrative');
        this.flushAcquisitions();
      }

      if (eventEncounters.length > 0 || this._npcDialogueQueue.length > 0) {
        // Enqueue event encounters first, then prop interaction so it runs after all events.
        for (const enc of eventEncounters) this.enqueueEncounter(enc.id, enc.def ?? undefined);
        if (prop.interaction) {
          const synthId = `prop_interact_${prop.id}`;
          const synthDef: EncounterDefinition = {
            id: synthId,
            name: prop.name,
            description: prop.description,
            type: prop.interaction.type === 'story' ? 'story' : prop.interaction.type === 'transit' ? 'transit' : 'interact',
            entryNodeId: prop.interaction.entryNodeId,
            nodes: prop.interaction.nodes,
          };
          this.lore.registerEphemeralEncounter(synthDef);
          this.enqueueEncounter(synthId, synthDef);
        }
        await this.startNextQueuedEncounter();
        this.flushAcquisitions();
        return null;
      }

      ctxLines.push(`Events triggered: ${propTriggered.map(t => t.event.name).join(', ')}`);
    }

    // ── interaction (inline encounter) ───────────────────────────────────
    if (prop.interaction) {
      const synthId = `prop_interact_${prop.id}`;
      const synthDef: import('../types/encounter').EncounterDefinition = {
        id: synthId,
        name: prop.name,
        description: prop.description,
        type: prop.interaction.type === 'story' ? 'story' : prop.interaction.type === 'transit' ? 'transit' : 'interact',
        entryNodeId: prop.interaction.entryNodeId,
        nodes: prop.interaction.nodes,
      };
      this.lore.registerEphemeralEncounter(synthDef);
      await this.startAndRenderEncounter(synthId, synthDef);
      this.flushAcquisitions();
      return null;
    }

    // ── encounterId (legacy) ─────────────────────────────────────────────
    if (prop.encounterId) {
      await this.startAndRenderEncounter(prop.encounterId);
      this.flushAcquisitions();
      return null;
    }

    return (grantedNames.length > 0 || propTriggered.length > 0) ? ctxLines.join('\n') : '';
  }

  /**
   * Classify the current rest context (full vs scuffed).
   * Used by buildSceneCtx for rest action context and by submitAction for time clamp.
   */
  private classifyRestContext(): RestContext {
    const gs = this.state.getState();
    const visibleProps = this.lore.getVisiblePropsForLocation(
      gs.player.currentLocationId, this.state.flags, gs.timePeriod,
      gs.player.knownIntelIds, Object.values(gs.activeQuests), gs.time,
      gs.player.inventory, gs.player.melphin,
    );
    const restPointProps = visibleProps.filter(p => p.restPoint);

    if (restPointProps.length > 0) {
      return {
        mode: 'full_available',
        restPointIds: restPointProps.map(p => p.id),
        maxTimeMinutes: 480,
        statusEffectScale: 1.0,
      };
    }

    return {
      mode: 'scuffed',
      restPointIds: [],
      maxTimeMinutes: 120, // 與 RestModal 簡陋休息選項（30/60/120）上限一致
      statusEffectScale: 0.3,
    };
  }

  // -- UI sync ----------------------------------------------------------

  private syncUIState(gs: Readonly<GameState>): void {
    const resolved         = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags, gs.timePeriod);
    const region           = this.lore.getRegion(this.currentRegionId);
    const activeQuestCount = Object.values(gs.activeQuests).filter(
      q => !q.isCompleted && !q.isFailed
    ).length;

    // All contacted factions (union of contactedFactions + non-zero rep entries)
    // contactedFactions tracks factions the player has encountered even with 0 rep change.
    const contactedIds = new Set<string>([
      ...(gs.player.contactedFactions ?? []),
      ...Object.entries(gs.player.externalStats.reputation)
        .filter(([, v]) => v !== 0)
        .map(([id]) => id),
    ]);
    const allFactionRep = [...contactedIds]
      .map(fid => {
        const f    = this.lore.getFaction(fid);
        const rep  = gs.player.externalStats.reputation[fid] ?? 0;
        // unknownUntil: faction name hidden until player has the specified intel
        const known = !f?.unknownUntil || gs.player.knownIntelIds.includes(f.unknownUntil);
        return { id: fid, name: known ? (f?.name ?? fid) : '???', rep };
      })
      .sort((a, b) => Math.abs(b.rep) - Math.abs(a.rep));

    // Top 2 factions for sidebar display
    const topFactions = allFactionRep.slice(0, 2);

    // Faction graph UI data (progressive: only discovered factions shown)
    // Node positions and player projection are computed in FactionGraphModal via spring layout.
    const graphDef = this.lore.getFactionGraph(this.currentRegionId);
    let factionGraphUI: import('../stores/gameStore').PlayerUIState['factionGraphUI'] = undefined;
    if (graphDef && allFactionRep.length > 0) {
      const discoveredIds = new Set(allFactionRep.map(f => f.id));
      const graphNodes = allFactionRep
        .filter(f => graphDef.factionIds.includes(f.id))
        .map(f => {
          // f.name already reflects unknownUntil (either real name or '???')
          const revealed = f.name !== '???';
          return {
            id:          f.id,
            displayName: f.name,
            rep:         f.rep,
            revealed,
          };
        });
      const graphEdges = graphDef.edges.filter(
        e => discoveredIds.has(e.a) && discoveredIds.has(e.b)
      );
      if (graphNodes.length > 0) {
        factionGraphUI = { nodes: graphNodes, edges: graphEdges };
      }
    }

    const allActiveQuestSummaries = Object.values(gs.activeQuests)
      .filter(q => !q.isCompleted && !q.isFailed && q.currentStageId)
      .flatMap(q => {
        const def   = this.lore.getQuest(q.questId);
        const stage = def?.stages[q.currentStageId!];
        if (!def || !stage) return [];
        const canAbandon = def.canAbandon !== false && (def.type !== 'main' || def.canAbandon === true);
        const canDitch   = !!def.canDitch;
        const ditchBeneficiaryFactionId = def.ditchConsequences?.beneficiaryFactionId;
        // Build objective description map across all stages (for past-completed lookup)
        const allObjDescriptions = new Map<string, string>();
        for (const s of Object.values(def.stages)) {
          for (const o of s.objectives) {
            if (!allObjDescriptions.has(o.id)) allObjDescriptions.set(o.id, o.description);
          }
        }
        const currentStageObjIds = new Set(stage.objectives.map(o => o.id));
        // Past completed objectives (completion order, excluding current-stage objectives)
        const pastCompleted = q.completedObjectiveIds
          .filter(id => !currentStageObjIds.has(id) && allObjDescriptions.has(id))
          .map(id => ({ id, description: allObjDescriptions.get(id)!, completed: true }));
        // Current stage objectives
        const currentObjs = stage.objectives.map(o => ({
          id:          o.id,
          description: o.description,
          completed:   q.completedObjectiveIds.includes(o.id),
        }));

        return [{
          questId:      q.questId,
          name:         def.name,
          type:         def.type,
          stageSummary: stage.description,
          objectives:   [...pastCompleted, ...currentObjs],
          canAbandon,
          canDitch,
          ...(ditchBeneficiaryFactionId ? { ditchBeneficiaryFactionId } : {}),
        }];
      });
    const QUEST_TYPE_ORDER: Record<string, number> = { main: 0, side: 1, hidden: 2 };
    allActiveQuestSummaries.sort((a, b) => (QUEST_TYPE_ORDER[a.type] ?? 3) - (QUEST_TYPE_ORDER[b.type] ?? 3));
    const activeQuestSummaries = allActiveQuestSummaries.slice(0, 3);
    log.debug('syncUIState quests', { count: activeQuestSummaries.length, summaries: activeQuestSummaries });

    // Build mini-map data (current area + sublocations)
    const currentLocId   = gs.player.currentLocationId;
    const currentLocNode = this.lore.getLocation(currentLocId);
    const areaId         = currentLocNode?.parentId ?? currentLocId;
    const areaNode       = this.lore.getLocation(areaId);

    // Pre-compute discovered areas: a location's parent area is implicitly discovered
    // when the player has visited any sublocation inside it.
    const discoveredAreas = new Set<string>(gs.discoveredLocationIds);
    for (const locId of gs.discoveredLocationIds) {
      const parent = this.lore.getLocation(locId)?.parentId;
      if (parent) discoveredAreas.add(parent);
    }
    discoveredAreas.add(areaId); // Current area always visible

    let miniMap: MiniMapData | undefined;
    if (areaNode) {
      const sublocations = this.lore.getLocationsByParent(areaId);
      const allAreaNodes = [areaNode, ...sublocations];
      const areaNodeIds  = new Set(allAreaNodes.map(n => n.id));
      const districtNode = areaNode.districtId ? this.lore.getDistrict(areaNode.districtId) : undefined;

      const mapNodes: MiniMapNode[] = [];
      const mapEdges: MiniMapEdge[] = [];
      const mapNodeIds = new Set<string>();
      const seenEdgeKeys = new Set<string>();

      // Helper: is this location visited by the player?
      const isVisited = (id: string) =>
        gs.discoveredLocationIds.includes(id) || id === currentLocId;

      // 1. Core nodes: area root + sublocations
      for (const node of allAreaNodes) {
        const visited = node.id === areaId ? true : isVisited(node.id);
        mapNodes.push({
          id:                  node.id,
          label:               node.base.name ?? node.name,
          kind:                node.id === areaId ? 'area-root' : 'sublocation',
          isCurrent:           node.id === currentLocId,
          isVisited:           visited,
          isKnownButUnvisited: !visited,
          isHidden:            false,
          districtId:          node.districtId,
          areaId:              areaId,
        });
        mapNodeIds.add(node.id);
      }

      // 2. Collect external nodes from connections
      for (const node of allAreaNodes) {
        const resolved = this.lore.resolveLocation(node.id, this.state.flags);
        if (!resolved) continue;
        for (const conn of resolved.connections) {
          if (areaNodeIds.has(conn.targetLocationId)) continue;
          if (mapNodeIds.has(conn.targetLocationId)) continue;
          const target = this.lore.getLocation(conn.targetLocationId);
          if (!target) continue;

          // Only show adjacent areas when player is at area root
          const targetIsAreaRoot = !target.parentId;
          if (targetIsAreaRoot && currentLocId !== areaId) continue;

          const tVisited = isVisited(conn.targetLocationId);

          // Evaluate map visibility condition (mapVisible only applies when not yet visited)
          let nodeIsHidden = false;
          if (conn.mapVisible && !tVisited) {
            const knowledgeOk = !conn.mapVisible.intelIds?.length
              || conn.mapVisible.intelIds.every(k => gs.player.knownIntelIds.includes(k));
            const flagsOk = !conn.mapVisible.flags
              || this.state.flags.evaluate(conn.mapVisible.flags);
            nodeIsHidden = !(knowledgeOk && flagsOk);
          }

          mapNodes.push({
            id:                  conn.targetLocationId,
            label:               target.name,
            kind:                targetIsAreaRoot ? 'adjacent-area' : 'remote-sublocation',
            isCurrent:           false,
            isVisited:           tVisited,
            isKnownButUnvisited: !tVisited,
            isHidden:            nodeIsHidden,
            districtId:          target.districtId,
            areaId:              target.parentId ?? conn.targetLocationId,
          });
          mapNodeIds.add(conn.targetLocationId);
        }
      }

      // Build lookup set for hidden nodes (used to propagate isHidden to edges)
      const hiddenNodeIds = new Set(mapNodes.filter(n => n.isHidden).map(n => n.id));

      // 3. Build edges with access metadata
      for (const node of allAreaNodes) {
        const resolved = this.lore.resolveLocation(node.id, this.state.flags);
        if (!resolved) continue;
        for (const conn of resolved.connections) {
          if (!mapNodeIds.has(conn.targetLocationId)) continue;
          const edgeKey = [node.id, conn.targetLocationId].sort().join('|');
          if (seenEdgeKeys.has(edgeKey)) continue;
          seenEdgeKeys.add(edgeKey);

          const inArea = areaNodeIds.has(conn.targetLocationId);
          const target = this.lore.getLocation(conn.targetLocationId);
          const targetIsAreaRoot = target && !target.parentId;

          let isLocked = false;
          let hasBypass = false;
          let hasAttempt = false;
          let attemptLabel: string | undefined;
          let traversable = true;
          if (conn.access) {
            const result = this.lore.getConnectionAccessResult(
              conn, this.state.flags, gs.timePeriod, gs.player.knownIntelIds,
              Object.values(gs.activeQuests), gs.time, gs.player.inventory, gs.player.melphin,
              { reputation: gs.player.externalStats.reputation, affinity: gs.player.externalStats.affinity,
                attemptCooldowns: gs.attemptCooldowns, connectionKey: node.id + '→' + conn.targetLocationId },
            );
            traversable = result.allowed;
            hasAttempt = !result.allowed && !!result.attemptEncounterId;
            attemptLabel = hasAttempt ? (result.attemptLabel ?? '可嘗試通行') : undefined;
            // 路被鎖 = 直接條件不過（無論 bypass 是否可走），但有嘗試遭遇則不算純鎖
            isLocked = (!result.allowed && !hasAttempt) || (result.allowed && !!result.wasBypass);
            hasBypass = !!conn.access.bypass;
          }

          mapEdges.push({
            fromId:              node.id,
            toId:                conn.targetLocationId,
            kind:                inArea ? 'local' : (targetIsAreaRoot ? 'cross-area' : 'remote-link'),
            isLocked,
            hasBypass,
            isTraversable:       traversable || hasAttempt,
            targetIsForeignArea: !inArea,
            isHidden:            hiddenNodeIds.has(conn.targetLocationId),
            lockedMessage:       conn.access?.lockedMessage,
            bypassMessage:       conn.access?.bypass?.bypassMessage,
            hasAttempt,
            attemptLabel,
          });
        }
      }

      miniMap = {
        areaId,
        areaName:     areaNode.name,
        districtId:   areaNode.districtId ?? '',
        districtName: districtNode?.name  ?? '',
        nodes:        mapNodes,
        edges:        mapEdges,
      };
    }

    // Build region map data (all districts in region)
    let regionMap: RegionMapData | undefined;
    if (region) {
      const currentDistrictId = areaNode?.districtId ?? '';
      const adjacency         = this.lore.getDistrictAdjacency(this.currentRegionId);
      const districtIds       = region.districtIds ?? [];

      // Build area-level graphs for all discovered districts
      const districtAreaGraphs: RegionMapData['districtAreaGraphs'] = {};
      for (const did of districtIds) {
        const district = this.lore.getDistrict(did);
        if (!district) continue;
        // Build graph for all districts — undiscovered areas show as ??? in the UI

        const areaNodes: RegionMapData['districtAreaGraphs'][string]['nodes'] = [];
        const areaEdges: RegionMapData['districtAreaGraphs'][string]['edges'] = [];
        const areaIdsInDistrict = new Set(district.locationIds);
        // Map from edgeKey → accumulated lock info (consider ALL connections between two areas)
        const areaEdgeMap = new Map<string, {
          fromId: string; toId: string;
          anyTraversable: boolean;
          hasBypass: boolean;
          hasAttempt: boolean;
          attemptLabel?: string;
          lockedMessage?: string;
          bypassMessage?: string;
        }>();

        for (const lid of district.locationIds) {
          const loc = this.lore.getLocation(lid);
          if (!loc) continue;
          const subs = this.lore.getLocationsByParent(lid);
          const resolvedArea = this.lore.resolveLocation(lid, this.state.flags);
          areaNodes.push({
            id:                 loc.id,
            name:               loc.name,
            isCurrent:          lid === areaId,
            isDiscovered:       discoveredAreas.has(lid),
            description:        resolvedArea?.description,
            discoveredSubCount: subs.filter(s => gs.discoveredLocationIds.includes(s.id)).length,
            totalSubCount:      subs.length,
          });

          // Build edges: collect ALL connections to other areas (accumulate lock state)
          const allLocs = [loc, ...subs];
          for (const sub of allLocs) {
            const resolved = this.lore.resolveLocation(sub.id, this.state.flags);
            if (!resolved) continue;
            for (const conn of resolved.connections) {
              const targetRoot = this.lore.getLocation(conn.targetLocationId);
              if (!targetRoot) continue;
              const targetAreaId = targetRoot.parentId ?? conn.targetLocationId;
              if (targetAreaId === lid) continue; // same area
              if (!areaIdsInDistrict.has(targetAreaId)) continue; // cross-district

              const ek = [lid, targetAreaId].sort().join('|');

              // Evaluate access for this specific connection
              let connTraversable = true;
              let connHasBypass   = false;
              let connHasAttempt  = false;
              let connAttemptLabel: string | undefined;
              let connLockedMsg: string | undefined;
              let connBypassMsg: string | undefined;
              if (conn.access) {
                const result = this.lore.getConnectionAccessResult(
                  conn, this.state.flags, gs.timePeriod, gs.player.knownIntelIds,
                  Object.values(gs.activeQuests), gs.time, gs.player.inventory, gs.player.melphin,
                  { reputation: gs.player.externalStats.reputation, affinity: gs.player.externalStats.affinity,
                    attemptCooldowns: gs.attemptCooldowns, connectionKey: sub.id + '→' + conn.targetLocationId },
                );
                connHasAttempt  = !result.allowed && !!result.attemptEncounterId;
                connAttemptLabel = connHasAttempt ? (result.attemptLabel ?? '可嘗試通行') : undefined;
                connTraversable = result.allowed && !result.wasBypass;
                connHasBypass   = !!conn.access.bypass;
                connLockedMsg   = conn.access.lockedMessage;
                connBypassMsg   = conn.access.bypass?.bypassMessage;
              }

              const existing = areaEdgeMap.get(ek);
              if (existing) {
                // Union: any traversable connection makes the edge traversable
                existing.anyTraversable = existing.anyTraversable || connTraversable;
                existing.hasBypass      = existing.hasBypass || connHasBypass;
                existing.hasAttempt     = existing.hasAttempt || connHasAttempt;
                if (!existing.attemptLabel && connAttemptLabel) existing.attemptLabel = connAttemptLabel;
                if (!existing.lockedMessage && connLockedMsg) existing.lockedMessage = connLockedMsg;
                if (!existing.bypassMessage && connBypassMsg) existing.bypassMessage = connBypassMsg;
              } else {
                areaEdgeMap.set(ek, {
                  fromId:         lid,
                  toId:           targetAreaId,
                  anyTraversable: connTraversable,
                  hasBypass:      connHasBypass,
                  hasAttempt:     connHasAttempt,
                  attemptLabel:   connAttemptLabel,
                  lockedMessage:  connLockedMsg,
                  bypassMessage:  connBypassMsg,
                });
              }
            }
          }
        }

        for (const info of areaEdgeMap.values()) {
          areaEdges.push({
            fromId:         info.fromId,
            toId:           info.toId,
            isLocked:       !info.anyTraversable && !info.hasAttempt,
            hasBypass:      info.hasBypass,
            lockedMessage:  info.lockedMessage,
            bypassMessage:  info.bypassMessage,
            hasAttempt:     info.hasAttempt,
            attemptLabel:   info.attemptLabel,
          });
        }

        districtAreaGraphs[did] = { nodes: areaNodes, edges: areaEdges };
      }

      regionMap = {
        regionId:          this.currentRegionId,
        regionName:        region.name,
        currentDistrictId,
        districts: districtIds.map(did => {
          const district  = this.lore.getDistrict(did);
          const isCurrent = did === currentDistrictId;
          const hasDiscovered = district
            ? district.locationIds.some(lid => discoveredAreas.has(lid))
            : false;
          // Collect notable NPCs from all locations in this district
          const npcNames: string[] = [];
          if (district) {
            const npcIdSet = new Set<string>();
            for (const lid of district.locationIds) {
              const resolved = this.lore.resolveLocation(lid, this.state.flags);
              if (resolved) for (const nid of resolved.npcIds) npcIdSet.add(nid);
              for (const sub of this.lore.getLocationsByParent(lid)) {
                const rSub = this.lore.resolveLocation(sub.id, this.state.flags);
                if (rSub) for (const nid of rSub.npcIds) npcIdSet.add(nid);
              }
            }
            for (const nid of npcIdSet) {
              const npc = this.lore.getNPC(nid);
              if (npc) npcNames.push(npc.name);
            }
          }
          return {
            id:          did,
            label:       district?.name ?? did,
            isCurrent,
            isDiscovered: hasDiscovered || isCurrent,
            adjacentIds: adjacency.get(did) ?? [],
            description: district?.description,
            ambience:    district?.ambience,
            notableNpcs: npcNames.length > 0 ? npcNames : undefined,
            controlLevel: district?.regionCustom?.controlLevel,
            alertLevel:   district?.regionCustom?.alertLevel,
          };
        }),
        districtAreaGraphs,
      };
    }

    const visibleConditions = gs.player.conditions
      .filter(c => !(this.lore.getCondition(c.id)?.isHidden ?? c.isHidden))
      .map(c => {
        const def = this.lore.getCondition(c.id);
        return {
          label:           def?.label ?? c.label ?? c.id,
          effectSummary:   def ? GameController.buildConditionEffectSummary(def) : undefined,
          removeCondition: def?.removeCondition,
        };
      });

    const knownIntels = this.lore.getIntelList(gs.player.knownIntelIds);

    // Preserve the displayed name if the state name reverts to the unset default.
    // This prevents debug stat edits (or any syncUIState call before setPlayerName)
    // from wiping a name that was already established.
    const resolvedName = (gs.player.name && gs.player.name !== '???')
      ? gs.player.name
      : get(playerUI).name;

    playerUI.set({
      name:            resolvedName,
      location:        resolved?.name ?? gs.player.currentLocationId,
      regionName:      region?.name   ?? this.currentRegionId,
      stamina:         gs.player.statusStats.stamina,
      staminaMax:      gs.player.statusStats.staminaMax,
      stress:          gs.player.statusStats.stress,
      stressMax:       gs.player.statusStats.stressMax,
      endo:            gs.player.statusStats.endo,
      endoMax:         gs.player.statusStats.endoMax,
      turn:            gs.turn,
      worldPhase:      gs.worldPhase.currentPhase,
      activeQuestCount,
      conditionCount:  gs.player.conditions.filter(c => !(this.lore.getCondition(c.id)?.isHidden ?? c.isHidden)).length,
      time:            this.timeMgr.formatTime(gs.time),
      timePeriod:      this.timeMgr.formatPeriod(gs.timePeriod),
      topFactions:     topFactions.length > 0 ? topFactions : undefined,
      allFactionRep:   allFactionRep.length > 0 ? allFactionRep : undefined,
      factionGraphUI:  factionGraphUI,
      factionTreeDetails: this.buildFactionTreeDetails(gs, allFactionRep),
      titles:          gs.player.titles.length > 0 ? gs.player.titles.slice(0, 2) : undefined,
      activeQuestSummaries:    activeQuestSummaries.length > 0 ? activeQuestSummaries : undefined,
      allActiveQuestSummaries: allActiveQuestSummaries.length > 0 ? allActiveQuestSummaries : undefined,
      totalActiveQuestCount:   allActiveQuestSummaries.length > 0 ? allActiveQuestSummaries.length : undefined,
      conditions:      visibleConditions,
      knownIntels:     knownIntels.length > 0 ? knownIntels : undefined,
      melphin:         gs.player.melphin,
      miniMap,
      regionMap,
    });

    // Update observe snapshot for the Observe panel
    observeSnapshot.set(this.getObserveSnapshot());

    detailedPlayer.set({
      primaryStats:    { ...gs.player.primaryStats },
      primaryStatsExp: { ...gs.player.primaryStatsExp },
      secondaryStats:  { ...gs.player.secondaryStats },
      statusStats: {
        stamina:    gs.player.statusStats.stamina,
        staminaMax: gs.player.statusStats.staminaMax,
        stress:     gs.player.statusStats.stress,
        stressMax:  gs.player.statusStats.stressMax,
        endo:       gs.player.statusStats.endo,
        endoMax:    gs.player.statusStats.endoMax,
        experience: gs.player.statusStats.experience,
      },
      conditions:  gs.player.conditions
        .filter(c => !(this.lore.getCondition(c.id)?.isHidden ?? c.isHidden))
        .map(c => ({ label: this.lore.getCondition(c.id)?.label ?? c.label ?? c.id })),
      titles:      gs.player.titles,
      inventory:   gs.player.inventory,
      resolvedInventory: gs.player.inventory.map(inv => {
        const node    = this.lore.getItem(inv.itemId);
        const variant = node?.variants?.find(v => v.id === inv.variantId);
        const display = this.lore.resolveItemDisplay(inv);
        return {
          instanceId:   inv.instanceId,
          itemId:       inv.itemId,
          name:         variant ? display.name : display.name,
          description:  variant?.description ?? display.description,
          type:         node?.type ?? 'key',
          variantLabel: variant?.label,
          quantity:     inv.quantity,
          isExpired:    inv.isExpired,
        };
      }),
      reputation:    { ...gs.player.externalStats.reputation },
      affinity:      { ...gs.player.externalStats.affinity },
      knownIntelIds: [...gs.player.knownIntelIds],
    });
  }

  // -- Faction Tree UI Data (private) ----------------------------------

  /**
   * Build faction tree detail data for the UI.
   * Joined = positive reputation + completed any initial quest for that faction.
   * Before joining: only show known quests (no Epic/Checkpoint structure).
   * After joining: show full quest lines, checkpoints, credit.
   */
  private buildFactionTreeDetails(
    gs: GameState,
    allFactionRep: Array<{ id: string; name: string; rep: number }>,
  ): Record<string, import('../stores/gameStore').FactionTreeDetail> | undefined {
    if (allFactionRep.length === 0) return undefined;

    const result: Record<string, import('../stores/gameStore').FactionTreeDetail> = {};

    for (const fRep of allFactionRep) {
      const factionDef = this.lore.getFactionDefinition(fRep.id);
      if (!factionDef) continue;

      const relation = gs.factionRelations?.[fRep.id];
      const credit = gs.player.externalStats.credit?.[fRep.id] ?? 0;

      // "Joined" = positive reputation + completed any initial quest for this faction
      const hasPositiveRep = fRep.rep > 0;
      const hasCompletedInitial = relation?.isJoined ?? false;
      const isJoined = hasPositiveRep && hasCompletedInitial;

      const detail: import('../stores/gameStore').FactionTreeDetail = {
        factionId: fRep.id,
        factionName: fRep.name,
        isJoined,
        credit,
        creditLimits: factionDef.credit ? {
          positive: factionDef.credit.positiveLimit,
          negative: factionDef.credit.negativeLimit,
        } : undefined,
        breakpointHit: relation?.creditBreakpointHit ?? false,
        reputation: fRep.rep,
      };

      if (isJoined && factionDef.epic) {
        // Show full structure: checkpoints + quest lines
        detail.checkpoints = factionDef.epic.checkpoints
          .sort((a, b) => a.order - b.order)
          .map(cp => ({
            id: cp.id,
            label: cp.label,
            order: cp.order,
            completed: relation?.completedCheckpointIds?.includes(cp.id) ?? false,
            questIds: cp.requiredQuestIds ?? [],
          }));

        detail.questLines = factionDef.epic.questLines.map(ql => {
          const quests: import('../stores/gameStore').FactionTreeQuestNode[] = [];
          let currentQuestId: string | undefined = ql.entryQuestId;
          const visited = new Set<string>();

          while (currentQuestId && !visited.has(currentQuestId)) {
            visited.add(currentQuestId);
            const qDef = this.lore.getQuest(currentQuestId);
            if (!qDef) break;

            const instance = gs.activeQuests[currentQuestId];
            const isCompleted = gs.completedQuestIds?.includes(currentQuestId) ?? false;
            let status: 'locked' | 'available' | 'active' | 'completed' | 'failed' | 'ditched' = 'locked';
            if (isCompleted) status = 'completed';
            else if (instance?.isFailed) status = 'failed';
            else if (instance) status = 'active';
            else if (quests.length === 0 || quests[quests.length - 1].status === 'completed') status = 'available';

            quests.push({
              questId: currentQuestId,
              name: qDef.name,
              status,
              coupling: qDef.coupling?.[fRep.id] ?? 0,
              questCategory: qDef.questCategory,
            });

            currentQuestId = qDef.nextQuestId;
          }

          return { id: ql.id, label: ql.label, quests };
        });
      } else {
        // Not joined: show only known quests (active or completed) that are coupled to this faction
        const knownQuests: import('../stores/gameStore').FactionTreeQuestNode[] = [];
        const allQuestIds = new Set([
          ...Object.keys(gs.activeQuests),
          ...(gs.completedQuestIds ?? []),
        ]);

        for (const qid of allQuestIds) {
          const qDef = this.lore.getQuest(qid);
          if (!qDef?.coupling?.[fRep.id]) continue;

          const instance = gs.activeQuests[qid];
          const isCompleted = gs.completedQuestIds?.includes(qid) ?? false;
          let status: 'locked' | 'available' | 'active' | 'completed' | 'failed' | 'ditched' = 'locked';
          if (isCompleted) status = 'completed';
          else if (instance?.isFailed) status = 'failed';
          else if (instance) status = 'active';

          knownQuests.push({
            questId: qid,
            name: qDef.name,
            status,
            coupling: qDef.coupling[fRep.id],
            questCategory: qDef.questCategory,
          });
        }

        if (knownQuests.length > 0) {
          detail.knownQuests = knownQuests;
        }
      }

      result[fRep.id] = detail;
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  // -- Scripted dialogue (private) ------------------------------------

  /** Build the current interpolation context from live game state. */
  private buildInterpolationCtx(): InterpolationContext {
    const gs       = this.state.getState();
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    const region   = this.lore.getRegion(this.currentRegionId);
    const timeStr  = this.timeMgr.formatTime(gs.time);
    // Split "AD 1498-06-12 21:23" into date / hour parts
    const spaceIdx = timeStr.lastIndexOf(' ');
    const datePart = spaceIdx > 0 ? timeStr.slice(0, spaceIdx) : timeStr;
    const hourPart = spaceIdx > 0 ? timeStr.slice(spaceIdx + 1) : '';
    return {
      playerName:    gs.player.name,
      formattedTime: timeStr,
      formattedDate: datePart,
      formattedHour: hourPart,
      periodLabel:   this.timeMgr.formatPeriod(gs.timePeriod),
      locationName:  resolved?.name ?? gs.player.currentLocationId,
      regionName:    region?.name   ?? this.currentRegionId,
    };
  }

  private renderNodeLines(
    lines:   import('../types/dialogue').ScriptedLine[],
    npcName: string,
    ctx:     InterpolationContext,
  ): string[] {
    return lines.map(line => {
      const text = interpolate(line.text, ctx);
      if (line.speaker === 'npc')    return `${npcName}：「${text}」`;
      if (line.speaker === 'player') return `> ${text}`;
      return text;
    });
  }

  /**
   * Stream rendered dialogue lines character-by-character, mimicking DM typewriter output.
   * Choices are NOT set until all lines finish streaming.
   */
  private async streamScriptedLines(
    rendered:    string[],
    sourceLines: import('../types/dialogue').ScriptedLine[],
  ): Promise<void> {
    for (let i = 0; i < rendered.length; i++) {
      const src  = sourceLines[i];
      const type = src.speaker === 'player' ? 'player' as const
                 : src.speaker === 'npc'    ? 'dialogue' as const
                 :                            'narrative' as const;
      pushLine('', type, true);
      for (const char of rendered[i]) {
        appendToLastLine(char);
        await sleep(16);
      }
      finishLastLine();
      if (i < rendered.length - 1) await sleep(220);

      // Log scripted lines to session log so LLM has dialogue history when taking over
      if (src.speaker === 'npc') {
        appendEncounterLog('npc', rendered[i]);
      } else if (src.speaker === 'player') {
        appendEncounterLog('player', rendered[i].replace(/^> /, ''));
      }
    }
  }

  private async activateScriptedNode(
    npcId:           string,
    dialogueId:      string,
    npcName:         string,
    nodeId:          string,
    node:            import('../types/dialogue').ScriptedNode,
    endAfterScript = false,
  ): Promise<void> {
    this._scriptedFiredThisSession = true;
    const ctx      = this.buildInterpolationCtx();
    const rendered = this.renderNodeLines(node.lines, npcName, ctx);

    // Clear any dangling streaming cursor from a previous LLM turn
    finishLastLine();

    isStreaming.set(true);
    await this.streamScriptedLines(rendered, node.lines);
    isStreaming.set(false);

    const filteredChoices = this.dialogueMgr.filterChoices(node.choices, this.state.flags);

    activeScriptedDialogue.set({
      npcId, npcName, dialogueId,
      currentNodeId:      nodeId,
      currentChoices:     filteredChoices,
      collectedNarrative: rendered.join('\n'),
      endAfterScript,
    });

    if (filteredChoices.length === 0) {
      if (this._pendingAutoEnd) clearTimeout(this._pendingAutoEnd);
      this._pendingAutoEnd = setTimeout(() => {
        this._pendingAutoEnd = null;
        this.endScriptedDialogue().catch(err => log.warn('endScriptedDialogue error', err));
      }, 600);
    }
  }

  /**
   * After recordNPCInteraction, check if any knowledgeTriggers thresholds have been
   * reached and auto-set the corresponding NPC-local flags.
   */
  private checkNPCKnowledgeTriggers(npcId: string): void {
    const npc = this.lore.getNPC(npcId);
    if (!npc?.knowledgeTriggers?.length) return;
    const mem = this.state.getState().npcMemory[npcId];
    if (!mem) return;
    const count = mem.interactionCount;
    for (const trigger of npc.knowledgeTriggers) {
      if (count < trigger.interactionCount) continue;
      if (trigger.condition && !this.state.flags.evaluate(trigger.condition)) continue;
      this.state.setNPCFlag(npcId, trigger.flagId);
    }
  }

  private async endScriptedDialogue(): Promise<void> {
    const current = get(activeScriptedDialogue);
    if (!current) return;

    const { npcId, npcName } = current;

    // Increment NPC interaction count first — this creates npcMemory entry if first contact.
    this.state.recordNPCInteraction(npcId);
    this.checkNPCKnowledgeTriggers(npcId);

    // Build a topic summary from the player choices recorded in collectedNarrative.
    // "[玩家]: <choice text>" lines are appended by selectDialogueChoice().
    const playerChoices = current.collectedNarrative
      .split('\n')
      .filter(l => l.startsWith('[玩家]:'))
      .map(l => l.replace(/^\[玩家\]:\s*/, '').trim())
      .filter(Boolean);

    if (playerChoices.length > 0) {
      const topicSummary = playerChoices.join('、');
      // Persist as lastTopic so DM's npcContext reflects this scripted exchange
      this.state.updateNPCDialogueState(npcId, topicSummary);
      // Inject a boundary marker into the session log so the DM sees the transition clearly
      appendEncounterLog('npc', `（劇情固定對話結束，話題：${topicSummary}）`);
    }

    // Record to history for DM context in future turns
    this.state.appendHistory(
      { type: 'interact', input: `與 ${npcName} 交談`, targetId: npcId },
      current.collectedNarrative.slice(0, 400),
    );

    activeScriptedDialogue.set(null);

    // Sweep quest objectives now — dialogue choice effects (flags, reputation) may have
    // advanced a flag-check objective (e.g. delivering intel closes a pending_intel stage).
    this.quests.checkObjectives();

    // Scripted segment done.
    // If endAfterScript is set, close the NPC panel instead of launching LLM opener.
    const npc = this.lore.getNPC(npcId);
    if (npc && get(activeNpcUI) && !current.endAfterScript) {
      // 這段可能由 600ms 自動結束計時器觸發（非玩家點擊），input 當時已被重新啟用。
      // 在呼叫 LLM opener 期間重新鎖住，避免玩家此刻點擊舊的探索想法/輸入文字，
      // 與這次 opener 併發送進對話（handleDialogueInput 的重入鎖是第二層保險）。
      inputDisabled.set(true);
      try {
        await this.handleDialogueInput('(opener)', npcId, true);
      } finally {
        inputDisabled.set(false);
      }
      return;
    }

    if (current.endAfterScript) {
      activeNpcUI.set(null);
    }

    this.syncUIState(this.state.getState());

    // Drain queued interactions (NPC dialogues / encounters from events) after scripted dialogue ends.
    if (current.endAfterScript && await this.startNextQueuedEncounter()) {
      this.flushAcquisitions();
      if (this.checkEndingConditions()) return;
      this.releaseInput();
      return;
    }

    // endAfterScript（劇本結束即關閉對話）——還原進入對話前的探索想法快照
    await this.exitDialogueThoughts();
    this.autoSave().catch(err => log.warn('Auto-save after scripted dialogue failed', err));
  }

  private updateActiveNpcUI(npcId: string): void {
    const npc = this.lore.getNPC(npcId);
    if (!npc) { activeNpcUI.set(null); return; }
    // New encounter (different NPC or first time) — reset session log
    const current = get(activeNpcUI);
    if (!current || current.npcId !== npcId) {
      encounterSessionLog.set([]);
      this._sessionFiredTriggers.clear(); this._scriptedFiredThisSession = false;
      // 新的一段對話 = 一次會面（同段對話後續輪次走 else 路徑，不重複計數）
      this.state.recordNPCMeeting(npcId);
      // 快照進入對話前的探索想法，清空 thoughts（Bug A 來源修正：對話中不應殘留探索候選）
      this.snapshotThoughtsBeforeDialogue();
    }
    const gs  = this.state.getState();
    const mem = gs.npcMemory[npcId];
    activeNpcUI.set({
      npcId,
      name:             npc.name,
      publicDescription: npc.publicDescription,
      affinity:         gs.player.externalStats.affinity[npcId] ?? 0,
      attitude:         mem?.playerAttitude ?? 'neutral',
      interactionCount: mem?.interactionCount ?? 0,
    });
  }


  // -- Mock mode --------------------------------------------------------

  private async runMockIntro(): Promise<void> {
    thoughts.set([
      { id: 'look',  text: '觀察四周',     actionType: 'examine'  },
      { id: 'move',  text: '尋找出口',     actionType: 'move'     },
      { id: 'talk',  text: '找個人說話',   actionType: 'examine'  },
    ]);

    const lines = [
      'The alarm tears you out of shallow sleep.',
      'Dormitory lights snap on at exactly five-thirty -- not for your comfort, but to make sure you reach the quota station in District Four on time.',
      'The person on the bunk above is already up. The metal frame groans in the silence of the corridor.',
      'You have fifteen minutes.',
    ];

    isStreaming.set(true);
    pushLine('', 'narrative');
    for (const line of lines) {
      for (const char of line) {
        appendToLastLine(char);
        await sleep(32);
      }
      appendToLastLine('\n');
      await sleep(220);
    }
    finishLastLine();
    isStreaming.set(false);
    playerUI.update((p) => ({ ...p, location: '戴司 — 宿舍寢室' }));
  }

  private async runMockResponse(input: string): Promise<void> {
    isStreaming.set(true);
    pushLine('', 'narrative');
    const response = '[Mock mode] You attempt: ' + input + '.\nSet VITE_OLLAMA_MODEL or VITE_ANTHROPIC_API_KEY in .env to enable the DM.';
    for (const char of response) {
      appendToLastLine(char);
      await sleep(22);
    }
    finishLastLine();
    isStreaming.set(false);
  }

  // -- Debug API --------------------------------------------------------

  /**
   * Shared post-update routine for debug operations.
   * Mirrors the tail of processAction: auto-unset flags, quest/phase checks,
   * sync UI, and ending condition check.
   */
  private debugPostSystemUpdate(): void {
    this.lore.flagRegistry.processFlagUnsets(this.state.flags);
    this.quests.checkTimeLimits(this.state.getState().time.totalMinutes);
    this.quests.checkObjectives();
    this.quests.checkPendingRepeats();
    this.phases.checkAdvance();
    this.syncUIState(this.state.getState());
    this.flushAcquisitions();
    this.checkEndingConditions();
  }

  /** Returns all lore catalog entries for the debug launcher panel. */
  getDebugCatalog() {
    return this.lore.getDebugCatalog();
  }

  /** Directly start a structured encounter by ID, bypassing event flow. */
  async debugTriggerEncounter(encounterId: string): Promise<void> {
    if (!this.lore.getEncounter(encounterId)) {
      pushLine(`[Debug] 找不到遭遇：${encounterId}`, 'system');
      return;
    }
    pushLine(`[Debug] 觸發遭遇：${encounterId}`, 'system');
    await this.startAndRenderEncounter(encounterId, undefined, true);
  }

  /** Open the NPC dialogue panel for npcId and immediately fire any matching scripted trigger. */
  async debugStartNpcDialogue(npcId: string): Promise<void> {
    const npc = this.lore.resolveNPC(npcId, this.state.flags, this.state.getState().timePeriod);
    if (!npc) {
      pushLine(`[Debug] 找不到 NPC：${npcId}`, 'system');
      return;
    }
    activeNpcUI.set(null);
    encounterSessionLog.set([]);
    this._sessionFiredTriggers.clear(); this._scriptedFiredThisSession = false;
    this.updateActiveNpcUI(npcId);

    // Fire scripted trigger immediately (same logic as interact action flow)
    const interactionCount = this.state.getState().npcMemory[npcId]?.interactionCount ?? 0;
    const scripted = this.dialogueMgr.checkScriptedTrigger(
      npcId, npc.activeDialogueId, this.state.flags, interactionCount,
      this._sessionFiredTriggers,
    );
    if (scripted) {
      this._sessionFiredTriggers.add(scripted.nodeId);
      await this.activateScriptedNode(npcId, scripted.dialogueId, npc.name, scripted.nodeId, scripted.node, scripted.endAfterScript);
    } else {
      // No scripted trigger — NPC opens the conversation via LLM
      await this.handleDialogueInput('(opener)', npcId, true);
    }
  }

  /** Force-trigger a game event by ID, bypassing all canTrigger conditions. */
  async debugForceEvent(eventId: string): Promise<void> {
    const triggered = this.events.forceEvent(eventId);
    if (!triggered) {
      pushLine(`[Debug] 找不到事件或無可選結果：${eventId}`, 'system');
      return;
    }
    pushLine(`[Debug] 強制觸發事件：${triggered.event.description ?? eventId}`, 'system');

    // Apply side effects recursively (handles failQuest -> startEventId chains, notifications, etc.)
    const { eventEncounters: debugEncounters, extraTriggered: debugExtra } =
      this.processTriggeredEvents([triggered]);
    const allDebugTriggered = [triggered, ...debugExtra];

    // Narrate the event (and any sub-events) first so event text appears before encounter UI.
    const debugPrefix = `[DEBUG MODE — 此事件由開發人員手動強制觸發，玩家實際位置可能與事件預期地點不符。請直接根據提供的事件 Context 描述情況，模擬此事件的發生，無需顧慮地點一致性。]\n\n`;
    const eventCtx = debugPrefix + this.buildSceneCtx(allDebugTriggered);
    await this.runEventDM(eventCtx, allDebugTriggered.some(t => t.notification) ? 'event' : 'narrative');
    this.flushAcquisitions();

    // Launch encounters after narration completes (includes encounters from sub-event chains).
    for (const enc of debugEncounters) {
      await this.startAndRenderEncounter(enc.id, this.lore.getEncounter(enc.id) ?? undefined, true);
      this.flushAcquisitions();
    }

    // Run the same post-event systems as the normal turn pipeline
    this.debugPostSystemUpdate();
  }

  /**
   * Diagnose why a specific event is (or isn't) triggering at the current location/state.
   * Returns a human-readable report of each condition's pass/fail status.
   */
  debugDiagnoseEvent(eventId: string): string {
    const lines: string[] = [`── 診斷事件：${eventId} ──`];

    const event = this.lore.getEvent(eventId);
    if (!event) {
      lines.push('✗ 找不到此事件 ID（未載入）');
      return lines.join('\n');
    }

    // Check 1: eventsEnabled
    const eventsEnabled = this.state.flags.has('game_day1_started');
    lines.push(eventsEnabled ? '✓ game_day1_started: 已設置' : '✗ game_day1_started: 未設置（事件全面停用）');

    // Check 2: Is event registered at current location (or any ancestor)?
    const gs = this.state.getState();
    const currentLocId = gs.player.currentLocationId;
    let found = false;
    let checkLocId: string | undefined = currentLocId;
    const checkedLocs: string[] = [];
    while (checkLocId) {
      const loc = this.lore.resolveLocation(checkLocId, this.state.flags);
      if (!loc) break;
      checkedLocs.push(checkLocId);
      if (loc.eventIds.includes(eventId)) { found = true; break; }
      checkLocId = loc.parentId;
    }
    lines.push(found
      ? `✓ 事件已在位置鏈中登錄 (${checkedLocs.join(' → ')})`
      : `✗ 事件不在當前位置鏈中 (當前: ${currentLocId}, 檢查了: ${checkedLocs.join(', ')})`);

    // Check 3: :fired flag
    const fired = this.state.flags.has(eventId + ':fired');
    lines.push(fired ? `✗ ${eventId}:fired 已設置（不可重複事件已消耗）` : `✓ :fired 未設置`);

    // Check 4: required flags
    const { condition } = event;
    if (condition.flags?.length) {
      const missing = condition.flags.filter(f => !this.state.flags.has(f));
      lines.push(missing.length === 0
        ? `✓ 必要旗標全部存在: [${condition.flags.join(', ')}]`
        : `✗ 缺少旗標: [${missing.join(', ')}]`);
    } else {
      lines.push('✓ 無必要旗標條件');
    }

    // Check 5: notFlags
    if (condition.notFlags?.length) {
      const blocking = condition.notFlags.filter(f => this.state.flags.has(f));
      lines.push(blocking.length === 0
        ? `✓ notFlags 全部不存在`
        : `✗ 封鎖旗標已設置: [${blocking.join(', ')}]`);
    } else {
      lines.push('✓ 無 notFlags 條件');
    }

    // Check 6: timePeriods
    const schedule = this.lore.getSchedule(this.currentRegionId) ?? null;
    if (condition.timePeriods?.length) {
      if (!schedule) {
        lines.push('✗ 無法取得地區 Schedule（timePeriods 條件無法評估）');
      } else {
        const current = this.timeMgr.getCurrentPeriod(gs.time, schedule, gs.player.activeFlags);
        const ok = condition.timePeriods.includes(current);
        lines.push(ok
          ? `✓ timePeriods: 當前=${current}, 條件=[${condition.timePeriods.join(', ')}]`
          : `✗ timePeriods: 當前=${current}, 條件=[${condition.timePeriods.join(', ')}] → 不符合`);
      }
    } else {
      lines.push('✓ 無 timePeriods 條件');
    }

    // Check 7: timeRanges
    if (condition.timeRanges?.length) {
      const nowMin = gs.time.hour * 60 + gs.time.minute;
      const matched = condition.timeRanges.some(r => {
        const s = r.startHour * 60 + (r.startMinute ?? 0);
        const e = r.endHour * 60 + (r.endMinute ?? 0);
        return s < e ? (nowMin >= s && nowMin < e) : (nowMin >= s || nowMin < e);
      });
      lines.push(matched
        ? `✓ timeRanges: 當前時間 ${gs.time.hour}:${String(gs.time.minute).padStart(2,'0')} 符合`
        : `✗ timeRanges: 當前時間 ${gs.time.hour}:${String(gs.time.minute).padStart(2,'0')} 不在任何範圍內`);
    } else {
      lines.push('✓ 無 timeRanges 條件');
    }

    // Check 8: triggerHours (note: actual trigger requires crossing, can't check here)
    if (condition.triggerHours?.length) {
      lines.push(`⚠ triggerHours: [${condition.triggerHours.join(', ')}] — 需要跨越這些整點才觸發，靜態診斷無法確認`);
    }

    // Summary
    lines.push(`──`);
    lines.push(`當前位置: ${currentLocId} | 時間: ${gs.time.hour}:${String(gs.time.minute).padStart(2,'0')} | 時段: ${gs.timePeriod}`);
    lines.push(`game_day1_started: ${eventsEnabled}`);

    return lines.join('\n');
  }

  /** Grant a quest directly, regardless of conditions. */
  debugGrantQuest(questId: string): void {
    const ok = this.quests.grantQuest(questId, { source: 'event' });
    pushLine(ok
      ? `[Debug] 已授予任務：${questId}`
      : `[Debug] 任務授予失敗（已存在或 ID 錯誤）：${questId}`,
      'system',
    );
    if (ok) this.debugPostSystemUpdate();
  }

  /** Set a flag and sync UI. Runs quest/phase checks like the normal turn pipeline. */
  debugSetFlag(flag: string): void {
    this.state.flags.set(flag);
    pushLine(`[Debug] 旗標設置：${flag}`, 'system');
    this.debugPostSystemUpdate();
  }

  /** Unset a flag and sync UI. Runs quest/phase checks like the normal turn pipeline. */
  debugUnsetFlag(flag: string): void {
    this.state.flags.unset(flag);
    pushLine(`[Debug] 旗標清除：${flag}`, 'system');
    this.debugPostSystemUpdate();
  }

  /** Teleport player to locationId, reset NPC panel, refresh UI. */
  async debugTeleport(locationId: string): Promise<void> {
    const loc = this.lore.getLocation(locationId);
    if (!loc) {
      pushLine(`[Debug] 找不到地點：${locationId}`, 'system');
      return;
    }
    this.state.movePlayer(locationId);
    activeNpcUI.set(null);
    encounterSessionLog.set([]);
    this._sessionFiredTriggers.clear(); this._scriptedFiredThisSession = false;
    this.syncUIState(this.state.getState());
    pushLine(`[Debug] 傳送至：${loc.name}`, 'system');

    // Check ending conditions after teleport (e.g. reaching wyar_transit_hub).
    if (this.checkEndingConditions()) return;

    // Anchor the teleport in history so subsequent DM calls see the correct location.
    // We do NOT call runDM here — the DM is fed this as a completed move and may emit
    // a spurious <<MOVE:>> signal based on stale history, which would undo the teleport.
    this.state.appendHistory(
      { type: 'move', input: `（傳送至 ${loc.name}）` },
      `[Debug] 傳送至 ${loc.name}。`,
    );
  }

  /** Discard all progress and restart (equivalent to a fresh new game in debug mode). */
  async debugResetGame(): Promise<void> {
    this.loadState(this.buildInitialState(), []);
    if (this.starterConfig) {
      this.loadStarter(this.starterConfig);
    }
    narrativeLines.set([]);
    activeNpcUI.set(null);
    activeScriptedDialogue.set(null);
    activeEncounterUI.set(null);
    encounterSessionLog.set([]);
    this._sessionFiredTriggers.clear(); this._scriptedFiredThisSession = false;
    this._encounterQueue = [];
    await this.start('DEBUG');
  }

  /**
   * Print the assembled DM context for the current scene and all nearby NPCs.
   * Useful for verifying secretLayers, contextSnippets, and scene data are injected correctly.
   *
   * Usage: type `debug context` or `debug context <npcId>` in the debug input.
   */
  debugInspectContext(npcId?: string): void {
    if (npcId) {
      // Dialogue context for a specific NPC
      const npc = this.lore.resolveNPC(npcId, this.state.flags, this.state.getState().timePeriod);
      if (!npc) {
        pushLine(`[Debug] 找不到 NPC：${npcId}`, 'system');
        return;
      }
      const ctx = this.dialogueMgr.buildNPCDialogueContext(npcId, npc.activeDialogueId, this.state.flags);
      pushLine(`[Debug] 對話 context — ${npcId}:\n\n${ctx || '（空）'}`, 'system');
    } else {
      // Scene context (what the exploration DM receives)
      const ctx = this.buildSceneCtx([]);
      pushLine(`[Debug] 場景 context:\n\n${ctx}`, 'system');
    }
  }

  /**
   * Set a player stat to an exact value by dot-path (e.g. "statusStats.stamina").
   * Clamps at 0. Runs post-system update (quest/phase checks, ending conditions).
   */
  debugSetStat(dotPath: string, value: number): void {
    const gs = this.state.getState();
    const [group, stat] = dotPath.split('.');
    const statsGroup = (gs.player as unknown as Record<string, Record<string, number>>)[group];
    if (!statsGroup || !(stat in statsGroup)) return;
    const delta = value - statsGroup[stat];
    this.state.modifyStat(dotPath, delta);
    this.debugPostSystemUpdate();
  }

  /**
   * Jump game time forward to a specific date + time (always advances, never goes back).
   * Max date: 1504-12-31. Resolves the new time period from the region schedule and syncs UI.
   * Also fires time-crossing events and ticks item expiry, matching the normal turn pipeline.
   */
  async debugSetTime(year: number, month: number, day: number, hour: number, minute: number): Promise<void> {
    const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const EPOCH_YEAR = 1498;
    const MAX = { year: 1504, month: 12, day: 31 };

    // Clamp to max date
    if (year > MAX.year || (year === MAX.year && month > MAX.month) ||
        (year === MAX.year && month === MAX.month && day > MAX.day)) {
      year = MAX.year; month = MAX.month; day = MAX.day;
    }
    // Clamp month/day
    month = Math.max(1, Math.min(12, month));
    day   = Math.max(1, Math.min(DAYS_IN_MONTH[month], day));
    hour   = Math.max(0, Math.min(23, hour));
    minute = Math.max(0, Math.min(59, minute));

    // Minutes since epoch (EPOCH_YEAR-01-01 00:00)
    const toMins = (y: number, mo: number, d: number, h: number, mi: number): number => {
      let days = 0;
      for (let yr = EPOCH_YEAR; yr < y; yr++) days += 365;
      for (let m = 1; m < mo; m++) days += DAYS_IN_MONTH[m];
      days += d - 1;
      return days * 1440 + h * 60 + mi;
    };

    const gs      = this.state.getState();
    const cur     = gs.time;
    const delta   = toMins(year, month, day, hour, minute)
                  - toMins(cur.year, cur.month, cur.day, cur.hour, cur.minute);
    if (delta <= 0) return; // target is in the past or same moment

    const prevTime  = { ...cur };
    const newTime   = this.timeMgr.advance(cur, delta);
    const schedule  = this.lore.getSchedule(this.currentRegionId) ?? null;
    const newPeriod = schedule
      ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs.player.activeFlags)
      : gs.timePeriod;
    this.state.advanceTime(newTime, newPeriod);
    this.state.tickItemExpiry(id => this.lore.getItem(id)?.expiresAfterMinutes);

    // Fire time-crossing events (broadcasts, patrols, quest timeouts, etc.)
    const crossedHours = this.timeMgr.computeCrossedHours(prevTime, newTime);
    if (crossedHours.length > 0) {
      if (!this.state.flags.has('game_day1_started') && crossedHours.includes(0)) {
        this.state.flags.set('game_day1_started');
      }
      const eventsEnabled = this.state.flags.has('game_day1_started');
      const qfTriggered  = eventsEnabled ? this.checkQuestFailConditions(crossedHours) : [];
      const glTriggered  = eventsEnabled ? this.events.checkGlobalEvents(this.currentRegionId, crossedHours) : [];
      const locTriggered = eventsEnabled ? this.events.checkAndApply(this.state.getState().player.currentLocationId, crossedHours) : [];
      const timeTriggered = [...qfTriggered, ...glTriggered, ...locTriggered];
      if (timeTriggered.length > 0) {
        const { eventEncounters, extraTriggered } = this.processTriggeredEvents(timeTriggered);
        const allTriggered = [...timeTriggered, ...extraTriggered];
        const eventCtx = this.buildSceneCtx(allTriggered);
        await this.runEventDM(eventCtx, allTriggered.some(t => t.notification) ? 'event' : 'narrative');
        this.flushAcquisitions();
        for (const enc of eventEncounters) {
          await this.startAndRenderEncounter(enc.id, enc.def ?? undefined);
          this.flushAcquisitions();
        }
        // Drain NPC dialogues queued by processTriggeredEvents
        while (this._npcDialogueQueue.length > 0) {
          const dlg = this._npcDialogueQueue.shift()!;
          await this.activateEventNpcDialogue(dlg);
        }
      }
    }

    this.debugPostSystemUpdate();
  }

  /** Set melphin (currency) to an exact value. */
  debugSetMelphin(value: number): void {
    const gs = this.state.getState();
    this.state.modifyMelphin(value - gs.player.melphin);
    this.syncUIState(this.state.getState());
  }

  /** Set a faction's reputation to an exact value (marks faction as contacted). */
  debugSetReputation(factionId: string, value: number): void {
    const gs = this.state.getState();
    const current = gs.player.externalStats.reputation[factionId] ?? 0;
    this.state.modifyReputation(factionId, Math.round(value) - current);
    this.syncUIState(this.state.getState());
  }

  /** Set an NPC's affinity to an exact value. */
  debugSetAffinity(npcId: string, value: number): void {
    const gs = this.state.getState();
    const current = gs.player.externalStats.affinity[npcId] ?? 0;
    this.state.modifyAffinity(npcId, Math.round(value) - current);
    this.syncUIState(this.state.getState());
  }

  /** Return the current in-game date/time for debug display. */
  debugGetCurrentTime(): { year: number; month: number; day: number; hour: number; minute: number } {
    const { year, month, day, hour, minute } = this.state.getState().time;
    return { year, month, day, hour, minute };
  }

  /** Directly trigger an ending screen for UI testing. */
  debugTriggerEnding(type: EndingType): void {
    this.triggerEnding(type);
  }

  /** Toggle shadow mode (DM+Judge comparison pipeline). */
  debugToggleShadowMode(): void {
    shadowModeActive.update(v => {
      const next = !v;
      log.info('Shadow mode', { enabled: next });
      return next;
    });
  }

  // -- Initial state ----------------------------------------------------

  private buildInitialState(): GameState {
    return {
      player: {
        id:               'player-1',
        name:             '???',
        origin:           'worker',
        currentLocationId: 'delth_dormitory_room',
        primaryStats:    { strength: 5, knowledge: 5, talent: 5, spirit: 5, luck: 5 },
        primaryStatsExp: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
        inclinationTracker: { strength: 0, knowledge: 0, talent: 0, spirit: 0, luck: 0 },
        dailyGrantTracker:  { dateKey: '1498-6-12', grantedExp: {} },
        secondaryStats:  { consciousness: 2, mysticism: 0, technology: 3 },
        statusStats:     { stamina: 10, staminaMax: 10, stress: 2, stressMax: 10, endo: 0, endoMax: 0, experience: 0, fatigue: 3 },
        externalStats:   { reputation: {}, affinity: {}, familiarity: {} },
        inventory:       [],
        melphin:         25,
        activeFlags:     new Set(),
        titles:          [],
        conditions:      [],
        knownIntelIds:       [],
        contactedFactions:   [],
      },
      turn:                  0,
      phase:                 'exploring',
      pendingThoughts:       [],
      lastNarrative:         '',
      history:               [],
      discoveredLocationIds: [],
      activeQuests:          {},
      completedQuestIds:     [],
      npcMemory:             {},
      propFlags:             {},
      worldPhase: {
        currentPhase:    'grace_period',
        appliedPhaseIds: ['grace_period'],
      },
      // Game begins: AD 1498-06-12 21:23 (rest period — after work shift)
      time: {
        year: 1498, month: 6, day: 12,
        hour: 21, minute: 23,
        totalMinutes: 0,
      },
      timePeriod:     'rest',
      eventCooldowns:   {},
      eventCounters:    {},
      attemptCooldowns: {},
    };
  }
}

/**
 * Extract <<THOUGHTS: a | b | c>> signal from encounter DM narration.
 * Returns parsed suggestions (empty array if signal not found or malformed).
 */
function extractEncounterThoughts(raw: string): string[] {
  const match = raw.match(/<<THOUGHTS:\s*([^>]+)>>/i);
  if (!match) return [];
  return match[1]
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length <= 30);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
