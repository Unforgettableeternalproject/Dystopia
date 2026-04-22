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
import { Regulator }        from '../ai/Regulator';
import { autoClients }      from '../ai/LLMClientFactory';
import type { ILLMClient }  from '../ai/ILLMClient';
import { LoreVault }        from '../lore/LoreVault';
import { EventBus, GameEvents } from './EventBus';
import { StateManager }     from './StateManager';
import { EventEngine }      from './EventEngine';
import { PhaseManager }     from './PhaseManager';
import { QuestEngine }      from './QuestEngine';
import { TimeManager }      from './TimeManager';
import { DialogueManager }  from './DialogueManager';
import { EncounterEngine }  from './EncounterEngine';
import type { ResolvedNode } from './EncounterEngine';
import type { EncounterDefinition } from '../types/encounter';
import type { PlayerAction, ActionType, GameState, StarterConfig, ExplorationShadowComparison, DialogueShadowComparison, TurnResolution, DialogueResolution } from '../types';
import type { TriggeredEvent }          from './EventEngine';
import type { ProximityContext }        from './FlagRegistry';
import type { Thought }                 from '../types';
import { get } from 'svelte/store';
import {
  pushLine,
  appendToLastLine,
  finishLastLine,
  restoreHistoryLines,
  encounterSessionLog,
  appendEncounterLog,
  isStreaming,
  inputDisabled,
  thoughts,
  playerUI,
  narrativeLines,
  type MiniMapData,
  type RegionMapData,
} from '../stores/gameStore';
import type { DialogueLogEntry } from '../ai/DMAgent';
import { createLogger } from '../utils/Logger';
import { warmUpModel }  from '../utils/ModelWarmup';
import { interpolate, type InterpolationContext } from '../utils/textInterpolation';
import * as SaveManager from '../utils/SaveManager';
import type { SlotMeta } from '../utils/SaveManager';
import { activeNpcUI, detailedPlayer, activeScriptedDialogue, activeEncounterUI, isSaving, enqueueQuestBanner, showQuestOutcomeFlash, showEventToast, showAcquisitionNotif, triggerBarFlash, gamePhase, endingType, shadowModeActive, pushShadowComparison } from '../stores/gameStore';
import type { EndingType } from '../stores/gameStore';
import { ACTION_MINUTES } from './TimeManager';

const log = createLogger('GameCtrl');

const STAT_LABELS: Record<string, Record<string, string>> = {
  statusStats:   { stamina: '體力', staminaMax: '體力上限', stress: '壓力', stressMax: '壓力上限', endo: 'Endo', endoMax: 'Endo 上限', experience: '經驗' },
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
  private timeMgr:     TimeManager;
  private dialogueMgr:  DialogueManager;
  private encounterMgr: EncounterEngine;
  private mockMode:     boolean;

  /** ID of the region the player is currently in. Updated on region change. */
  private currentRegionId = 'crambell';

  /**
   * Quest outcomes that happened THIS turn (accumulated via bus events).
   * Promoted to _stagedQuestOutcomes at end of processAction so the DM
   * sees them exactly ONCE — in the NEXT turn's buildSceneCtx — then cleared.
   */
  private _pendingQuestOutcomes: Array<{ name: string; outcome: 'completed' | 'failed' }> = [];
  private _stagedQuestOutcomes:  Array<{ name: string; outcome: 'completed' | 'failed' }> = [];

  /** Maximum NPC dialogue turns before controller forces a wrap-up. */
  private static readonly MAX_DIALOGUE_TURNS = 8;

  /** Scripted trigger nodeIds that have already fired in the current NPC encounter session. */
  private _sessionFiredTriggers = new Set<string>();

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

  }

  /** 將 StateManager 積累的獲取記錄轉成通知顯示。在每段敘事結束後呼叫。 */
  private flushAcquisitions(): void {
    for (const rec of this.state.drainAcquisitions()) {
      if (rec.type === 'item') {
        const item = this.lore.getItem(rec.itemId);
        const baseName = item?.name ?? rec.itemId;
        const variantLabel = rec.variantId ? item?.variants?.find(v => v.id === rec.variantId)?.label : undefined;
        showAcquisitionNotif(`獲得：${variantLabel ? `${baseName} - ${variantLabel}` : baseName}`, true);
      } else if (rec.type === 'stat') {
        const [group, stat] = rec.key.split('.');
        if (group === 'statusStats') {
          // 狀態數值（體力/壓力/Endo）→ 條狀抖動閃爍，不顯示 notif
          if (stat === 'stamina' || stat === 'endo') {
            triggerBarFlash(stat, rec.delta > 0 ? 'good' : 'bad');
          } else if (stat === 'stress') {
            triggerBarFlash(stat, rec.delta > 0 ? 'bad' : 'good');
          }
        } else {
          // 技能數值（primaryStats / secondaryStats）→ 顯示 notif
          const label = STAT_LABELS[group]?.[stat] ?? stat;
          showAcquisitionNotif(`${label} ${rec.delta > 0 ? '+' : ''}${rec.delta}`, rec.delta > 0);
        }
      } else if (rec.type === 'reputation') {
        const faction = this.lore.getFaction(rec.factionId);
        showAcquisitionNotif(`聲望 [${faction?.name ?? rec.factionId}] ${rec.delta > 0 ? '+' : ''}${rec.delta}`, rec.delta > 0);
      } else if (rec.type === 'affinity') {
        const npc = this.lore.getNPC(rec.npcId);
        showAcquisitionNotif(`好感 [${npc?.name ?? rec.npcId}] ${rec.delta > 0 ? '+' : ''}${rec.delta}`, rec.delta > 0);
      }
    }
  }

  // -- Public API -------------------------------------------------------

  loadLore(data: Parameters<LoreVault['load']>[0]): void {
    this.lore.load(data);
    // Refresh schedule for current region after lore load
    this.events.setSchedule(this.lore.getSchedule(this.currentRegionId) ?? null);
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
    s.player.inventory     = config.player.inventory.map((itemId: string) => ({
      instanceId:       `${itemId}_0`,
      itemId,
      obtainedAtMinute: 0,
      quantity:         1,
      isExpired:        false,
    }));
    if (config.player.title) s.player.titles = [config.player.title];
    s.time = { ...config.world.startTime, totalMinutes: 0 };
    s.timePeriod = config.world.startPeriod;
    s.worldPhase.currentPhase    = config.world.worldPhase;
    s.worldPhase.appliedPhaseIds = [config.world.worldPhase];
    for (const flag of config.world.startingFlags) this.state.flags.set(flag);
  }

  async start(playerName?: string): Promise<void> {
    if (playerName?.trim()) {
      this.state.setPlayerName(playerName.trim());
    }
    const gs = this.state.getState();
    this.state.discoverLocation(gs.player.currentLocationId);
    this.discoverSceneNpcs();
    log.info('Game started', { turn: gs.turn, location: gs.player.currentLocationId });

    // Grant origin quests based on player's starting background
    this.quests.autoGrantOriginQuests(gs.player.origin);

    // Sync UI after quests are granted so the quest block renders on first load
    this.syncUIState(this.state.getState());

    if (this.mockMode) {
      log.warn('Running in mock mode -- no LLM client configured');
      this.runMockIntro();
      return;
    }

    // Pre-warm model in background; first DM call benefits from it
    if (this.dmClient) warmUpModel(this.dmClient).catch(() => { /* non-fatal */ });

    const sceneCtx = this.buildSceneCtx([]);
    const { suggestions } = await this.runDM({ type: 'examine', input: '(game start)' }, sceneCtx);
    await this.refreshThoughts(suggestions);
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
    const itemDef = this.lore.getItem(invItem.itemId);
    if (!itemDef || itemDef.type !== 'consumable') return;

    // Apply effect immediately
    this.state.consumeItem(instanceId, itemDef.effect ?? {}, id => this.lore.getCondition(id));
    showAcquisitionNotif(`使用：${itemDef.name}`, false);
    this.flushAcquisitions();
    this.syncUIState(this.state.getState());

    // Send silent action for DM narration (player input not displayed)
    const silentInput = `玩家使用了物品：${itemDef.name}`;
    inputDisabled.set(true);
    try {
      const sceneCtx = this.buildSceneCtx([]);
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
  debugAddItem(itemId: string): void {
    const def = this.lore.getItem(itemId);
    if (!def) return;
    const gs = this.state.getState();
    this.state.addItem(itemId, gs.time.totalMinutes, undefined, {
      stackable:           def.stackable ?? false,
      maxStack:            def.maxStack,
      maxUsesPerInstance:  def.maxUsesPerInstance,
    });
    this.syncUIState(this.state.getState());
  }

  async submitAction(input: string, actionType?: ActionType): Promise<void> {
    if (!input.trim()) return;

    const action: PlayerAction = { type: actionType ?? 'free', input: input.trim() };
    inputDisabled.set(true);
    const inDialogue = !!get(activeNpcUI) && !get(activeScriptedDialogue);
    pushLine(inDialogue ? '「' + input.trim() + '」' : '> ' + input, inDialogue ? 'player-dialogue' : 'player');

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
    const resolvedForReg = this.lore.resolveLocation(gs0reg.player.currentLocationId, this.state.flags);
    const sceneNpcsForReg = (resolvedForReg?.npcIds ?? []).map(id => ({
      id,
      name: this.lore.getNPC(id)?.name ?? id,
    }));
    const result = await this.regulator.validate(action, gs0reg.player, sceneNpcsForReg);
    if (!result.allowed) {
      log.info('Action rejected', { input, reason: result.reason });
      pushLine(result.reason ?? 'That is not possible.', 'rejected');
      inputDisabled.set(false);
      return;
    }

    const finalAction = result.modifiedAction ?? action;

    // Track active NPC panel
    if (finalAction.type === 'move') {
      activeNpcUI.set(null);
      encounterSessionLog.set([]);
      this._sessionFiredTriggers.clear();
    } else if (finalAction.type === 'interact' && finalAction.targetId) {
      this._sessionFiredTriggers.clear();
      this.updateActiveNpcUI(finalAction.targetId);
    }

    // 1.5. Check for scripted dialogue trigger on interact
    if (finalAction.type === 'interact' && finalAction.targetId) {
      const npc = this.lore.getNPC(finalAction.targetId);
      if (npc) {
        const interactionCount =
          this.state.getState().npcMemory[finalAction.targetId]?.interactionCount ?? 0;
        const scripted = this.dialogueMgr.checkScriptedTrigger(
          finalAction.targetId, npc.dialogueId, this.state.flags, interactionCount,
          this._sessionFiredTriggers,
        );
        if (scripted) {
          this._sessionFiredTriggers.add(scripted.nodeId);
          await this.activateScriptedNode(
            finalAction.targetId, npc.dialogueId, npc.name,
            scripted.nodeId, scripted.node,
          );
          inputDisabled.set(false);
          return; // Skip normal turn pipeline — scripted dialogue takes over
        }
      }
    }

    // 2. Tick conditions
    this.state.tickConditions(id => this.lore.getCondition(id));

    // 2.5. Advance in-game time (default amount for event/period detection)
    const gs0            = this.state.getState();
    const initialTime    = { ...gs0.time };
    const schedule       = this.lore.getSchedule(this.currentRegionId) ?? null;
    const defaultMinutes = ACTION_MINUTES[finalAction.type] ?? 10;
    const newTime   = this.timeMgr.advance(gs0.time, defaultMinutes);
    const newPeriod = schedule
      ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs0.player.activeFlags)
      : gs0.timePeriod;
    const periodChanged  = this.state.advanceTime(newTime, newPeriod);
    this.state.tickItemExpiry(id => this.lore.getItem(id)?.expiresAfterMinutes);
    const crossedHours   = this.timeMgr.computeCrossedHours(initialTime, newTime);

    // Guard: Day 0 suppression.
    // The player starts mid-day-zero (e.g., 21:43). No lore events fire until the clock
    // first crosses midnight (hour 0), which marks the start of Day 1.
    // forceEvent() (debug) bypasses this guard independently.
    if (!this.state.flags.has('game_day1_started') && crossedHours.includes(0)) {
      this.state.flags.set('game_day1_started');
    }
    const eventsEnabled = this.state.flags.has('game_day1_started');

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

    const { eventEncounter, extraTriggered } = this.processTriggeredEvents(triggered);
    // Merge sub-events (e.g. from failQuest -> startEventId chains) so DM narration covers them.
    const allTriggered = [...triggered, ...extraTriggered];

    // 4. DM narration
    // For NPC interact: route to isolated dialogue DM — full scene context is not injected.
    // The dialogue DM only receives NPC profile + session history, preventing hallucination.
    if (finalAction.type === 'interact' && finalAction.targetId && get(activeNpcUI)) {
      await this.handleDialogueInput(finalAction.input, finalAction.targetId);
      this.discoverSceneNpcs();
      inputDisabled.set(false);
      return;
    }

    // 4.1. Narrate triggered events in a separate DM pass BEFORE the player-action DM.
    // This keeps event narration and action response from bleeding together.
    if (allTriggered.length > 0) {
      const eventCtx = this.buildSceneCtx(allTriggered, periodChanged);
      const hasNotification = allTriggered.some(t => t.event.notification);
      await this.runEventDM(eventCtx, hasNotification ? 'event' : 'narrative');
      this.flushAcquisitions();
    }

    // 4.15. Launch event-triggered encounter AFTER narration so event text plays first.
    if (eventEncounter) {
      const resolved = this.encounterMgr.start(eventEncounter.id);
      if (resolved) {
        await this.renderEncounterNode(resolved, eventEncounter.def ?? undefined);
        log.info('Encounter started by event', { encounterId: eventEncounter.id });
      }
      this.flushAcquisitions();
      this.releaseInput();
      return;
    }

    // 4.2. Player action DM — events already narrated above, so triggered is empty here.
    const sceneCtx = this.buildSceneCtx([], periodChanged, finalAction);
    const navHint  = this.buildNavHint(finalAction);
    const { resolution, suggestions } = await this.runDM(finalAction, sceneCtx + navHint);
    this.flushAcquisitions();

    // 4.5. Apply extra time if resolution exceeds the default advance (e.g., sleeping 8 h)
    if (resolution.timeMinutes != null && resolution.timeMinutes > defaultMinutes) {
      const extra       = resolution.timeMinutes - defaultMinutes;
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
        const lateEventsEnabled = this.state.flags.has('game_day1_started');
        const lateQuestFail = lateEventsEnabled ? this.checkQuestFailConditions(extraCrossed) : [];
        const lateGlobal    = lateEventsEnabled ? this.events.checkGlobalEvents(this.currentRegionId, extraCrossed) : [];
        const lateLocation  = lateEventsEnabled ? this.events.checkAndApply(this.state.getState().player.currentLocationId, extraCrossed) : [];
        const lateTriggered = [...lateQuestFail, ...lateGlobal, ...lateLocation];
        const { eventEncounter: lateEventEncounter, extraTriggered: lateExtra } =
          this.processTriggeredEvents(lateTriggered);
        const allLateTriggered = [...lateTriggered, ...lateExtra];

        if (allLateTriggered.length > 0) {
          const lateEventCtx = this.buildSceneCtx(allLateTriggered, latePeriodChanged);
          const hasNotification = allLateTriggered.some(t => t.event.notification);
          await this.runEventDM(lateEventCtx, hasNotification ? 'event' : 'narrative');
          this.flushAcquisitions();
        }

        if (lateEventEncounter) {
          const resolved = this.encounterMgr.start(lateEventEncounter.id);
          if (resolved) {
            await this.renderEncounterNode(resolved, lateEventEncounter.def ?? undefined);
            log.info('Encounter started by delayed event', { encounterId: lateEventEncounter.id });
          }
          this.flushAcquisitions();
          this.releaseInput();
          return;
        }
      }
    }

    // 4.6. Auto-discover NPCs visible in the current scene
    this.discoverSceneNpcs();

    // 4.7. Process automatic flag unsets (FlagManifest unsetCondition)
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
        await this.handleDialogueInput('(opener)', enc.npcId, true);
        inputDisabled.set(false);
      } else if (enc.type === 'event' && enc.encounterId) {
        const resolved = this.encounterMgr.start(enc.encounterId);
        if (resolved) await this.renderEncounterNode(resolved);
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
    return this.quests.ditchQuest(questId);
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
    await SaveManager.saveSlot(
      slotId,
      gs,
      this.state.flags.toArray(),
      resolved?.name ?? gs.player.currentLocationId,
      this.timeMgr.formatTime(gs.time),
      label,
    );
    log.info('Game saved', { slotId });
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
      await this.endScriptedDialogue();
      return;
    }

    const nextNode = this.dialogueMgr.getNode(current.npcId, current.dialogueId, targetNodeId);
    if (!nextNode) {
      activeScriptedDialogue.set({ ...current, collectedNarrative: updatedNarrative });
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

    // Auto-end if the node has no choices
    if (filteredChoices.length === 0) {
      setTimeout(() => {
        this.endScriptedDialogue().catch(err => log.warn('endScriptedDialogue error', err));
      }, 600);
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
    // Rebuild StateManager with the restored state
    (this as unknown as { state: StateManager }).state = new StateManager(gs, this.bus);
    flags.forEach(f => this.state.flags.set(f));
    const schedule = this.lore.getSchedule(this.currentRegionId) ?? null;
    this.events       = new EventEngine(this.lore, this.state, this.timeMgr, schedule);
    this.phases       = new PhaseManager(this.lore, this.state);
    this.quests       = new QuestEngine(this.lore, this.state);
    this.dialogueMgr  = new DialogueManager(this.lore, this.state);
    this.encounterMgr = new EncounterEngine(this.lore, this.state);
    this.syncUIState(gs);
    log.info('State loaded from save', { turn: gs.turn });
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

    parts.push([
      '## Current Time',
      'Time: ' + timeStr + ' | ' + periodStr + periodNote,
      schedLine ? 'Schedule: ' + schedLine : '',
    ].filter(Boolean).join('\n'));

    // ── Location context ───────────────────────────────────────────────────
    parts.push(
      this.lore.buildSceneContext(
        gs.player.currentLocationId,
        this.state.flags,
        gs.npcMemory,
        { timePeriod: gs.timePeriod, gameTime: gs.time, knownIntelIds: gs.player.knownIntelIds, activeQuests: Object.values(gs.activeQuests), inventory: gs.player.inventory, melphin: gs.player.melphin },
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
        ' | Stress: ' + gs.player.statusStats.stress + '/' + gs.player.statusStats.stressMax,
      'World Phase: ' + gs.worldPhase.currentPhase.replace(/_/g, ' '),
      visibleConditions ? 'Conditions: ' + visibleConditions : '',
    ].filter(Boolean).join('\n'));

    const activeQuestLines = Object.values(gs.activeQuests)
      .filter(q => !q.isCompleted && !q.isFailed && q.currentStageId)
      .map(q => {
        const def   = this.lore.getQuest(q.questId);
        const stage = def?.stages[q.currentStageId!];
        return stage ? '- [Quest] ' + def!.name + ': ' + stage.description : '';
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
      const evLines = triggered.map(({ event, outcome }) => [
        '- [觸發] ' + event.description,
        '  [結果] ' + outcome.description,
      ].join('\n'));
      parts.push('\n### Events This Turn\n' + evLines.join('\n'));
    }

    // Proximity-filtered flag manifest
    const proxCtx  = this.buildProximityContext(gs);
    const flagCtx  = this.lore.flagRegistry.buildDMContext(proxCtx);
    if (flagCtx) parts.push('\n' + flagCtx);

    // NPC relationship status for NPCs visible in current time period
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    const sceneNpcIds = this.lore.getNPCsByIds(resolved?.npcIds ?? [], this.state.flags, gs.timePeriod).map(n => n.id);
    if (sceneNpcIds.length > 0) {
      const npcStatus = this.dialogueMgr.buildSceneNPCStatus(sceneNpcIds);
      if (npcStatus) parts.push('\n' + npcStatus);
    }

    // Full dialogue context when interacting with a specific NPC
    if (action?.type === 'interact' && action.targetId) {
      const npc = this.lore.getNPC(action.targetId);
      if (npc && sceneNpcIds.includes(action.targetId)) {
        const rawDialogueCtx = this.dialogueMgr.buildNPCDialogueContext(
          action.targetId,
          npc.dialogueId,
          this.state.flags,
        );
        if (rawDialogueCtx) {
          const dialogueCtx = interpolate(rawDialogueCtx, this.buildInterpolationCtx());
          parts.push('\n' + dialogueCtx);
        }
      }
    }

    return parts.join('\n');
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
    if (action.type !== 'move') return '';

    const gs = this.state.getState();
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    if (!resolved) return '';

    const adjacentIds = new Set(resolved.connections.map(c => c.targetLocationId));

    let bestMatch: { id: string; name: string } | null = null;
    for (const locId of gs.discoveredLocationIds) {
      if (locId === gs.player.currentLocationId || adjacentIds.has(locId)) continue;
      const loc = this.lore.getLocation(locId);
      if (loc && action.input.includes(loc.name)) {
        if (!bestMatch || loc.name.length > bestMatch.name.length) {
          bestMatch = { id: locId, name: loc.name };
        }
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

    const routeNames = pathResult.path.map(id => this.lore.getLocation(id)?.name ?? id);
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
  ): { eventEncounter: { id: string; def: ReturnType<LoreVault['getEncounter']> } | null; extraTriggered: TriggeredEvent[] } {
    let eventEncounter: { id: string; def: ReturnType<LoreVault['getEncounter']> } | null = null;
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
            const { eventEncounter: subEncounter, extraTriggered: subExtra } =
              this.processTriggeredEvents([sub]);
            extraTriggered.push(...subExtra);
            if (subEncounter && !eventEncounter) eventEncounter = subEncounter;
          }
        }
      }
      if (t.startEncounterId && !eventEncounter) {
        eventEncounter = { id: t.startEncounterId, def: this.lore.getEncounter(t.startEncounterId) };
        log.info('Encounter queued by event', { encounterId: t.startEncounterId, eventId: t.event.id });
      }
      if (t.event.notification) {
        showEventToast(t.event.name ?? t.event.id, t.event.notificationVariant ?? 'normal');
      }
    }

    return { eventEncounter, extraTriggered };
  }

  private async runDM(
    action: PlayerAction,
    sceneCtx: string,
  ): Promise<{ resolution: TurnResolution; suggestions: string[] }> {
    // Capture scalar values before any awaits — getState() returns a live reference.
    const gs = this.state.getState();
    const sourceLocationId = gs.player.currentLocationId;
    const sourcePeriod     = gs.timePeriod;

    // ── Phase 1: DM decides all signals as structured JSON ────────────────
    let proposal: TurnResolution;
    try {
      proposal = await this.dm.narrateIntent(sceneCtx, action, gs.history);
    } catch (err) {
      log.warn('DM proposal failed', err);
      proposal = { narrativeSummary: '[proposal error]', timeMinutes: 10 };
    }

    // ── Judge validates constraints; accepts DM values by default ─────────
    let resolution: TurnResolution;
    try {
      resolution = await this.judge.resolve(proposal, action, sceneCtx);
    } catch (err) {
      log.warn('Judge resolve failed', err);
      resolution = { timeMinutes: proposal.timeMinutes ?? 10, reasoning: '[judge error]' };
    }

    // ── Deterministic post-validation (engine-side) ───────────────────────

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
      const resolvedLoc = this.lore.resolveLocation(sourceLocationId, this.state.flags);
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
        const consumed = this.state.consumeItem(instanceId, itemDef.effect ?? {}, id => this.lore.getCondition(id));
        if (consumed) log.info('Item consumed', { instanceId, itemId: invItem!.itemId });
      }
    }

    // ── Apply MOVE from resolution ────────────────────────────────────────
    // Guard on action.type: prevents the DM from moving the player during
    // examine/interact turns where the DM might still describe nearby exits.
    if (resolution.move && action.type === 'move') {
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
        log.warn('Resolution MOVE: no accessible path found', { from: gsCurrent.player.currentLocationId, to: resolution.move });
        resolution.move = undefined;
      }
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
    isStreaming.set(true);
    pushLine('', 'narrative');

    let fullText = '';
    let signalCutoff = -1;
    try {
      for await (const chunk of this.dm.narrate(sceneCtx, action, this.state.getState().history)) {
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
      appendToLastLine('\n[narration error -- please retry]');
    } finally {
      isStreaming.set(false);
    }

    // Extract THOUGHTS only
    let suggestions: string[] = [];
    const thoughtsMatch = /<<THOUGHTS:\s*([^>]+?)>>/i.exec(fullText);
    if (thoughtsMatch) {
      suggestions = thoughtsMatch[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 3);
    }

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
    this._sessionFiredTriggers.clear();
    this.syncUIState(this.state.getState());
    await this.refreshThoughts([]);
  }

  /** Public alias for the UI exit button in NPCPanel. */
  exitDialogue(): void {
    const enc = get(activeNpcUI);
    if (!enc) return;
    void this.forceCloseDialogue(enc.npcId);
  }

  private async handleDialogueInput(text: string, npcId: string, opener = false): Promise<void> {
    const npc = this.lore.getNPC(npcId);
    if (!npc) {
      // NPC gone — exit encounter silently
      activeNpcUI.set(null);
      encounterSessionLog.set([]);
      this._sessionFiredTriggers.clear();
      return;
    }

    // Check for scripted trigger before LLM dialogue (skip in opener mode — already checked)
    if (!opener) {
      const interactionCount = this.state.getState().npcMemory[npcId]?.interactionCount ?? 0;
      const scripted = this.dialogueMgr.checkScriptedTrigger(
        npcId, npc.dialogueId, this.state.flags, interactionCount,
        this._sessionFiredTriggers,
      );
      if (scripted) {
        this._sessionFiredTriggers.add(scripted.nodeId);
        await this.activateScriptedNode(npcId, npc.dialogueId, npc.name, scripted.nodeId, scripted.node);
        return;
      }
    }

    const npcContext = this.dialogueMgr.buildNPCDialogueContext(npcId, npc.dialogueId, this.state.flags);
    // Snapshot log BEFORE appending current player turn (playerInput is passed separately to DM)
    const sessionLog = get(encounterSessionLog) as DialogueLogEntry[];

    // Turn budget: each completed turn = 2 log entries (player + NPC).
    // On the second-to-last turn, hint DM Phase 1 to set endEncounter; after max turns, force-close.
    const completedTurns = Math.floor(sessionLog.length / 2);
    const wrapUp = completedTurns >= GameController.MAX_DIALOGUE_TURNS - 1;

    // ── Phase 1: DM decides signals ────────────────────────────────────
    let proposal: DialogueResolution;
    try {
      proposal = await this.dm.narrateDialogueIntent(npcContext, sessionLog, text, { wrapUp });
    } catch (err) {
      log.error('Dialogue DM Phase 1 failed', err);
      proposal = { endEncounter: false };
    }

    // ── Judge: validate constraints ────────────────────────────────────
    let resolution: DialogueResolution;
    try {
      resolution = await this.judge.resolveDialogue(proposal, npcId, npcContext);
    } catch (err) {
      log.error('Dialogue Judge failed', err);
      resolution = { ...proposal };
    }

    // ── Apply flags (Judge-validated) ──────────────────────────────────
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

    // ── Phase 2: stream narration ──────────────────────────────────────
    isStreaming.set(true);
    pushLine(npc.name + '：', 'dialogue', true);

    let fullText     = '';
    let signalCutoff = -1;
    let streamError  = false;
    try {
      for await (const chunk of this.dm.narrateDialogue(npcContext, sessionLog, text, { endEncounter: shouldEnd })) {
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
    } catch (err) {
      streamError = true;
      log.error('Dialogue DM narration failed', err);
      appendToLastLine('\n[narration error -- please retry]');
      finishLastLine();
    } finally {
      isStreaming.set(false);
    }

    if (streamError) return;

    // Guard: if the encounter was force-closed during streaming (e.g. player clicked exit),
    // discard the in-flight response and do not reopen the NPC panel.
    if (get(activeNpcUI) === null) return;

    // ── Extract THOUGHTS from narration text ───────────────────────────
    let suggestions: string[] = [];
    const thoughtsMatch = /<<THOUGHTS:\s*([^>]+?)>>/i.exec(fullText);
    if (thoughtsMatch) {
      suggestions = thoughtsMatch[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 3);
    }

    // Clean narration: strip signal markers
    const cleanNarrative = this.sanitizeDMOutput(fullText);

    // Patch displayed line with NPC name prefix, finalized as dialogue type
    narrativeLines.update(lines => {
      if (lines.length === 0) return lines;
      const last = lines[lines.length - 1];
      return [...lines.slice(0, -1), {
        ...last,
        text: npc.name + '：' + cleanNarrative,
        type: 'dialogue' as const,
        isStreaming: false,
      }];
    });

    // ── Apply NPC state from resolution ────────────────────────────────
    if (resolution.npcState) {
      this.state.recordNPCInteraction(npcId);
      this.state.updateNPCDialogueState(npcId, resolution.npcState.topic, resolution.npcState.attitude);
    }

    // ── Apply quest signals from resolution ────────────────────────────
    for (const qs of (resolution.questSignals ?? [])) {
      this.quests.applyQuestSignal(qs.questId, qs.type, qs.value);
    }

    // Append this turn to session log (skip player entry in opener mode)
    if (!opener) appendEncounterLog('player', text);
    appendEncounterLog('npc', cleanNarrative);

    // ── Advance time ───────────────────────────────────────────────────
    const timeMinutes = resolution.timeMinutes;
    if (timeMinutes) {
      const gs       = this.state.getState();
      const schedule = this.lore.getSchedule(this.currentRegionId) ?? null;
      const newTime  = this.timeMgr.advance(gs.time, timeMinutes);
      const newPeriod = schedule
        ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs.player.activeFlags)
        : gs.timePeriod;
      this.state.advanceTime(newTime, newPeriod);
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
      this._sessionFiredTriggers.clear();
      this.state.appendHistory(
        { type: 'interact', input: `（與 ${npc.name} 交談）`, targetId: npcId },
        cleanNarrative.slice(0, 200),
      );
    } else {
      // Refresh NPC panel with updated affinity/attitude only if encounter is still active
      this.updateActiveNpcUI(npcId);
    }

    this.syncUIState(this.state.getState());

    // Refresh thoughts (dialogue mode suggestions or post-encounter exploration)
    await this.refreshThoughts(suggestions);
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

    // Handle high-level effects that EncounterEngine stored for us
    const pending = this.encounterMgr.flushPendingEffects();
    if (pending.questGrant) {
      this.quests.grantQuest(pending.questGrant);
      log.info('Quest granted by encounter choice', { questId: pending.questGrant });
    }
    let pendingFailEncounter: { id: string; def: ReturnType<LoreVault['getEncounter']> } | null = null;
    if (pending.questFail) {
      const failResult = this.quests.applyQuestFail(pending.questFail);
      log.info('Quest fail applied by encounter choice', { questId: pending.questFail });
      if (failResult.startEventId) {
        const sub = this.events.fireEventById(failResult.startEventId);
        if (sub) {
          const { eventEncounter: failEnc } = this.processTriggeredEvents([sub]);
          pendingFailEncounter = failEnc;
        }
      }
    }

    if (resolved) {
      // Render node via DM (passing def explicitly so it works even after endEncounter clears state)
      await this.renderEncounterNode(resolved, preDef ?? undefined);
      this.flushAcquisitions();

      if (pending.outcomeType !== undefined) {
        // Outcome node rendered — now conclude the encounter
        this.encounterMgr.conclude(pending.outcomeType);
        activeEncounterUI.set(null);
        this.syncUIState(this.state.getState());
        await this.refreshThoughts();
      }
    } else {
      // Encounter ended without an outcome node (nextNodeId === null or __continue__).
      // Generate a DM closing summary before returning to exploration.
      if (preDef && preActive && !this.mockMode) {
        await this.streamEncounterClose(preDef, preActive.collectedNarrative);
      }
      this.flushAcquisitions();
      activeEncounterUI.set(null);
      this.syncUIState(this.state.getState());
      await this.refreshThoughts();
    }

    // Launch fail-event encounter after the current encounter fully concludes
    if (pendingFailEncounter) {
      const failResolved = this.encounterMgr.start(pendingFailEncounter.id);
      if (failResolved) {
        await this.renderEncounterNode(failResolved, pendingFailEncounter.def ?? undefined);
        this.flushAcquisitions();
      }
      this.releaseInput();
      return;
    }

    this.releaseInput();
  }

  /**
   * Renders a ResolvedNode to the narrative log and updates activeEncounterUI.
   * If the node has a dmNarrative (no hardcoded displayText), streams DM-generated narration.
   */
  private async renderEncounterNode(
    resolved: ResolvedNode,
    def?: EncounterDefinition,
    isDebug = false,
  ): Promise<void> {
    const gs = this.state.getState();
    // Use the explicitly-passed def when available (e.g., after endEncounter clears state).
    const effectiveDef = def ?? this.lore.getEncounter(gs.activeEncounter?.encounterId ?? '');

    // Map encounter type to narrative line style.
    const encType = effectiveDef?.type ?? 'event';
    const lineType =
      encType === 'event'     ? 'event'     :  // blue — event encounter
      encType === 'narrative' ? 'scene'     :  // gray italic — story/cutscene encounter
                                'narrative';   // default white — dialogue etc.

    // Stat check result prefix — always shown as a system line
    if (resolved.statCheckResult) {
      const { stat, threshold, passed } = resolved.statCheckResult;
      const statLabel = stat.split('.').pop() ?? stat;
      pushLine(
        passed
          ? `[判定成功 — ${statLabel} ≥ ${threshold}]`
          : `[判定失敗 — ${statLabel} < ${threshold}]`,
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
      activeEncounterUI.set({
        encounterId:     resolved.node.id,
        encounterName:   effectiveDef.name,
        type:            effectiveDef.type ?? 'event',
        nodeText:        '',
        choices:         [],
        statCheckResult: resolved.statCheckResult,
      });
      // Stream narration
      let ctx = this.buildEncounterContext(effectiveDef, resolved);
      if (isDebug) {
        ctx = `[DEBUG MODE — 此遭遇由開發人員手動觸發，玩家實際位置可能與遭遇預期地點不符。請直接根據以下 Context 描述遭遇情況，無需顧慮地點一致性，以模擬測試為目的即可。]\n\n` + ctx;
      }
      nodeText = '';
      isStreaming.set(true);
      pushLine('', lineType, true);
      try {
        for await (const chunk of this.dm.narrateEncounterNode(ctx, gs.history)) {
          nodeText += chunk;
          appendToLastLine(chunk);
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
      activeEncounterUI.set({
        encounterId:     resolved.node.id,
        encounterName:   effectiveDef.name,
        type:            effectiveDef.type ?? 'event',
        nodeText,
        choices:         resolved.visibleChoices,
        statCheckResult: resolved.statCheckResult,
      });
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
  }

  /**
   * Streams a DM closing narration when an encounter ends without an explicit outcome node.
   * Called when selectChoice() returns null (nextNodeId === null or __continue__).
   */
  private async streamEncounterClose(
    def: EncounterDefinition,
    collectedNarrative: string,
  ): Promise<void> {
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
      def.type === 'event'     ? 'event'     :
      def.type === 'narrative' ? 'scene'     :
                                 'narrative';

    isStreaming.set(true);
    pushLine('', closeLineType, true);
    try {
      for await (const chunk of this.dm.narrateEncounterClose(closeCtx, gs.history)) {
        appendToLastLine(chunk);
      }
    } catch (err) {
      log.error('Encounter close narration failed', err);
    } finally {
      isStreaming.set(false);
      finishLastLine();
    }
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
      const { stat, threshold, passed } = resolved.statCheckResult;
      const statLabel = stat.split('.').pop() ?? stat;
      parts.push('## 數值判定');
      parts.push(passed
        ? `${statLabel} 判定通過（目標值 ${threshold}）— 請描述成功的情境`
        : `${statLabel} 判定失敗（目標值 ${threshold}）— 請描述失敗的情境`,
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

  private async refreshThoughts(dmSuggestions: string[] = []): Promise<void> {
    const gs = this.state.getState();
    let base: Thought[];
    if (dmSuggestions.length > 0) {
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

  private buildBaseThoughts(gs: Readonly<GameState>): Thought[] {
    const result: Thought[] = [];
    let   n = 0;
    const id = (prefix: string) => prefix + '_' + (n++);

    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);

    result.push({ id: id('examine'), text: 'Observe surroundings', actionType: 'examine' });

    if (resolved) {
      const exits = resolved.connections
        .filter(c => this.lore.canAccessConnection(
          c, this.state.flags, gs.timePeriod, gs.player.knownIntelIds, Object.values(gs.activeQuests), gs.time, gs.player.inventory, gs.player.melphin,
        ))
        .slice(0, 3);
      for (const exit of exits) {
        result.push({ id: id('move'), text: 'Go to ' + exit.description, actionType: 'move' });
      }

      const npcs = this.lore.getNPCsByIds(resolved.npcIds, this.state.flags, gs.timePeriod).slice(0, 2);
      for (const npc of npcs) {
        result.push({ id: id('talk'), text: 'Talk to ' + npc.name, actionType: 'interact' });
      }
    }

    const staminaLow  = gs.player.statusStats.stamina < gs.player.statusStats.staminaMax * 0.4;
    const stressHigh  = gs.player.statusStats.stress  > gs.player.statusStats.stressMax  * 0.75;
    if (staminaLow || stressHigh) {
      result.push({ id: id('rest'), text: 'Find somewhere to rest', actionType: 'rest' });
    }

    return result;
  }

  // -- UI sync ----------------------------------------------------------

  private syncUIState(gs: Readonly<GameState>): void {
    const resolved         = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    const region           = this.lore.getRegion(this.currentRegionId);
    const activeQuestCount = Object.values(gs.activeQuests).filter(
      q => !q.isCompleted && !q.isFailed
    ).length;

    // Top 2 factions by absolute reputation (non-zero only)
    const topFactions = Object.entries(gs.player.externalStats.reputation)
      .filter(([, v]) => v !== 0)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
      .slice(0, 2)
      .map(([fid, rep]) => {
        const f = this.lore.getFaction(fid);
        return { id: fid, name: f?.name ?? fid, rep };
      });

    const allActiveQuestSummaries = Object.values(gs.activeQuests)
      .filter(q => !q.isCompleted && !q.isFailed && q.currentStageId)
      .flatMap(q => {
        const def   = this.lore.getQuest(q.questId);
        const stage = def?.stages[q.currentStageId!];
        if (!def || !stage) return [];
        return [{
          questId:      q.questId,
          name:         def.name,
          type:         def.type,
          stageSummary: stage.description,
          objectives:   stage.objectives.map(o => ({
            id:          o.id,
            description: o.description,
            completed:   q.completedObjectiveIds.includes(o.id),
          })),
        }];
      });
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

      miniMap = {
        areaId,
        areaName:     areaNode.name,
        districtId:   areaNode.districtId ?? '',
        districtName: districtNode?.name  ?? '',
        nodes: allAreaNodes.map(node => ({
          id:           node.id,
          label:        node.base.name ?? node.name,
          isCurrent:    node.id === currentLocId,
          // Area node: visible whenever player is inside it
          // Sublocation: visible only if player has been there
          isDiscovered: node.id === areaId
            ? true
            : gs.discoveredLocationIds.includes(node.id) || node.id === currentLocId,
          connections:  node.base.connections
            .map(c => c.targetLocationId)
            .filter(tid => areaNodeIds.has(tid)),
          isArea:       node.id === areaId,
        })),
      };
    }

    // Build region map data (all districts in region, BFS-ready)
    let regionMap: RegionMapData | undefined;
    if (region) {
      const currentDistrictId = areaNode?.districtId ?? '';
      const adjacency         = this.lore.getDistrictAdjacency(this.currentRegionId);
      const districtIds       = region.districtIds ?? [];

      regionMap = {
        regionId:          this.currentRegionId,
        regionName:        region.name,
        currentDistrictId,
        districts: districtIds.map(did => {
          const district  = this.lore.getDistrict(did);
          const isCurrent = did === currentDistrictId;
          const areas = isCurrent && district
            ? district.locationIds.flatMap(lid => {
                const loc = this.lore.getLocation(lid);
                return loc ? [{
                  id:           loc.id,
                  name:         loc.name,
                  isDiscovered: discoveredAreas.has(lid),
                  isCurrent:    lid === areaId,
                }] : [];
              })
            : undefined;
          return {
            id:          did,
            label:       district?.name ?? did,
            isCurrent,
            adjacentIds: adjacency.get(did) ?? [],
            areas,
          };
        }),
      };
    }

    const visibleConditions = gs.player.conditions
      .filter(c => !(this.lore.getCondition(c.id)?.isHidden ?? c.isHidden))
      .map(c => ({ label: this.lore.getCondition(c.id)?.label ?? c.label ?? c.id }));

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
      titles:          gs.player.titles.length > 0 ? gs.player.titles.slice(0, 2) : undefined,
      activeQuestSummaries:    activeQuestSummaries.length > 0 ? activeQuestSummaries : undefined,
      allActiveQuestSummaries: allActiveQuestSummaries.length > 0 ? allActiveQuestSummaries : undefined,
      totalActiveQuestCount:   allActiveQuestSummaries.length > 0 ? allActiveQuestSummaries.length : undefined,
      conditions:      visibleConditions,
      melphin:         gs.player.melphin,
      miniMap,
      regionMap,
    });

    detailedPlayer.set({
      primaryStats:   { ...gs.player.primaryStats },
      secondaryStats: { ...gs.player.secondaryStats },
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
        return {
          instanceId:   inv.instanceId,
          itemId:       inv.itemId,
          name:         node?.name ?? inv.itemId,
          description:  variant?.description ?? node?.description ?? '',
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
    npcId:      string,
    dialogueId: string,
    npcName:    string,
    nodeId:     string,
    node:       import('../types/dialogue').ScriptedNode,
  ): Promise<void> {
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
    });

    if (filteredChoices.length === 0) {
      setTimeout(() => {
        this.endScriptedDialogue().catch(err => log.warn('endScriptedDialogue error', err));
      }, 600);
    }
  }

  private async endScriptedDialogue(): Promise<void> {
    const current = get(activeScriptedDialogue);
    if (!current) return;

    const { npcId, npcName } = current;

    // Increment NPC interaction count first — this creates npcMemory entry if first contact.
    this.state.recordNPCInteraction(npcId);

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

    // Scripted segment done — NPC continues conversation via LLM opener.
    // (Next player input will re-check for scripted triggers naturally via handleDialogueInput.)
    const npc = this.lore.getNPC(npcId);
    if (npc && get(activeNpcUI)) {
      await this.handleDialogueInput('(opener)', npcId, true);
      return;
    }

    this.syncUIState(this.state.getState());
    await this.refreshThoughts();
    this.autoSave().catch(err => log.warn('Auto-save after scripted dialogue failed', err));
  }

  private updateActiveNpcUI(npcId: string): void {
    const npc = this.lore.getNPC(npcId);
    if (!npc) { activeNpcUI.set(null); return; }
    // New encounter (different NPC or first time) — reset session log
    const current = get(activeNpcUI);
    if (!current || current.npcId !== npcId) {
      encounterSessionLog.set([]);
      this._sessionFiredTriggers.clear();
    }
    const gs  = this.state.getState();
    const mem = gs.npcMemory[npcId];
    activeNpcUI.set({
      npcId,
      name:             npc.name,
      type:             npc.type,
      publicDescription: npc.publicDescription,
      affinity:         gs.player.externalStats.affinity[npcId] ?? 0,
      attitude:         mem?.playerAttitude ?? 'neutral',
      interactionCount: mem?.interactionCount ?? 0,
    });
  }

  /** Auto-set met_<npcId> discovery flags for NPCs visible in the current scene and time period. */
  private discoverSceneNpcs(): void {
    const gs       = this.state.getState();
    const resolved = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    if (!resolved) return;
    const visibleNpcs = this.lore.getNPCsByIds(resolved.npcIds, this.state.flags, gs.timePeriod);
    for (const npc of visibleNpcs) {
      if (!this.state.flags.has('met_' + npc.id)) {
        this.state.flags.set('met_' + npc.id);
        log.debug('NPC discovered', { npcId: npc.id });
      }
    }
  }

  // -- Mock mode --------------------------------------------------------

  private async runMockIntro(): Promise<void> {
    thoughts.set([
      { id: 'look',  text: 'Observe surroundings', actionType: 'examine'  },
      { id: 'move',  text: 'Look for an exit',      actionType: 'move'     },
      { id: 'talk',  text: 'Try talking to someone', actionType: 'interact' },
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

  /** Returns all lore catalog entries for the debug launcher panel. */
  getDebugCatalog() {
    return this.lore.getDebugCatalog();
  }

  /** Directly start a structured encounter by ID, bypassing event flow. */
  async debugTriggerEncounter(encounterId: string): Promise<void> {
    const resolved = this.encounterMgr.start(encounterId);
    if (!resolved) {
      pushLine(`[Debug] 找不到遭遇：${encounterId}`, 'system');
      return;
    }
    pushLine(`[Debug] 觸發遭遇：${encounterId}`, 'system');
    await this.renderEncounterNode(resolved, undefined, true);
  }

  /** Open the NPC dialogue panel for npcId and immediately fire any matching scripted trigger. */
  async debugStartNpcDialogue(npcId: string): Promise<void> {
    const npc = this.lore.getNPC(npcId);
    if (!npc) {
      pushLine(`[Debug] 找不到 NPC：${npcId}`, 'system');
      return;
    }
    activeNpcUI.set(null);
    encounterSessionLog.set([]);
    this._sessionFiredTriggers.clear();
    this.updateActiveNpcUI(npcId);

    // Fire scripted trigger immediately (same logic as interact action flow)
    const interactionCount = this.state.getState().npcMemory[npcId]?.interactionCount ?? 0;
    const scripted = this.dialogueMgr.checkScriptedTrigger(
      npcId, npc.dialogueId, this.state.flags, interactionCount,
      this._sessionFiredTriggers,
    );
    if (scripted) {
      this._sessionFiredTriggers.add(scripted.nodeId);
      await this.activateScriptedNode(npcId, npc.dialogueId, npc.name, scripted.nodeId, scripted.node);
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
    const { eventEncounter: debugEncounter, extraTriggered: debugExtra } =
      this.processTriggeredEvents([triggered]);
    const allDebugTriggered = [triggered, ...debugExtra];

    // Narrate the event (and any sub-events) first so event text appears before encounter UI.
    const debugPrefix = `[DEBUG MODE — 此事件由開發人員手動強制觸發，玩家實際位置可能與事件預期地點不符。請直接根據提供的事件 Context 描述情況，模擬此事件的發生，無需顧慮地點一致性。]\n\n`;
    const eventCtx = debugPrefix + this.buildSceneCtx(allDebugTriggered);
    await this.runEventDM(eventCtx, allDebugTriggered.some(t => t.event.notification) ? 'event' : 'narrative');

    // Launch encounter after narration completes (includes encounters from sub-event chains).
    if (debugEncounter) {
      const encDef  = this.lore.getEncounter(debugEncounter.id);
      const resolved = this.encounterMgr.start(debugEncounter.id);
      if (resolved) await this.renderEncounterNode(resolved, encDef ?? undefined, true);
    }
    this.syncUIState(this.state.getState());
  }

  /** Grant a quest directly, regardless of conditions. */
  debugGrantQuest(questId: string): void {
    const ok = this.acceptQuest(questId);
    pushLine(ok
      ? `[Debug] 已授予任務：${questId}`
      : `[Debug] 任務授予失敗（已存在或 ID 錯誤）：${questId}`,
      'system',
    );
    if (ok) this.syncUIState(this.state.getState());
  }

  /** Set a flag and sync UI. */
  debugSetFlag(flag: string): void {
    this.state.flags.set(flag);
    pushLine(`[Debug] 旗標設置：${flag}`, 'system');
    this.syncUIState(this.state.getState());
  }

  /** Unset a flag and sync UI. */
  debugUnsetFlag(flag: string): void {
    this.state.flags.unset(flag);
    pushLine(`[Debug] 旗標清除：${flag}`, 'system');
    this.syncUIState(this.state.getState());
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
    this._sessionFiredTriggers.clear();
    this.discoverSceneNpcs();
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
    this._sessionFiredTriggers.clear();
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
      const npc = this.lore.getNPC(npcId);
      if (!npc) {
        pushLine(`[Debug] 找不到 NPC：${npcId}`, 'system');
        return;
      }
      const ctx = this.dialogueMgr.buildNPCDialogueContext(npcId, npc.dialogueId, this.state.flags);
      pushLine(`[Debug] 對話 context — ${npcId}:\n\n${ctx || '（空）'}`, 'system');
    } else {
      // Scene context (what the exploration DM receives)
      const ctx = this.buildSceneCtx([]);
      pushLine(`[Debug] 場景 context:\n\n${ctx}`, 'system');
    }
  }

  /**
   * Set a player stat to an exact value by dot-path (e.g. "statusStats.stamina").
   * Clamps at 0. Syncs UI immediately.
   */
  debugSetStat(dotPath: string, value: number): void {
    const gs = this.state.getState();
    const [group, stat] = dotPath.split('.');
    const statsGroup = (gs.player as unknown as Record<string, Record<string, number>>)[group];
    if (!statsGroup || !(stat in statsGroup)) return;
    const delta = value - statsGroup[stat];
    this.state.modifyStat(dotPath, delta);
    this.syncUIState(this.state.getState());
    this.checkEndingConditions();
  }

  /**
   * Jump game time forward to a specific date + time (always advances, never goes back).
   * Max date: 1504-12-31. Resolves the new time period from the region schedule and syncs UI.
   */
  debugSetTime(year: number, month: number, day: number, hour: number, minute: number): void {
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

    const newTime   = this.timeMgr.advance(cur, delta);
    const schedule  = this.lore.getSchedule(this.currentRegionId) ?? null;
    const newPeriod = schedule
      ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs.player.activeFlags)
      : gs.timePeriod;
    this.state.advanceTime(newTime, newPeriod);
    this.syncUIState(this.state.getState());
  }

  /** Set melphin (currency) to an exact value. */
  debugSetMelphin(value: number): void {
    const gs = this.state.getState();
    this.state.modifyMelphin(value - gs.player.melphin);
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
        secondaryStats:  { consciousness: 2, mysticism: 0, technology: 3 },
        statusStats:     { stamina: 10, staminaMax: 10, stress: 2, stressMax: 10, endo: 0, endoMax: 0, experience: 0 },
        externalStats:   { reputation: {}, affinity: {}, familiarity: {} },
        inventory:       [],
        melphin:         25,
        activeFlags:     new Set(),
        titles:          [],
        conditions:      [],
        knownIntelIds:   [],
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
      eventCooldowns: {},
      eventCounters:  {},
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
