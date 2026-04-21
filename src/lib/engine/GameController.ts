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

import { DMAgent, DM_SYSTEM_PROMPT } from '../ai/DMAgent';
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
import type { PlayerAction, ActionType, GameState, StarterConfig } from '../types';
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
import { activeNpcUI, detailedPlayer, activeScriptedDialogue, activeEncounterUI, isSaving, questCompletionBanner, showEventToast } from '../stores/gameStore';
import { ACTION_MINUTES } from './TimeManager';

const log = createLogger('GameCtrl');

export class GameController {
  private dm:          DMAgent;
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

  private starterConfig: StarterConfig | null = null;

  /** Track which quests were active last sync to detect newly-completed quests. */
  private _prevActiveQuestIds = new Set<string>();

  constructor(config?: { dm?: ILLMClient; regulator?: ILLMClient }) {
    const auto = autoClients();
    this.mockMode = !config?.dm && !config?.regulator && !auto;
    // In mock mode dm/regulator are never called -- null! casts are safe.
    const dmClient        = config?.dm        ?? auto?.dm        ?? null!;
    const regulatorClient = config?.regulator ?? auto?.regulator ?? null!;
    this.dmClient  = dmClient  ?? null;
    this.dm        = new DMAgent(dmClient);
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

  async submitAction(input: string, actionType?: ActionType): Promise<void> {
    if (!input.trim()) return;

    const action: PlayerAction = { type: actionType ?? 'free', input: input.trim() };
    inputDisabled.set(true);
    pushLine('> ' + input, 'player');

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
    } else if (finalAction.type === 'interact' && finalAction.targetId) {
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
        );
        if (scripted) {
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
    const schedule       = this.lore.getSchedule(this.currentRegionId) ?? null;
    const defaultMinutes = ACTION_MINUTES[finalAction.type] ?? 10;
    const newTime   = this.timeMgr.advance(gs0.time, defaultMinutes);
    const newPeriod = schedule
      ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs0.player.activeFlags)
      : gs0.timePeriod;
    const periodChanged  = this.state.advanceTime(newTime, newPeriod);
    this.state.tickItemExpiry(id => this.lore.getItem(id)?.expiresAfterMinutes);
    const crossedHours   = this.timeMgr.computeCrossedHours(gs0.time, newTime);

    // 3. Check global events (period transitions, broadcasts, hour-based triggers)
    const globalTriggered = this.events.checkGlobalEvents(this.currentRegionId, crossedHours);

    // 3.5. Check location events
    const locationTriggered = this.events.checkAndApply(
      this.state.getState().player.currentLocationId, crossedHours,
    );
    const triggered = [...globalTriggered, ...locationTriggered];

    // 3.7. Apply event-driven quest grants and encounter launches
    for (const t of triggered) {
      if (t.grantQuestId) {
        this.quests.grantQuest(t.grantQuestId);
        log.info('Quest granted by event', { questId: t.grantQuestId, eventId: t.event.id });
      }
      if (t.failQuestId) {
        this.quests.applyQuestFail(t.failQuestId);
        log.info('Quest fail applied by event', { questId: t.failQuestId, eventId: t.event.id });
      }
      if (t.startEncounterId) {
        const encDef   = this.lore.getEncounter(t.startEncounterId);
        const resolved = this.encounterMgr.start(t.startEncounterId);
        if (resolved) {
          await this.renderEncounterNode(resolved, encDef ?? undefined);
          log.info('Encounter started by event', {
            encounterId: t.startEncounterId, eventId: t.event.id,
          });
        }
      }
      if (t.event.notification) {
        showEventToast(t.event.name ?? t.event.id, t.event.notification.color);
      }
    }

    // 4. DM narration
    // For NPC interact: route to isolated dialogue DM — full scene context is not injected.
    // The dialogue DM only receives NPC profile + session history, preventing hallucination.
    if (finalAction.type === 'interact' && finalAction.targetId && get(activeNpcUI)) {
      await this.handleDialogueInput(finalAction.input, finalAction.targetId);
      this.discoverSceneNpcs();
      inputDisabled.set(false);
      return;
    }

    const sceneCtx = this.buildSceneCtx(triggered, periodChanged, finalAction);
    const navHint  = this.buildNavHint(finalAction);
    const { signaledMinutes, suggestions, encounterSignal } = await this.runDM(finalAction, sceneCtx + navHint);

    // 4.5. Apply extra time if DM signaled more than default (e.g., sleeping 8 h)
    if (signaledMinutes !== null && signaledMinutes > defaultMinutes) {
      const extra       = signaledMinutes - defaultMinutes;
      const gs1         = this.state.getState();
      const laterTime   = this.timeMgr.advance(gs1.time, extra);
      const laterPeriod = schedule
        ? this.timeMgr.getCurrentPeriod(laterTime, schedule, gs1.player.activeFlags)
        : gs1.timePeriod;
      this.state.advanceTime(laterTime, laterPeriod);
      this.state.tickItemExpiry(id => this.lore.getItem(id)?.expiresAfterMinutes);
      // Fire time-based global events for any additional hours crossed during extended sleep
      const extraCrossed = this.timeMgr.computeCrossedHours(gs1.time, laterTime);
      if (extraCrossed.length > 0) {
        this.events.checkGlobalEvents(this.currentRegionId, extraCrossed);
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
    await this.refreshThoughts(suggestions);

    // Handle DM-triggered encounter signal (after normal post-DM processing completes)
    if (encounterSignal) {
      if (encounterSignal.type === 'dialogue') {
        this.updateActiveNpcUI(encounterSignal.npcId);
        await this.handleDialogueInput('(opener)', encounterSignal.npcId, true);
        inputDisabled.set(false);
      } else if (encounterSignal.type === 'event') {
        const resolved = this.encounterMgr.start(encounterSignal.id);
        if (resolved) await this.renderEncounterNode(resolved);
        this.releaseInput();
      }
    }

    // Auto-save on day change
    if (this.state.getState().time.day !== gs0.time.day) {
      this.autoSave().catch(err => log.warn('Auto-save (day change) failed', err));
    }

    if (!encounterSignal) this.releaseInput();
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

    return { systemPrompt: DM_SYSTEM_PROMPT, sceneContext, fullUserMessage };
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

    if (triggered.length > 0) {
      const evLines = triggered.map(
        ({ event, outcome }) => '- ' + event.description + ' -> ' + outcome.description
      );
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

  private async runDM(
    action: PlayerAction,
    sceneCtx: string,
  ): Promise<{ signaledMinutes: number | null; suggestions: string[]; encounterSignal?: { type: 'dialogue'; npcId: string } | { type: 'event'; id: string } }> {
    isStreaming.set(true);
    pushLine('', 'narrative');

    let fullText = '';
    let signalCutoff = -1;  // index in fullText where first << starts; nothing after is displayed
    try {
      for await (const chunk of this.dm.narrate(sceneCtx, action, this.state.getState().history)) {
        const prevLen = fullText.length;
        fullText += chunk;
        if (signalCutoff === -1) {
          const idx = fullText.indexOf('<<');
          if (idx !== -1) {
            // Display only what came before the signal
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

    // 0. Extract TIME and THOUGHTS signals first, strip from text
    let signaledMinutes: number | null = null;
    const timeMatch = /<<TIME:\s*(\d+)>>/i.exec(fullText);
    if (timeMatch) {
      signaledMinutes = Math.max(1, parseInt(timeMatch[1], 10));
    }

    let suggestions: string[] = [];
    const thoughtsMatch = /<<THOUGHTS:\s*([^>]+?)>>/i.exec(fullText);
    if (thoughtsMatch) {
      suggestions = thoughtsMatch[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 3);
    }

    const preParsed = fullText
      .replace(/<<TIME:\s*\d+>>\s*\n?/gi, '')
      .replace(/<<THOUGHTS:[^>]+?>>\s*\n?/gi, '')
      .trimEnd();

    // 1. Parse and apply DM flag signals
    const proxCtx = this.buildProximityContext(this.state.getState());
    const { signals, cleanNarrative: afterFlags } = this.lore.flagRegistry.parseSignals(preParsed);
    const validSignals = this.lore.flagRegistry.validateSignals(signals, proxCtx);

    if (validSignals.length > 0) {
      log.debug('DM flag signals', { signals: validSignals });
      for (const sig of validSignals) {
        if (sig.action === 'set')   this.state.flags.set(sig.flagId);
        if (sig.action === 'unset') this.state.flags.unset(sig.flagId);
      }
    }

    // 2. Parse MOVE and ENCOUNTER signals from the DM output
    type EncounterSignal = { type: 'dialogue'; npcId: string } | { type: 'event'; id: string };
    let moveTarget: string | undefined;
    let encounterSignal: EncounterSignal | undefined;

    const moveMatch = /<<MOVE:\s*([^>>]+)>>/i.exec(afterFlags);
    if (moveMatch) moveTarget = moveMatch[1].trim();

    const encounterMatch = /<<ENCOUNTER:\s*([^>>]+)>>/i.exec(afterFlags);
    if (encounterMatch) {
      const parts = encounterMatch[1].split('|').map((s: string) => s.trim());
      const encType = parts[0]?.toLowerCase();
      if (encType === 'dialogue') {
        const npcPart = parts.find((p: string) => /^npc:/i.test(p));
        if (npcPart) encounterSignal = { type: 'dialogue', npcId: npcPart.replace(/^npc:\s*/i, '') };
      } else if (encType === 'event') {
        const idPart = parts.find((p: string) => /^id:/i.test(p));
        if (idPart) encounterSignal = { type: 'event', id: idPart.replace(/^id:\s*/i, '') };
      }
    }

    const cleanNarrative = afterFlags
      .replace(/<<MOVE:\s*[^>>]+>>/gi, '')
      .replace(/<<ENCOUNTER:\s*[^>>]+>>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();

    // Apply MOVE signal — validate via findPath so multi-hop navigation is supported.
    if (moveTarget) {
      const gs = this.state.getState();
      const discovered = new Set(gs.discoveredLocationIds);
      // Always include current location as traversable even if not yet in discovered list.
      discovered.add(gs.player.currentLocationId);

      const pathResult = this.lore.findPath(
        gs.player.currentLocationId,
        moveTarget,
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

      if (pathResult) {
        this.state.movePlayer(moveTarget);
        // For multi-hop paths, override TIME with the computed path cost so in-game
        // time accurately reflects the full journey (DM may only estimate one hop).
        if (pathResult.path.length > 2) {
          signaledMinutes = pathResult.totalTime;
        }
        log.info('Player moved', { to: moveTarget, hops: pathResult.path.length - 1, time: pathResult.totalTime, bypass: pathResult.usedBypass });
      } else if (!this.lore.resolveLocation(moveTarget, this.state.flags)) {
        log.warn('DM MOVE signal references unknown location', { locationId: moveTarget });
      } else {
        log.warn('DM MOVE signal: no accessible path found', { from: gs.player.currentLocationId, to: moveTarget });
      }
    }

    // 3. Patch displayed narrative line if any signals were stripped
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

    return { signaledMinutes, suggestions, encounterSignal };
  }

  // -- Dialogue encounter -----------------------------------------------

  /**
   * Handle player input while in a dialogue encounter with npcId.
   * Bypasses Regulator; routes straight to DM in dialogue mode.
   */
  /**
   * @param opener  true = NPC opens conversation (post-scripted or encounter start), skip scripted
   *                trigger re-check and don't log a player line.
   */
  private async handleDialogueInput(text: string, npcId: string, opener = false): Promise<void> {
    const npc = this.lore.getNPC(npcId);
    if (!npc) {
      // NPC gone — exit encounter silently
      activeNpcUI.set(null);
      encounterSessionLog.set([]);
      return;
    }

    // Check for scripted trigger before LLM dialogue (skip in opener mode — already checked)
    if (!opener) {
      const interactionCount = this.state.getState().npcMemory[npcId]?.interactionCount ?? 0;
      const scripted = this.dialogueMgr.checkScriptedTrigger(
        npcId, npc.dialogueId, this.state.flags, interactionCount,
      );
      if (scripted) {
        await this.activateScriptedNode(npcId, npc.dialogueId, npc.name, scripted.nodeId, scripted.node);
        return;
      }
    }

    const npcContext = this.dialogueMgr.buildNPCDialogueContext(npcId, npc.dialogueId, this.state.flags);
    // Snapshot log BEFORE appending current player turn (playerInput is passed separately to DM)
    const sessionLog = get(encounterSessionLog) as DialogueLogEntry[];

    // Stream DM dialogue response — start line with NPC name prefix (DM formats 「」 itself)
    isStreaming.set(true);
    pushLine(npc.name + '：', 'dialogue', true);

    let fullText    = '';
    let signalCutoff = -1;
    let streamError  = false;
    try {
      for await (const chunk of this.dm.narrateDialogue(npcContext, sessionLog, text)) {
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

    // Extract TIME and THOUGHTS before signal parsing
    let signaledMinutes: number | null = null;
    const timeMatch = /<<TIME:\s*(\d+)>>/i.exec(fullText);
    if (timeMatch) signaledMinutes = Math.max(1, parseInt(timeMatch[1], 10));

    let suggestions: string[] = [];
    const thoughtsMatch = /<<THOUGHTS:\s*([^>]+?)>>/i.exec(fullText);
    if (thoughtsMatch) {
      suggestions = thoughtsMatch[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 3);
    }

    const preParsed = fullText
      .replace(/<<TIME:\s*\d+>>\s*\n?/gi, '')
      .replace(/<<THOUGHTS:[^>]+?>>\s*\n?/gi, '')
      .trimEnd();

    // Parse flag signals
    const proxCtx = this.buildProximityContext(this.state.getState());
    const { signals, cleanNarrative: afterFlags } = this.lore.flagRegistry.parseSignals(preParsed);
    const validSignals = this.lore.flagRegistry.validateSignals(signals, proxCtx);
    for (const sig of validSignals) {
      if (sig.action === 'set')   this.state.flags.set(sig.flagId);
      if (sig.action === 'unset') this.state.flags.unset(sig.flagId);
    }

    // Parse dialogue signals (NPC attitude, milestones, quests, END_ENCOUNTER)
    const dialogueSignals = this.dialogueMgr.parseSignals(afterFlags);
    this.dialogueMgr.applySignals(dialogueSignals, npcId);
    for (const qs of dialogueSignals.questSignals) {
      this.quests.applyQuestSignal(qs.questId, qs.type, qs.value);
    }

    const cleanNarrative = dialogueSignals.cleanNarrative;

    // Always patch displayed line with NPC name prefix, finalize as dialogue type
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

    // Append this turn to session log (skip player entry in opener mode)
    if (!opener) appendEncounterLog('player', text);
    appendEncounterLog('npc', cleanNarrative);

    // Advance time
    if (signaledMinutes) {
      const gs       = this.state.getState();
      const schedule = this.lore.getSchedule(this.currentRegionId) ?? null;
      const newTime  = this.timeMgr.advance(gs.time, signaledMinutes);
      const newPeriod = schedule
        ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs.player.activeFlags)
        : gs.timePeriod;
      this.state.advanceTime(newTime, newPeriod);
    }

    // Handle natural encounter end — must happen BEFORE updateActiveNpcUI to prevent
    // interaction count increment from triggering a scripted dialogue restart.
    // Append ONE compact summary entry for the entire encounter (not per-turn).
    if (dialogueSignals.endEncounter) {
      activeNpcUI.set(null);
      encounterSessionLog.set([]);
      this.state.appendHistory(
        { type: 'interact', input: `（與 ${npc.name} 交談）`, targetId: npcId },
        cleanNarrative.slice(0, 200),
      );
      log.info('Encounter ended naturally', { npcId });
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
    if (pending.questFail) {
      this.quests.applyQuestFail(pending.questFail);
      log.info('Quest fail applied by encounter choice', { questId: pending.questFail });
    }

    if (resolved) {
      // Render node via DM (passing def explicitly so it works even after endEncounter clears state)
      await this.renderEncounterNode(resolved, preDef ?? undefined);

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
      activeEncounterUI.set(null);
      this.syncUIState(this.state.getState());
      await this.refreshThoughts();
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
  ): Promise<void> {
    const gs = this.state.getState();
    // Use the explicitly-passed def when available (e.g., after endEncounter clears state).
    const effectiveDef = def ?? this.lore.getEncounter(gs.activeEncounter?.encounterId ?? '');

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
      pushLine(nodeText, 'narrative');
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
      const ctx = this.buildEncounterContext(effectiveDef, resolved);
      nodeText = '';
      isStreaming.set(true);
      pushLine('', 'narrative');
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
      pushLine(nodeText, 'narrative');
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

    isStreaming.set(true);
    pushLine('', 'narrative');
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

    const activeQuestSummaries = Object.values(gs.activeQuests)
      .filter(q => !q.isCompleted && !q.isFailed && q.currentStageId)
      .slice(0, 3)
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
    log.debug('syncUIState quests', { count: activeQuestSummaries.length, summaries: activeQuestSummaries });

    // Detect newly completed quests and trigger banner notification
    const currentActiveIds = new Set(
      Object.values(gs.activeQuests)
        .filter(q => !q.isCompleted && !q.isFailed)
        .map(q => q.questId)
    );
    for (const prevId of this._prevActiveQuestIds) {
      if (!currentActiveIds.has(prevId)) {
        const inst = gs.activeQuests[prevId];
        if (inst?.isCompleted) {
          const def = this.lore.getQuest(prevId);
          if (def) questCompletionBanner.set(def.name);
        }
      }
    }
    this._prevActiveQuestIds = currentActiveIds;

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
          label:        node.name,
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

    playerUI.set({
      name:            gs.player.name,
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
      activeQuestSummaries: activeQuestSummaries.length > 0 ? activeQuestSummaries : undefined,
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

    // Increment NPC interaction count
    this.state.recordNPCInteraction(npcId);

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
    await this.renderEncounterNode(resolved);
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
    this.updateActiveNpcUI(npcId);

    // Fire scripted trigger immediately (same logic as interact action flow)
    const interactionCount = this.state.getState().npcMemory[npcId]?.interactionCount ?? 0;
    const scripted = this.dialogueMgr.checkScriptedTrigger(
      npcId, npc.dialogueId, this.state.flags, interactionCount,
    );
    if (scripted) {
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
    if (triggered.event.notification) {
      showEventToast(triggered.event.name ?? triggered.event.id, triggered.event.notification.color);
    }

    // Apply side effects (same as normal event flow)
    if (triggered.grantQuestId) this.quests.grantQuest(triggered.grantQuestId);
    if (triggered.failQuestId)  this.quests.applyQuestFail(triggered.failQuestId);
    if (triggered.startEncounterId) {
      const encDef  = this.lore.getEncounter(triggered.startEncounterId);
      const resolved = this.encounterMgr.start(triggered.startEncounterId);
      if (resolved) await this.renderEncounterNode(resolved, encDef ?? undefined);
    }

    // Run DM so the event is narrated in context
    const sceneCtx = this.buildSceneCtx([triggered]);
    const { suggestions } = await this.runDM(
      { type: 'examine', input: '（環顧四周）' } as PlayerAction,
      sceneCtx,
    );
    await this.refreshThoughts(suggestions);
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
    this.discoverSceneNpcs();
    this.syncUIState(this.state.getState());
    pushLine(`[Debug] 傳送至：${loc.name}`, 'system');

    // Run DM narration for the new location — this also calls appendHistory with the new locationId,
    // ensuring subsequent DM calls see correct location context in recent history.
    const arrivalAction: PlayerAction = { type: 'move', input: `（傳送至 ${loc.name}）` };
    const sceneCtx = this.buildSceneCtx([]);
    const { suggestions } = await this.runDM(arrivalAction, sceneCtx);
    await this.refreshThoughts(suggestions);
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
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
