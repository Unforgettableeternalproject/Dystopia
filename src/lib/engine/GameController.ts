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
import type { PlayerAction, GameState, StarterConfig } from '../types';
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
import { activeNpcUI, detailedPlayer, activeScriptedDialogue, isSaving } from '../stores/gameStore';
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
  private dialogueMgr: DialogueManager;
  private mockMode:    boolean;

  /** ID of the region the player is currently in. Updated on region change. */
  private currentRegionId = 'crambell';

  private starterConfig: StarterConfig | null = null;

  constructor(config?: { dm?: ILLMClient; regulator?: ILLMClient }) {
    const auto = autoClients();
    this.mockMode = !config?.dm && !config?.regulator && !auto;
    // In mock mode dm/regulator are never called -- null! casts are safe.
    const dmClient        = config?.dm        ?? auto?.dm        ?? null!;
    const regulatorClient = config?.regulator ?? auto?.regulator ?? null!;
    this.dmClient  = dmClient  ?? null;
    this.dm        = new DMAgent(dmClient);
    this.regulator = new Regulator(regulatorClient);
    this.lore      = new LoreVault();
    this.bus       = new EventBus();
    this.timeMgr   = new TimeManager();

    const initialState = this.buildInitialState();
    this.state  = new StateManager(initialState, this.bus);
    this.events      = new EventEngine(this.lore, this.state, this.timeMgr);
    this.phases      = new PhaseManager(this.lore, this.state);
    this.quests      = new QuestEngine(this.lore, this.state);
    this.dialogueMgr = new DialogueManager(this.lore, this.state);

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
    s.player.inventory     = [...config.player.inventory];
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

  async submitAction(input: string): Promise<void> {
    if (!input.trim()) return;

    const action: PlayerAction = { type: 'free', input: input.trim() };
    inputDisabled.set(true);
    pushLine('> ' + input, 'player');

    if (this.mockMode) {
      await this.runMockResponse(input);
      inputDisabled.set(false);
      return;
    }

    // 1. Dialogue encounter routing — bypass Regulator if in active encounter
    //    (guard: skip if scripted dialogue is currently showing choices)
    const currentEncounter = get(activeNpcUI);
    if (currentEncounter && !get(activeScriptedDialogue)) {
      await this.handleDialogueInput(input.trim(), currentEncounter.npcId);
      inputDisabled.set(false);
      return;
    }

    // 2. Regulator validation
    log.debug('Action submitted', { input });
    const result = await this.regulator.validate(action, this.state.getState().player);
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
          this.activateScriptedNode(
            finalAction.targetId, npc.dialogueId, npc.name,
            scripted.nodeId, scripted.node,
          );
          inputDisabled.set(false);
          return; // Skip normal turn pipeline — scripted dialogue takes over
        }
      }
    }

    // 2. Tick conditions
    this.state.tickConditions();

    // 2.5. Advance in-game time (default amount for event/period detection)
    const gs0            = this.state.getState();
    const schedule       = this.lore.getSchedule(this.currentRegionId) ?? null;
    const defaultMinutes = ACTION_MINUTES[finalAction.type] ?? 10;
    const newTime   = this.timeMgr.advance(gs0.time, defaultMinutes);
    const newPeriod = schedule
      ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs0.player.activeFlags)
      : gs0.timePeriod;
    const periodChanged  = this.state.advanceTime(newTime, newPeriod);
    const crossedHours   = this.timeMgr.computeCrossedHours(gs0.time, newTime);

    // 3. Check global events (period transitions, broadcasts, hour-based triggers)
    const globalTriggered = this.events.checkGlobalEvents(this.currentRegionId, crossedHours);

    // 3.5. Check location events
    const locationTriggered = this.events.checkAndApply(
      this.state.getState().player.currentLocationId, crossedHours,
    );
    const triggered = [...globalTriggered, ...locationTriggered];

    // 4. DM narration
    const sceneCtx = this.buildSceneCtx(triggered, periodChanged, finalAction);
    const { signaledMinutes, suggestions } = await this.runDM(finalAction, sceneCtx);

    // 4.5. Apply extra time if DM signaled more than default (e.g., sleeping 8 h)
    if (signaledMinutes !== null && signaledMinutes > defaultMinutes) {
      const extra       = signaledMinutes - defaultMinutes;
      const gs1         = this.state.getState();
      const laterTime   = this.timeMgr.advance(gs1.time, extra);
      const laterPeriod = schedule
        ? this.timeMgr.getCurrentPeriod(laterTime, schedule, gs1.player.activeFlags)
        : gs1.timePeriod;
      this.state.advanceTime(laterTime, laterPeriod);
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

    // Auto-save on day change
    if (this.state.getState().time.day !== gs0.time.day) {
      this.autoSave().catch(err => log.warn('Auto-save (day change) failed', err));
    }

    inputDisabled.set(false);
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

    // Show the player's choice in the narrative
    pushLine('> ' + choice.text, 'player');

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
      this.endScriptedDialogue();
      return;
    }

    const nextNode = this.dialogueMgr.getNode(current.npcId, current.dialogueId, targetNodeId);
    if (!nextNode) {
      activeScriptedDialogue.set({ ...current, collectedNarrative: updatedNarrative });
      this.endScriptedDialogue();
      return;
    }

    const ctx = this.buildInterpolationCtx();
    const filteredChoices = this.dialogueMgr.filterChoices(nextNode.choices, this.state.flags);

    // transitionLines: show these instead of target node's lines (return/back pattern)
    let addedNarrative: string;
    if (choice.transitionLines && choice.transitionLines.length > 0) {
      const transLines = this.renderNodeLines(choice.transitionLines, current.npcName, ctx);
      for (let i = 0; i < transLines.length; i++) {
        const line = choice.transitionLines[i];
        pushLine(transLines[i], line.speaker === 'player' ? 'player' : line.speaker === 'npc' ? 'dialogue' : 'narrative');
      }
      addedNarrative = transLines.join('\n');
    } else {
      const nextLines = this.renderNodeLines(nextNode.lines, current.npcName, ctx);
      for (let i = 0; i < nextLines.length; i++) {
        const line = nextNode.lines[i];
        pushLine(nextLines[i], line.speaker === 'player' ? 'player' : line.speaker === 'npc' ? 'dialogue' : 'narrative');
      }
      addedNarrative = nextLines.join('\n');
    }

    activeScriptedDialogue.set({
      ...current,
      currentNodeId:      targetNodeId,
      currentChoices:     filteredChoices,
      collectedNarrative: updatedNarrative + '\n' + addedNarrative,
    });

    // Auto-end if the node has no choices
    if (filteredChoices.length === 0) {
      setTimeout(() => this.endScriptedDialogue(), 600);
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
    this.events      = new EventEngine(this.lore, this.state, this.timeMgr, schedule);
    this.phases      = new PhaseManager(this.lore, this.state);
    this.quests      = new QuestEngine(this.lore, this.state);
    this.dialogueMgr = new DialogueManager(this.lore, this.state);
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
        { timePeriod: gs.timePeriod, knownIntelIds: gs.player.knownIntelIds },
      )
    );

    const visibleConditions = gs.player.conditions
      .filter(c => !c.isHidden)
      .map(c => c.label)
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

  // -- DM narration -----------------------------------------------------

  private async runDM(
    action: PlayerAction,
    sceneCtx: string,
  ): Promise<{ signaledMinutes: number | null; suggestions: string[] }> {
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

    // 2. Parse and apply DM dialogue signals (<<NPC: ...>> and <<MILESTONE: ...>>)
    const dialogueSignals = this.dialogueMgr.parseSignals(afterFlags);
    const resolvedScene   = this.lore.resolveLocation(
      this.state.getState().player.currentLocationId,
      this.state.flags,
    );
    const sceneNpcIds = resolvedScene?.npcIds ?? [];
    if (dialogueSignals.npcUpdates.length > 0 || dialogueSignals.milestones.length > 0) {
      log.debug('DM dialogue signals', {
        npcUpdates: dialogueSignals.npcUpdates,
        milestones: dialogueSignals.milestones,
      });
      this.dialogueMgr.applySignals(dialogueSignals, sceneNpcIds);
    }

    // Apply DM quest signals (flag or objective completion)
    for (const qs of dialogueSignals.questSignals) {
      this.quests.applyQuestSignal(qs.questId, qs.type, qs.value);
    }

    // Apply DM move signal (player relocated to adjacent location)
    if (dialogueSignals.moveSignal) {
      const newLocId = dialogueSignals.moveSignal;
      if (this.lore.resolveLocation(newLocId, this.state.flags)) {
        this.state.movePlayer(newLocId);
        log.info('Player moved', { to: newLocId });
      } else {
        log.warn('DM MOVE signal references unknown location', { locationId: newLocId });
      }
    }

    const cleanNarrative = dialogueSignals.cleanNarrative;

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

    return { signaledMinutes, suggestions };
  }

  // -- Dialogue encounter -----------------------------------------------

  /**
   * Handle player input while in a dialogue encounter with npcId.
   * Bypasses Regulator; routes straight to DM in dialogue mode.
   */
  private async handleDialogueInput(text: string, npcId: string): Promise<void> {
    const npc = this.lore.getNPC(npcId);
    if (!npc) {
      // NPC gone — exit encounter silently
      activeNpcUI.set(null);
      encounterSessionLog.set([]);
      return;
    }

    // Check for scripted trigger before LLM dialogue (special nodes can fire mid-encounter)
    const interactionCount = this.state.getState().npcMemory[npcId]?.interactionCount ?? 0;
    const scripted = this.dialogueMgr.checkScriptedTrigger(
      npcId, npc.dialogueId, this.state.flags, interactionCount,
    );
    if (scripted) {
      this.activateScriptedNode(npcId, npc.dialogueId, npc.name, scripted.nodeId, scripted.node);
      return;
    }

    const npcContext = this.dialogueMgr.buildNPCDialogueContext(npcId, npc.dialogueId, this.state.flags);
    // Snapshot log BEFORE appending current player turn (playerInput is passed separately to DM)
    const sessionLog = get(encounterSessionLog) as DialogueLogEntry[];

    // Stream DM dialogue response
    isStreaming.set(true);
    pushLine('', 'narrative');

    let fullText    = '';
    let signalCutoff = -1;
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
      log.error('Dialogue DM narration failed', err);
      appendToLastLine('\n[narration error -- please retry]');
    } finally {
      isStreaming.set(false);
    }

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
    this.dialogueMgr.applySignals(dialogueSignals, [npcId]);
    for (const qs of dialogueSignals.questSignals) {
      this.quests.applyQuestSignal(qs.questId, qs.type, qs.value);
    }

    const cleanNarrative = dialogueSignals.cleanNarrative;

    // Patch displayed line
    if (cleanNarrative !== fullText) {
      narrativeLines.update(lines => {
        if (lines.length === 0) return lines;
        const last = lines[lines.length - 1];
        return [...lines.slice(0, -1), { ...last, text: cleanNarrative, isStreaming: false }];
      });
    } else {
      finishLastLine();
    }

    // Append this turn (player + NPC) to session log
    appendEncounterLog('player', text);
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

    // Append to global history
    const action: PlayerAction = { type: 'interact', input: text, targetId: npcId };
    this.state.appendHistory(action, cleanNarrative.slice(0, 200));

    // Refresh NPC panel with updated affinity/attitude
    this.updateActiveNpcUI(npcId);

    // Handle natural encounter end
    if (dialogueSignals.endEncounter) {
      activeNpcUI.set(null);
      encounterSessionLog.set([]);
      log.info('Encounter ended naturally', { npcId });
    }

    // Refresh thoughts (dialogue mode suggestions or post-encounter exploration)
    await this.refreshThoughts(suggestions);
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
          c, this.state.flags, gs.timePeriod, gs.player.knownIntelIds,
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
        return stage ? [{ name: def!.name, stageSummary: stage.description }] : [];
      });
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

    const visibleConditions = gs.player.conditions.filter(c => !c.isHidden).map(c => ({ label: c.label }));

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
      conditionCount:  gs.player.conditions.filter(c => !c.isHidden).length,
      time:            this.timeMgr.formatTime(gs.time),
      timePeriod:      this.timeMgr.formatPeriod(gs.timePeriod),
      topFactions:     topFactions.length > 0 ? topFactions : undefined,
      titles:          gs.player.titles.length > 0 ? gs.player.titles.slice(0, 2) : undefined,
      activeQuestSummaries: activeQuestSummaries.length > 0 ? activeQuestSummaries : undefined,
      conditions:      visibleConditions,
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
      conditions:  gs.player.conditions.filter(c => !c.isHidden).map(c => ({ label: c.label })),
      titles:      gs.player.titles,
      inventory:   gs.player.inventory,
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

  private activateScriptedNode(
    npcId:      string,
    dialogueId: string,
    npcName:    string,
    nodeId:     string,
    node:       import('../types/dialogue').ScriptedNode,
  ): void {
    const ctx      = this.buildInterpolationCtx();
    const rendered = this.renderNodeLines(node.lines, npcName, ctx);
    for (let i = 0; i < rendered.length; i++) {
      const line = node.lines[i];
      pushLine(rendered[i], line.speaker === 'player' ? 'player' : line.speaker === 'npc' ? 'dialogue' : 'narrative');
    }

    const filteredChoices = this.dialogueMgr.filterChoices(node.choices, this.state.flags);

    activeScriptedDialogue.set({
      npcId, npcName, dialogueId,
      currentNodeId:      nodeId,
      currentChoices:     filteredChoices,
      collectedNarrative: rendered.join('\n'),
    });

    if (filteredChoices.length === 0) {
      setTimeout(() => this.endScriptedDialogue(), 600);
    }
  }

  private endScriptedDialogue(): void {
    const current = get(activeScriptedDialogue);
    if (!current) return;

    // Increment NPC interaction count
    this.state.recordNPCInteraction(current.npcId);

    // Record to history for DM context in future turns
    this.state.appendHistory(
      { type: 'interact', input: `與 ${current.npcName} 交談`, targetId: current.npcId },
      current.collectedNarrative.slice(0, 400),
    );

    activeScriptedDialogue.set(null);

    this.syncUIState(this.state.getState());
    this.refreshThoughts();
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
