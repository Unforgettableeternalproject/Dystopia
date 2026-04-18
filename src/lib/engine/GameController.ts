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

import { DMAgent }        from '../ai/DMAgent';
import { Regulator }      from '../ai/Regulator';
import { autoClients }    from '../ai/LLMClientFactory';
import type { ILLMClient } from '../ai/ILLMClient';
import { LoreVault }      from '../lore/LoreVault';
import { EventBus }       from './EventBus';
import { StateManager }   from './StateManager';
import { EventEngine }    from './EventEngine';
import { PhaseManager }   from './PhaseManager';
import { QuestEngine }    from './QuestEngine';
import { TimeManager }    from './TimeManager';
import type { PlayerAction, GameState } from '../types';
import type { TriggeredEvent }          from './EventEngine';
import type { Thought }                 from '../types';
import {
  pushLine,
  appendToLastLine,
  finishLastLine,
  isStreaming,
  inputDisabled,
  thoughts,
  playerUI,
} from '../stores/gameStore';
import { createLogger } from '../utils/Logger';
import { warmUpModel }  from '../utils/ModelWarmup';

const log = createLogger('GameCtrl');

export class GameController {
  private dm:        DMAgent;
  private regulator: Regulator;
  private dmClient:  ILLMClient | null;  // kept for warmup
  private lore:      LoreVault;
  private bus:       EventBus;
  private state:     StateManager;
  private events:    EventEngine;
  private phases:    PhaseManager;
  private quests:    QuestEngine;
  private timeMgr:   TimeManager;
  private mockMode:  boolean;

  /** ID of the region the player is currently in. Updated on region change. */
  private currentRegionId = 'crambell';

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
    this.events = new EventEngine(this.lore, this.state, this.timeMgr);
    this.phases = new PhaseManager(this.lore, this.state);
    this.quests = new QuestEngine(this.lore, this.state);
  }

  // -- Public API -------------------------------------------------------

  loadLore(data: Parameters<LoreVault['load']>[0]): void {
    this.lore.load(data);
    // Refresh schedule for current region after lore load
    this.events.setSchedule(this.lore.getSchedule(this.currentRegionId) ?? null);
  }

  async start(): Promise<void> {
    const gs = this.state.getState();
    this.state.discoverLocation(gs.player.currentLocationId);
    this.syncUIState(gs);
    log.info('Game started', { turn: gs.turn, location: gs.player.currentLocationId });

    if (this.mockMode) {
      log.warn('Running in mock mode -- no LLM client configured');
      this.runMockIntro();
      return;
    }

    // Pre-warm model in background; first DM call benefits from it
    if (this.dmClient) warmUpModel(this.dmClient).catch(() => { /* non-fatal */ });

    const sceneCtx = this.buildSceneCtx([]);
    await this.runDM({ type: 'examine', input: '(game start)' }, sceneCtx);
    await this.refreshThoughts();
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

    // 1. Regulator validation
    log.debug('Action submitted', { input });
    const result = await this.regulator.validate(action, this.state.getState().player);
    if (!result.allowed) {
      log.info('Action rejected', { input, reason: result.reason });
      pushLine(result.reason ?? 'That is not possible.', 'rejected');
      inputDisabled.set(false);
      return;
    }

    const finalAction = result.modifiedAction ?? action;

    // 2. Tick conditions
    this.state.tickConditions();

    // 2.5. Advance in-game time
    const gs0       = this.state.getState();
    const schedule  = this.lore.getSchedule(this.currentRegionId) ?? null;
    const newTime   = this.timeMgr.advanceByAction(gs0.time, finalAction.type);
    const newPeriod = schedule
      ? this.timeMgr.getCurrentPeriod(newTime, schedule, gs0.player.activeFlags)
      : gs0.timePeriod;
    const periodChanged = this.state.advanceTime(newTime, newPeriod);

    // 3. Check global events (period transitions, broadcasts, etc.)
    const globalTriggered = this.events.checkGlobalEvents(this.currentRegionId);

    // 3.5. Check location events
    const locationTriggered = this.events.checkAndApply(this.state.getState().player.currentLocationId);
    const triggered = [...globalTriggered, ...locationTriggered];

    // 4. DM narration
    const sceneCtx = this.buildSceneCtx(triggered, periodChanged);
    await this.runDM(finalAction, sceneCtx);

    // 5-7. Post-narration systems
    this.quests.checkObjectives();
    this.phases.checkAdvance();
    this.syncUIState(this.state.getState());
    await this.refreshThoughts();
    inputDisabled.set(false);
  }

  acceptQuest(questId: string): boolean {
    return this.quests.acceptQuest(questId);
  }

  /** Expose state for save/load. */
  getState(): Readonly<GameState> {
    return this.state.getState();
  }

  getFlags(): string[] {
    return this.state.flags.toArray();
  }

  /** Restore from a decoded SaveSnapshot. */
  loadState(gs: GameState, flags: string[]): void {
    // Rebuild StateManager with the restored state
    (this as unknown as { state: StateManager }).state = new StateManager(gs, this.bus);
    flags.forEach(f => this.state.flags.set(f));
    const schedule = this.lore.getSchedule(this.currentRegionId) ?? null;
    this.events = new EventEngine(this.lore, this.state, this.timeMgr, schedule);
    this.phases = new PhaseManager(this.lore, this.state);
    this.quests = new QuestEngine(this.lore, this.state);
    this.syncUIState(gs);
    log.info('State loaded from save', { turn: gs.turn });
  }

  // -- Context builder --------------------------------------------------

  private buildSceneCtx(triggered: TriggeredEvent[], periodChanged = false): string {
    const gs    = this.state.getState();
    const parts: string[] = [];

    parts.push(
      this.lore.buildSceneContext(
        gs.player.currentLocationId,
        this.state.flags,
        gs.npcMemory,
      )
    );

    const visibleConditions = gs.player.conditions
      .filter(c => !c.isHidden)
      .map(c => c.label)
      .join(', ');

    const timeStr   = this.timeMgr.formatTime(gs.time);
    const periodStr = this.timeMgr.formatPeriod(gs.timePeriod);
    const periodNote = periodChanged ? ' ← 時段轉換' : '';

    parts.push([
      '',
      '## Player Status',
      'Time: ' + timeStr + ' | ' + periodStr + periodNote,
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

    return parts.join('\n');
  }

  // -- DM narration -----------------------------------------------------

  private async runDM(action: PlayerAction, sceneCtx: string): Promise<void> {
    isStreaming.set(true);
    pushLine('', 'narrative');

    let fullText = '';
    try {
      for await (const chunk of this.dm.narrate(sceneCtx, action, this.state.getState().history)) {
        appendToLastLine(chunk);
        fullText += chunk;
      }
    } catch (err) {
      log.error('DM narration failed', err);
      appendToLastLine('\n[narration error -- please retry]');
    } finally {
      finishLastLine();
      isStreaming.set(false);
    }

    this.state.appendHistory(action, fullText.slice(0, 200));
    this.state.setLastNarrative(fullText);
  }

  // -- Thought generation -----------------------------------------------

  private async refreshThoughts(): Promise<void> {
    const gs    = this.state.getState();
    const base  = this.buildBaseThoughts(gs);
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
        .filter(c => !c.condition || this.state.flags.evaluate(c.condition))
        .slice(0, 3);
      for (const exit of exits) {
        result.push({ id: id('move'), text: 'Go to ' + exit.description, actionType: 'move' });
      }

      const npcs = this.lore.getNPCsByIds(resolved.npcIds, this.state.flags).slice(0, 2);
      for (const npc of npcs) {
        result.push({ id: id('talk'), text: 'Talk to ' + npc.name, actionType: 'interact' });
      }
    }

    const urgentQuest = Object.values(gs.activeQuests).find(
      q => !q.isCompleted && !q.isFailed && q.currentStageId
    );
    if (urgentQuest && urgentQuest.currentStageId) {
      const def   = this.lore.getQuest(urgentQuest.questId);
      const stage = def?.stages[urgentQuest.currentStageId];
      if (stage) {
        result.push({ id: id('quest'), text: 'Quest: ' + stage.description, actionType: 'examine' });
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
    const resolved        = this.lore.resolveLocation(gs.player.currentLocationId, this.state.flags);
    const activeQuestCount = Object.values(gs.activeQuests).filter(
      q => !q.isCompleted && !q.isFailed
    ).length;

    playerUI.set({
      name:            gs.player.name,
      location:        resolved?.name ?? gs.player.currentLocationId,
      stamina:         gs.player.statusStats.stamina,
      staminaMax:      gs.player.statusStats.staminaMax,
      stress:          gs.player.statusStats.stress,
      stressMax:       gs.player.statusStats.stressMax,
      turn:            gs.turn,
      worldPhase:      gs.worldPhase.currentPhase,
      activeQuestCount,
      conditionCount:  gs.player.conditions.filter(c => !c.isHidden).length,
      time:            this.timeMgr.formatTime(gs.time),
      timePeriod:      this.timeMgr.formatPeriod(gs.timePeriod),
    });
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
        await sleep(18);
      }
      appendToLastLine('\n');
      await sleep(120);
    }
    finishLastLine();
    isStreaming.set(false);
    playerUI.update((p) => ({ ...p, name: '???', location: '戴司 — 宿舍寢室' }));
  }

  private async runMockResponse(input: string): Promise<void> {
    isStreaming.set(true);
    pushLine('', 'narrative');
    const response = '[Mock mode] You attempt: ' + input + '.\nSet VITE_OLLAMA_MODEL or VITE_ANTHROPIC_API_KEY in .env to enable the DM.';
    for (const char of response) {
      appendToLastLine(char);
      await sleep(12);
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
        secondaryStats:  { consciousness: 2, arcane: 0, technology: 3 },
        statusStats:     { stamina: 10, staminaMax: 10, stress: 2, stressMax: 10, mana: 0, manaMax: 0, experience: 0 },
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
