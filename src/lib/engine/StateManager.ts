// StateManager — holds and mutates GameState.
// All state changes go through here for consistency and event emission.

import type { GameState, PlayerAction, Thought, NPCMemoryEntry, GameTime, FactionRelationState } from '../types';
import type { PlayerCondition } from '../types/condition';
import type { ConditionDefinition } from '../types/condition';
import type { WorldPhaseId } from '../types/phase';
import type { QuestInstance, QuestSource, QuestDitchConsequences, QuestReward } from '../types/quest';
import type { TimePeriod, CurfewConfig } from '../types/world';
import type { CurfewOverride } from '../types/game';
import type { PlayerAttitude } from '../types/dialogue';
import type { PrimaryStatKey } from '../types/player';
import { EventBus, GameEvents } from './EventBus';
import { FlagSystem } from './FlagSystem';
import {
  computeOverrideExpiry,
  getEffectiveCurfew,
  isCurfewActive,
  isOverrideActive,
  rollCurfewOverride,
  type CurfewWindow,
} from '../utils/curfew';
import {
  computeFinalSkillXP,
  resolveLevelUps,
  clampGrantExp,
  makeDateKey,
  getCharExpBonuses,
} from './ExperienceEngine';
import { JournalRecorder, statLabel, formatDelta } from './Journal';

export type AcquisitionRecord =
  | { type: 'item';         itemId: string; variantId?: string }
  | { type: 'stat';         key: string; delta: number }
  | { type: 'melphin';      delta: number }
  | { type: 'reputation';   factionId: string; delta: number }
  | { type: 'affinity';     npcId: string; delta: number }
  | { type: 'credit';       factionId: string; delta: number; newValue: number }
  | { type: 'skillExp';     statKey: PrimaryStatKey; finalAmount: number; levelUps: number }
  | { type: 'characterExp'; delta: number }
  | { type: 'intel';        intelId: string };

export class StateManager {
  private state: GameState;
  private bus: EventBus;
  readonly flags: FlagSystem;
  /** 玩家日誌記錄器（寫入 state.journal） */
  readonly journal: JournalRecorder;
  private _acquisitions: AcquisitionRecord[] = [];
  /** 由玩家主動放棄而進入 failQuest 的任務（日誌區分「放棄」與「失敗」） */
  private _abandoning = new Set<string>();

  constructor(initialState: GameState, bus: EventBus) {
    this.state = initialState;
    this.bus = bus;
    this.journal = new JournalRecorder(() => this.state);
    const activeQuestFlags = Object.values(initialState.activeQuests)
      .filter(q => !q.isCompleted && !q.isFailed && !q.isDitched)
      .map(q => q.questId + ':active');
    this.flags = new FlagSystem(bus, [
      ...Array.from(initialState.player.activeFlags),
      ...activeQuestFlags,
    ]);
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  setPlayerName(name: string): void {
    this.state.player.name = name;
    this.notifyUpdate();
  }

  // ── Movement & discovery ─────────────────────────────────────

  movePlayer(locationId: string): void {
    const prev = this.state.player.currentLocationId;
    if (!this.state.discoveredLocationIds.includes(locationId)) {
      this.journal.log('location', `首次抵達：${this.journal.locationName(locationId)}`);
    }
    this.state.player.currentLocationId = locationId;
    this.discoverLocation(locationId);
    this.bus.emit(GameEvents.LOCATION_CHANGED, { from: prev, to: locationId });
    this.notifyUpdate();
  }

  discoverLocation(locationId: string): void {
    if (!this.state.discoveredLocationIds.includes(locationId)) {
      this.state.discoveredLocationIds.push(locationId);
      this.notifyUpdate();
    }
  }

  // ── Stats ────────────────────────────────────────────────────

  /** Modify Melphin (currency). Clamps to minimum 0. */
  modifyMelphin(delta: number): void {
    const before = this.state.player.melphin;
    this.state.player.melphin = Math.max(0, before + delta);
    this.journal.stat('melphin', '梅分', this.state.player.melphin - before);
    this.notifyUpdate();
    if (delta !== 0) this._acquisitions.push({ type: 'melphin', delta });
  }

  /** Update a stat by dot-path, e.g. "primaryStats.strength" */
  modifyStat(key: string, delta: number): void {
    const [group, stat] = key.split('.');
    const stats = (this.state.player as unknown as Record<string, Record<string, number>>)[group];
    if (stats && stat in stats) {
      const maxKey = `${stat}Max`;
      const max = group === 'statusStats' && maxKey in stats ? stats[maxKey] : Infinity;
      const before = stats[stat];
      stats[stat] = Math.min(max, Math.max(0, stats[stat] + delta));
      this.journal.stat(key, statLabel(key), stats[stat] - before);
      this.notifyUpdate();
      if (delta !== 0) this._acquisitions.push({ type: 'stat', key, delta });
    }
  }

  // ── Skill Experience ─────────────────────────────────────────

  /**
   * 發放技能 XP 給指定的主要技能。
   *
   * - `event` / `encounter` 來源：無每日上限，直接套用角色經驗加成與傾向加成。
   * - `grant` 來源（DM 直接發放）：受每日上限限制，上限依角色經驗梯度決定。
   *
   * 若 XP 達到門檻，自動升級（可能連升多級），超出部分 carry over。
   */
  grantSkillExp(
    statKey: PrimaryStatKey,
    baseAmount: number,
    source: 'event' | 'encounter' | 'grant',
  ): void {
    if (baseAmount <= 0) return;

    const player  = this.state.player;
    const charExp = player.statusStats.experience;

    let finalAmount = computeFinalSkillXP(baseAmount, charExp, statKey, player.inclinationTracker);

    if (source === 'grant') {
      // Reset daily tracker if game date has changed
      const { year, month, day } = this.state.time;
      const today = makeDateKey(year, month, day);
      if (player.dailyGrantTracker.dateKey !== today) {
        player.dailyGrantTracker.dateKey    = today;
        player.dailyGrantTracker.grantedExp = {};
      }
      finalAmount = clampGrantExp(finalAmount, statKey, charExp, player.dailyGrantTracker);
      if (finalAmount <= 0) return;
      player.dailyGrantTracker.grantedExp[statKey] =
        (player.dailyGrantTracker.grantedExp[statKey] ?? 0) + finalAmount;
    }

    // Accumulate XP and increment inclination counter
    player.primaryStatsExp[statKey]      += finalAmount;
    player.inclinationTracker[statKey]   += 1;

    // Resolve level-ups (may be multiple)
    const { newLevel, newExp, levelUps } = resolveLevelUps(
      player.primaryStats[statKey],
      player.primaryStatsExp[statKey],
    );
    player.primaryStats[statKey]    = newLevel;
    player.primaryStatsExp[statKey] = newExp;

    const label = statLabel(`primaryStats.${statKey}`);
    this.journal.stat(`skillExp.${statKey}`, `${label}經驗`, finalAmount);
    if (levelUps > 0) this.journal.log('stats', `${label} 提升至 Lv ${newLevel}`);

    this.notifyUpdate();
    this._acquisitions.push({ type: 'skillExp', statKey, finalAmount, levelUps });
  }

  /**
   * 發放角色經驗（全局 experience）。
   * 角色經驗提升技能 XP 的加成梯度與每日 GRANT 上限，本身無上限。
   */
  grantCharacterExp(amount: number): void {
    if (amount <= 0) return;
    this.state.player.statusStats.experience += amount;
    this.journal.stat('characterExp', '角色經驗', amount);
    this.notifyUpdate();
    this._acquisitions.push({ type: 'characterExp', delta: amount });
  }

  // ── External stats ───────────────────────────────────────────

  /** 標記派系為已接觸（sidebar/關係圖可見）。重複呼叫安全。 */
  contactFaction(factionId: string): void {
    const cf = this.state.player.contactedFactions;
    if (!cf) {
      this.state.player.contactedFactions = [factionId];
    } else if (!cf.includes(factionId)) {
      cf.push(factionId);
    }
  }

  /**
   * Modify a faction's credit value. Clamps between negativeLimit and positiveLimit
   * if limits are provided; otherwise unclamped.
   *
   * Called by FactionTreeEngine during quest completion, ditch, and initial quest bonus.
   */
  modifyCredit(
    factionId: string,
    delta: number,
    limits?: { negativeLimit: number; positiveLimit: number },
    options?: { initial?: boolean },
  ): void {
    if (!this.state.player.externalStats.credit) {
      this.state.player.externalStats.credit = {};
    }
    const current = this.state.player.externalStats.credit[factionId] ?? 0;
    let newValue = current + delta;
    if (limits) {
      newValue = Math.max(limits.negativeLimit, Math.min(limits.positiveLimit, newValue));
    }
    this.state.player.externalStats.credit[factionId] = newValue;
    const applied = newValue - current;
    if (applied !== 0) {
      const name = this.journal.factionName(factionId);
      this.journal.log('quest', options?.initial
        ? `${name}信用：初始 ${newValue}`
        : `${name}信用 ${formatDelta(applied)}（目前 ${newValue}）`);
    }
    this.notifyUpdate();
    if (delta !== 0) this._acquisitions.push({ type: 'credit', factionId, delta, newValue });
  }

  // ── Faction Relations ─────────────────────────────────────────

  /** Initialize a faction relation state. No-op if already exists. */
  initFactionRelation(factionId: string, initial: FactionRelationState): void {
    if (!this.state.factionRelations) {
      this.state.factionRelations = {};
    }
    if (this.state.factionRelations[factionId]) return;
    this.state.factionRelations[factionId] = initial;
    this.notifyUpdate();
  }

  /** Update fields on an existing faction relation. No-op if not initialized. */
  updateFactionRelation(factionId: string, patch: Partial<FactionRelationState>): void {
    if (!this.state.factionRelations?.[factionId]) return;
    Object.assign(this.state.factionRelations[factionId], patch);
    this.notifyUpdate();
  }

  /** Get a faction relation state (read-only). */
  getFactionRelation(factionId: string): FactionRelationState | undefined {
    return this.state.factionRelations?.[factionId];
  }

  // ── External stats ───────────────────────────────────────────

  modifyReputation(factionId: string, delta: number): void {
    this.contactFaction(factionId);   // 聲望變動自動標記接觸
    const current = this.state.player.externalStats.reputation[factionId] ?? 0;
    this.state.player.externalStats.reputation[factionId] = current + delta;
    this.logReputation(factionId, delta);
    this.notifyUpdate();
    if (delta !== 0) this._acquisitions.push({ type: 'reputation', factionId, delta });
  }

  modifyAffinity(npcId: string, delta: number): void {
    const current = this.state.player.externalStats.affinity[npcId] ?? 0;
    this.state.player.externalStats.affinity[npcId] = current + delta;
    this.logAffinity(npcId, delta);
    this.notifyUpdate();
    if (delta !== 0) this._acquisitions.push({ type: 'affinity', npcId, delta });
  }

  private logReputation(factionId: string, delta: number): void {
    if (delta) this.journal.log('social', `${this.journal.factionName(factionId)}聲望 ${formatDelta(delta)}`);
  }

  private logAffinity(npcId: string, delta: number): void {
    if (delta) this.journal.log('social', `${this.journal.npcName(npcId)}好感 ${formatDelta(delta)}`);
  }

  private logItem(prefix: string, itemId: string, variantId?: string, overrideName?: string): void {
    this.journal.log('item', `${prefix}：${overrideName ?? this.journal.itemName(itemId, variantId)}`);
  }

  addItem(
    itemId: string,
    totalMinutes: number,
    variantId?: string,
    opts?: { stackable?: boolean; maxStack?: number; maxUsesPerInstance?: number },
  ): void {
    if (opts?.stackable) {
      // Stack onto existing non-expired instance
      const existing = this.state.player.inventory.find(
        i => i.itemId === itemId && i.variantId === variantId && !i.isExpired,
      );
      if (existing) {
        const limit = opts.maxStack ?? Infinity;
        if (existing.quantity < limit) {
          existing.quantity += 1;
          this.logItem('獲得', itemId, variantId);
          this.notifyUpdate();
          this._acquisitions.push({ type: 'item', itemId, variantId });
          return;
        }
        // Stack is full — fall through to create a new stack below.
      }
    } else {
      // Non-stackable: skip if already held (original behaviour)
      const exists = this.state.player.inventory.some(
        i => i.itemId === itemId && i.variantId === variantId && !i.isExpired,
      );
      if (exists) return;
    }

    const newItem: import('../types/item').InventoryItem = {
      instanceId: itemId + (variantId ? '_' + variantId : '') + '_' + totalMinutes,
      itemId,
      variantId,
      obtainedAtMinute: totalMinutes,
      quantity: 1,
      isExpired: false,
    };
    if (opts?.maxUsesPerInstance !== undefined) {
      newItem.usesRemaining = opts.maxUsesPerInstance;
    }
    this.state.player.inventory.push(newItem);
    this.logItem('獲得', itemId, variantId);
    this.notifyUpdate();
    this._acquisitions.push({ type: 'item', itemId, variantId });
  }

  /**
   * Add a template-instantiated item to inventory.
   * Each call creates a unique instance with per-instance overrides.
   * Template items are never stackable (each is unique content).
   */
  addTemplateItem(
    baseItemId: string,
    overrides: { name?: string; description?: string; content?: string },
    totalMinutes: number,
  ): void {
    const instanceId = `${baseItemId}_${totalMinutes}_${Math.random().toString(36).slice(2, 6)}`;
    const newItem: import('../types/item').InventoryItem = {
      instanceId,
      itemId: baseItemId,
      itemOverrides: overrides,
      obtainedAtMinute: totalMinutes,
      quantity: 1,
      isExpired: false,
    };
    this.state.player.inventory.push(newItem);
    this.logItem('獲得', baseItemId, undefined, overrides.name);
    this.notifyUpdate();
    this._acquisitions.push({ type: 'item', itemId: baseItemId });
  }

  /**
   * 從玩家背包移除一個符合 itemId + variantId 的未失效物品（用於 revokeItems effect）。
   * 可堆疊物品先扣數量，歸零後才移除。
   * 找不到符合條件的物品時靜默忽略。
   */
  revokeItem(itemId: string, variantId?: string): void {
    const idx = this.state.player.inventory.findIndex(
      i => i.itemId === itemId && !i.isExpired
        && (variantId === undefined || i.variantId === variantId),
    );
    if (idx === -1) return;
    const item = this.state.player.inventory[idx];
    if (item.quantity > 1) {
      item.quantity -= 1;
    } else {
      this.state.player.inventory.splice(idx, 1);
    }
    this.logItem('失去', item.itemId, item.variantId, item.itemOverrides?.name);
    this.notifyUpdate();
  }

  /**
   * 消耗一個消耗品物品實例，套用其效果並從物品欄移除/扣除。
   * 效果由呼叫方（GameController，持有 LoreVault）解析並傳入。
   * 回傳 true = 成功消耗；false = instanceId 不存在或物品非消耗品。
   */
  consumeItem(
    instanceId: string,
    effect: import('../types/item').ConsumableEffect,
    getCondition: (id: string) => import('../types/condition').ConditionDefinition | undefined,
    /** 查詢物品定義；用於產物（yieldsItemId）的堆疊設定。省略時產物以非堆疊方式加入。 */
    getItemDef?: (id: string) => import('../types/item').ItemNode | undefined,
  ): boolean {
    const idx = this.state.player.inventory.findIndex(i => i.instanceId === instanceId);
    if (idx === -1) return false;

    const item = this.state.player.inventory[idx];
    this.logItem('使用', item.itemId, item.variantId, item.itemOverrides?.name);

    // Apply status changes
    if (effect.statusChanges) {
      for (const [key, delta] of Object.entries(effect.statusChanges)) {
        if (delta !== undefined) this.modifyStat(`statusStats.${key}`, delta);
      }
    }
    // Apply condition
    if (effect.applyConditionId) {
      this.addCondition(
        effect.applyConditionId,
        getCondition,
        effect.applyConditionDurationTurns !== undefined
          ? { expiresOnTurn: this.state.turn + effect.applyConditionDurationTurns }
          : undefined,
      );
    }
    // Remove conditions
    effect.removeConditionIds?.forEach(id => this.removeCondition(id));
    // Flags
    effect.flagsSet?.forEach(f => this.flags.set(f));
    effect.flagsUnset?.forEach(f => this.flags.unset(f));

    // Deduct usage
    if (item.usesRemaining !== undefined) {
      item.usesRemaining -= 1;
      if (item.usesRemaining <= 0) {
        this.state.player.inventory.splice(idx, 1);
      }
    } else if (item.quantity > 1) {
      item.quantity -= 1;
    } else {
      this.state.player.inventory.splice(idx, 1);
    }

    // Yield a replacement item if defined (e.g. water_bottle → empty_bottle)
    // 依產物定義傳入堆疊設定，否則已持有同物品時新產物會被 addItem 靜默丟棄
    if (effect.yieldsItemId) {
      const def = getItemDef?.(effect.yieldsItemId);
      this.addItem(effect.yieldsItemId, this.state.time.totalMinutes, undefined, {
        stackable:          def?.stackable,
        maxStack:           def?.maxStack,
        maxUsesPerInstance: def?.maxUsesPerInstance,
      });
    }

    this.notifyUpdate();
    return true;
  }

  /** 直接從物品欄移除指定實例（丟棄用）。回傳 true = 成功移除。 */
  removeItem(instanceId: string): boolean {
    const idx = this.state.player.inventory.findIndex(i => i.instanceId === instanceId);
    if (idx === -1) return false;
    this.state.player.inventory.splice(idx, 1);
    this.notifyUpdate();
    return true;
  }

  /** 從堆疊中減少指定數量。count >= 現有數量時整堆移除。回傳 true = 成功。 */
  removeItemQuantity(instanceId: string, count: number): boolean {
    const idx = this.state.player.inventory.findIndex(i => i.instanceId === instanceId);
    if (idx === -1) return false;
    const item = this.state.player.inventory[idx];
    if (count >= item.quantity) {
      this.state.player.inventory.splice(idx, 1);
    } else {
      item.quantity -= count;
    }
    this.notifyUpdate();
    return true;
  }

  // ── Conditions ───────────────────────────────────────────────

  /**
   * Add or replace a player condition by id.
   * Automatically initializes tickState if the definition has a tickEffect.
   * @param conditionId  ConditionDefinition.id
   * @param getCondition  Resolver for condition definitions (e.g. lore.getCondition)
   * @param options       Optional expiresOnTurn override
   */
  addCondition(
    conditionId: string,
    getCondition: (id: string) => ConditionDefinition | undefined,
    options?: { expiresOnTurn?: number },
  ): void {
    const def = getCondition(conditionId);
    const instance: PlayerCondition = {
      id: conditionId,
      expiresOnTurn: options?.expiresOnTurn,
    };
    if (def?.tickEffect) {
      instance.tickState = {
        ticksApplied: 0,
        nextTickTurn: this.state.turn + def.tickEffect.everyNTurns,
      };
    }
    const idx = this.state.player.conditions.findIndex(c => c.id === conditionId);
    if (idx >= 0) {
      this.state.player.conditions[idx] = instance;
    } else {
      this.state.player.conditions.push(instance);
      const { label, hidden } = this.journal.condition(conditionId);
      if (!hidden) this.journal.log('condition', `陷入狀態：${label}`);
    }
    this.notifyUpdate();
  }

  removeCondition(conditionId: string): void {
    const existed = this.state.player.conditions.some(c => c.id === conditionId);
    this.state.player.conditions = this.state.player.conditions.filter(c => c.id !== conditionId);
    if (existed) this.logConditionRemoved(conditionId);
    this.notifyUpdate();
  }

  private logConditionRemoved(conditionId: string): void {
    const { label, hidden } = this.journal.condition(conditionId);
    if (!hidden) this.journal.log('condition', `解除狀態：${label}`);
  }

  /**
   * Process condition ticks and expire outdated conditions. Call once per turn.
   * - Applies tick effects (e.g. bleeding damage) when nextTickTurn is reached.
   * - Removes conditions whose expiresOnTurn has passed or tickEffect is exhausted.
   * @param getCondition  Resolver for condition definitions (e.g. lore.getCondition)
   */
  tickConditions(getCondition: (id: string) => ConditionDefinition | undefined): void {
    const currentTurn = this.state.turn;
    let changed = false;

    // 本次 tick 的數值變化合併成一筆日誌，來源為正在作用的（可見）狀態
    const tickingLabels = this.state.player.conditions
      .filter(c => {
        const te = c.tickState ? getCondition(c.id)?.tickEffect : undefined;
        return !!te && c.tickState!.nextTickTurn <= currentTurn && c.tickState!.ticksApplied < te.maxTicks;
      })
      .map(c => this.journal.condition(c.id))
      .filter(c => !c.hidden)
      .map(c => c.label);
    const tickFrame = this.journal.begin(
      tickingLabels.length > 0 ? `狀態「${tickingLabels.join('、')}」` : '身體狀況',
    );
    try {
      for (const c of this.state.player.conditions) {
        if (!c.tickState) continue;
        const def = getCondition(c.id);
        if (!def?.tickEffect) continue;
        const te = def.tickEffect;

        // Apply all overdue ticks in sequence (handles skipped turns)
        while (c.tickState.nextTickTurn <= currentTurn && c.tickState.ticksApplied < te.maxTicks) {
          for (const [key, delta] of Object.entries(te.statChanges)) {
            if (delta !== undefined) this.modifyStat(key, delta);
          }
          c.tickState.ticksApplied += 1;
          c.tickState.nextTickTurn += te.everyNTurns;
          changed = true;
        }
      }
    } finally {
      this.journal.end(tickFrame);
    }

    const before = this.state.player.conditions.length;
    const removed: string[] = [];
    this.state.player.conditions = this.state.player.conditions.filter(c => {
      const def = getCondition(c.id);
      const keep = !(
        (c.expiresOnTurn !== undefined && c.expiresOnTurn <= currentTurn)
        || (c.tickState && def?.tickEffect && c.tickState.ticksApplied >= def.tickEffect.maxTicks)
        || def?.curedByFlags?.some(f => this.flags.has(f))
      );
      if (!keep) removed.push(c.id);
      return keep;
    });
    removed.forEach(id => this.logConditionRemoved(id));

    if (changed || this.state.player.conditions.length !== before) this.notifyUpdate();
  }

  // ── Intel ────────────────────────────────────────────────────

  addKnownIntel(intelId: string): void {
    if (!this.state.player.knownIntelIds.includes(intelId)) {
      this.state.player.knownIntelIds.push(intelId);
      this.notifyUpdate();
    }
  }

  /**
   * Grant intel and mirror to FlagSystem as `intel:<intelId>`.
   * This allows contextSnippets and other conditions to use `intel:<id>` syntax.
   */
  grantIntel(intelId: string): void {
    const isNew = !this.state.player.knownIntelIds.includes(intelId);
    this.addKnownIntel(intelId);
    this.flags.set('intel:' + intelId);
    if (isNew) {
      this.journal.log('intel', `取得情報：${this.journal.intelName(intelId)}`);
      this._acquisitions.push({ type: 'intel', intelId });
    }
  }

  // ── NPC Memory ───────────────────────────────────────────────

  /**
   * Record that the player interacted with an NPC this turn.
   * Creates entry on first contact with neutral attitude.
   */
  recordNPCInteraction(npcId: string): void {
    const existing = this.state.npcMemory[npcId];
    if (!existing) {
      this.state.npcMemory[npcId] = {
        npcId,
        firstMetTurn:       this.state.turn,
        lastInteractedTurn: this.state.turn,
        interactionCount:   1,
        playerAttitude:     'neutral',
        flags:              [],
      };
    } else {
      existing.lastInteractedTurn = this.state.turn;
      existing.interactionCount  += 1;
    }
    this.notifyUpdate();
  }

  /** 記錄一次與 NPC 的會面（開啟一段新對話時呼叫）。 */
  recordNPCMeeting(npcId: string): void {
    if (!this.state.npcMeetingCounts) this.state.npcMeetingCounts = {};
    this.state.npcMeetingCounts[npcId] = (this.state.npcMeetingCounts[npcId] ?? 0) + 1;
    this.notifyUpdate();
  }

  getNPCMeetingCount(npcId: string): number {
    return this.state.npcMeetingCounts?.[npcId] ?? 0;
  }

  /**
   * Update NPC dialogue state after an interaction.
   * Called by DialogueManager when a DM <<NPC_STATE: ...>> signal is parsed.
   */
  updateNPCDialogueState(npcId: string, topic?: string, attitude?: PlayerAttitude): void {
    const mem = this.state.npcMemory[npcId];
    if (!mem) return;
    if (topic)    mem.lastTopic      = topic;
    if (attitude) mem.playerAttitude = attitude;
    this.notifyUpdate();
  }

  /**
   * 取得指定 NPC 的本地認知旗標集合。
   */
  getNPCFlags(npcId: string): Set<string> {
    return new Set(this.state.npcMemory[npcId]?.flags ?? []);
  }

  /**
   * 設置指定 NPC 的本地認知旗標。
   * 若旗標已存在則不重複設置。
   */
  setNPCFlag(npcId: string, flagId: string): void {
    const mem = this.state.npcMemory[npcId];
    if (!mem) return;
    if (!mem.flags) mem.flags = [];
    if (!mem.flags.includes(flagId)) {
      mem.flags.push(flagId);
      this.notifyUpdate();
    }
  }

  // ── Prop local flags ─────────────────────────────────────────

  /** 取得指定 Prop 的本地旗標集合。 */
  getPropFlags(propId: string): Set<string> {
    return new Set(this.state.propFlags[propId] ?? []);
  }

  /** 設置指定 Prop 的本地旗標。若旗標已存在則不重複設置。 */
  setPropFlag(propId: string, flagId: string): void {
    if (!this.state.propFlags[propId]) this.state.propFlags[propId] = [];
    if (!this.state.propFlags[propId].includes(flagId)) {
      this.state.propFlags[propId].push(flagId);
      this.notifyUpdate();
    }
  }

  /** 清除指定 Prop 的本地旗標。 */
  unsetPropFlag(propId: string, flagId: string): void {
    const arr = this.state.propFlags[propId];
    if (!arr) return;
    const idx = arr.indexOf(flagId);
    if (idx !== -1) {
      arr.splice(idx, 1);
      this.notifyUpdate();
    }
  }

  /**
   * 批量設置多個 NPC 的本地認知旗標（用於 EventOutcome / ChoiceEffects.npcFlagsSet）。
   */
  applyNPCFlagsSet(npcFlagsSet: Record<string, string[]>): void {
    for (const [npcId, flagIds] of Object.entries(npcFlagsSet)) {
      const mem = this.state.npcMemory[npcId];
      if (!mem) continue;
      if (!mem.flags) mem.flags = [];
      for (const flagId of flagIds) {
        if (!mem.flags.includes(flagId)) mem.flags.push(flagId);
      }
    }
    this.notifyUpdate();
  }

  // ── Dialogue ─────────────────────────────────────────────────

  startDialogue(npcId: string, dialogueId: string, entryNodeId: string): void {
    this.state.activeDialogue = { npcId, dialogueId, currentNodeId: entryNodeId };
    this.state.phase = 'dialogue';
    this.notifyUpdate();
  }

  advanceDialogue(nodeId: string): void {
    if (this.state.activeDialogue) {
      this.state.activeDialogue.currentNodeId = nodeId;
      this.notifyUpdate();
    }
  }

  endDialogue(): void {
    if (this.state.activeDialogue) {
      this.recordNPCInteraction(this.state.activeDialogue.npcId);
      this.state.activeDialogue = undefined;
    }
    this.state.phase = 'exploring';
    this.notifyUpdate();
  }

  // ── Encounter ────────────────────────────────────────────────

  setPhase(phase: import('../types/game').GamePhase): void {
    this.state.phase = phase;
    this.notifyUpdate();
  }

  setActiveEncounter(encounter: import('../types/encounter').ActiveEncounter): void {
    this.state.activeEncounter = encounter;
    this.notifyUpdate();
  }

  clearActiveEncounter(): void {
    this.state.activeEncounter = undefined;
    this.state.phase = 'exploring';
    this.notifyUpdate();
  }

  // ── Intel (alias) ────────────────────────────────────────────

  /** Alias for grantIntel — sets knownIntelIds and mirrors to FlagSystem. */
  addIntel(intelId: string): void {
    this.grantIntel(intelId);
  }

  // ── Quests ───────────────────────────────────────────────────

  /**
   * 低階任務啟動（QuestEngine 呼叫）。
   * 外部請使用 QuestEngine.grantQuest() 或 QuestEngine.acceptQuest()。
   */
  startQuest(questId: string, entryStageId: string, options?: {
    source?: QuestSource;
    giverNpcId?: string;
    sourceEventId?: string;
    acceptedAtMinutes?: number;
    expiresAtMinutes?: number;
  }): void {
    this.state.activeQuests[questId] = {
      questId,
      source:                 options?.source        ?? 'npc',
      currentStageId:         entryStageId,
      completedObjectiveIds:  [],
      localFlags:             [],
      isCompleted:            false,
      isFailed:               false,
      isDitched:              false,
      giverNpcId:             options?.giverNpcId,
      sourceEventId:          options?.sourceEventId,
      acceptedAtMinutes:      options?.acceptedAtMinutes,
      expiresAtMinutes:       options?.expiresAtMinutes,
    };
    this.flags.set(questId + ':active');
    this.journal.log('quest', `接取任務：${this.journal.questName(questId)}`);
    this.bus.emit(GameEvents.QUEST_STARTED, { questId });
    this.notifyUpdate();
  }

  completeObjective(questId: string, objectiveId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance && !instance.completedObjectiveIds.includes(objectiveId)) {
      instance.completedObjectiveIds.push(objectiveId);
      const desc = this.journal.questObjective(questId, objectiveId);
      this.journal.log('quest', `目標完成：${this.journal.questName(questId)}${desc ? ` — ${desc}` : ''}`);
      this.notifyUpdate();
    }
  }

  /** 設置任務本地旗標（不影響全域 FlagSystem）。 */
  setQuestLocalFlag(questId: string, flagName: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance && !instance.localFlags.includes(flagName)) {
      instance.localFlags.push(flagName);
      this.notifyUpdate();
    }
  }

  advanceQuestStage(questId: string, nextStageId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.currentStageId = nextStageId;
      const stageDesc = this.journal.questStage(questId, nextStageId);
      this.journal.log('quest', `任務推進：${this.journal.questName(questId)}${stageDesc ? ` — ${stageDesc}` : ''}`);
      // completedObjectiveIds is intentionally NOT reset here so past-stage
      // objectives remain visible (with strikethrough) in the quest detail UI.
      // Repeatable quests use resetQuest() which does reset them.
      this.bus.emit(GameEvents.QUEST_STAGE_ADVANCED, { questId, nextStageId });
      this.notifyUpdate();
    }
  }

  /**
   * 循環任務用重置（而非標記為 completed）。
   * 回到 entryStageId 並清除 objectives，保持 activeQuests 中繼續存在。
   */
  resetQuest(questId: string, entryStageId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      this.journal.log('quest', `任務完成：${this.journal.questName(questId)}`);
      this.bus.emit(GameEvents.QUEST_COMPLETED, { questId });
      instance.currentStageId        = entryStageId;
      instance.completedObjectiveIds = [];
      instance.localFlags            = [];
      this.notifyUpdate();
    }
  }

  completeQuest(questId: string, reward?: QuestReward): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.isCompleted    = true;
      instance.currentStageId = null;
      this.flags.unset(questId + ':active');
      this.journal.log('quest', `任務完成：${this.journal.questName(questId)}`);
      if (!this.state.completedQuestIds.includes(questId)) {
        this.state.completedQuestIds.push(questId);
      }
      // Apply rewards
      if (reward) {
        reward.flagsSet?.forEach(f => this.flags.set(f));
        if (reward.reputationChanges) {
          for (const [fid, delta] of Object.entries(reward.reputationChanges)) {
            const current = this.state.player.externalStats.reputation[fid] ?? 0;
            this.state.player.externalStats.reputation[fid] = current + delta;
            this.logReputation(fid, delta);
          }
        }
        if (reward.affinityChanges) {
          for (const [nid, delta] of Object.entries(reward.affinityChanges)) {
            const current = this.state.player.externalStats.affinity[nid] ?? 0;
            this.state.player.externalStats.affinity[nid] = current + delta;
            this.logAffinity(nid, delta);
          }
        }
        if (reward.experience) {
          this.state.player.statusStats.experience += reward.experience;
          this.journal.stat('characterExp', '角色經驗', reward.experience);
        }
        if (reward.items) {
          const now = this.state.time.totalMinutes;
          reward.items.forEach(({ itemId, variantId }) => {
            this.addItem(itemId, now, variantId);
          });
        }
      }
      this.bus.emit(GameEvents.QUEST_COMPLETED, { questId });
      this.notifyUpdate();
    }
  }

  /**
   * 將已完成的循環任務實例從 activeQuests 移除。
   * 讓 QuestEngine.checkPendingRepeats 在條件成立時可重新授予。
   * 僅對 isCompleted=true 的實例有效。
   */
  removeActiveQuest(questId: string): void {
    if (this.state.activeQuests[questId]?.isCompleted) {
      delete this.state.activeQuests[questId];
      this.notifyUpdate();
    }
  }

  removeEndedQuest(questId: string): void {
    const instance = this.state.activeQuests[questId];
    if (instance?.isCompleted || instance?.isFailed || instance?.isDitched) {
      delete this.state.activeQuests[questId];
      this.notifyUpdate();
    }
  }

  /** 玩家主動放棄任務。套用當前階段的 ditchConsequences 後移出 activeQuests。 */
  ditchQuest(questId: string, consequences?: QuestDitchConsequences): void {
    const instance = this.state.activeQuests[questId];
    if (!instance) return;

    instance.isDitched      = true;
    instance.isFailed       = true;
    instance.currentStageId = null;
    this.flags.unset(questId + ':active');
    this.journal.log('quest', consequences?.beneficiaryFactionId
      ? `背棄任務：${this.journal.questName(questId)}（背叛）`
      : `背棄任務：${this.journal.questName(questId)}`);

    if (consequences) {
      consequences.flagsSet?.forEach(f => this.flags.set(f));
      consequences.flagsUnset?.forEach(f => this.flags.unset(f));
      // Direct override (set to exact value, used for forcing faction to hostile)
      if (consequences.reputationOverrides) {
        for (const [fid, value] of Object.entries(consequences.reputationOverrides)) {
          const prev = this.state.player.externalStats.reputation[fid] ?? 0;
          this.state.player.externalStats.reputation[fid] = value;
          this.logReputation(fid, value - prev);
        }
      }
      // Delta changes (on top of any override)
      if (consequences.reputationChanges) {
        for (const [fid, delta] of Object.entries(consequences.reputationChanges)) {
          const current = this.state.player.externalStats.reputation[fid] ?? 0;
          this.state.player.externalStats.reputation[fid] = current + delta;
          this.logReputation(fid, delta);
        }
      }
      if (consequences.affinityChanges) {
        for (const [nid, delta] of Object.entries(consequences.affinityChanges)) {
          const current = this.state.player.externalStats.affinity[nid] ?? 0;
          this.state.player.externalStats.affinity[nid] = current + delta;
          this.logAffinity(nid, delta);
        }
      }
      if (consequences.statChanges) {
        for (const [key, delta] of Object.entries(consequences.statChanges)) {
          if (delta !== undefined) this.modifyStat(key, delta);
        }
      }
    }

    // 出賣行為（有 beneficiaryFactionId）→ 進 completedQuestIds，不可再接
    // 普通放棄 → 不進 completedQuestIds，允許再次接受
    if (consequences?.beneficiaryFactionId && !this.state.completedQuestIds.includes(questId)) {
      this.state.completedQuestIds.push(questId);
    }
    delete this.state.activeQuests[questId];
    this.bus.emit(GameEvents.QUEST_DITCHED, {
      questId,
      isBetrayalDitch: !!consequences?.beneficiaryFactionId,
      beneficiaryFactionId: consequences?.beneficiaryFactionId,
    });
    this.notifyUpdate();
  }

  /** 標記接下來對 questId 的 failQuest 是玩家主動放棄（只影響日誌文字）。 */
  markAbandoning(questId: string): void {
    this._abandoning.add(questId);
  }

  clearAbandoning(questId: string): void {
    this._abandoning.delete(questId);
  }

  failQuest(questId: string, options?: { recordAsCompleted?: boolean }): void {
    const instance = this.state.activeQuests[questId];
    if (instance) {
      instance.isFailed       = true;
      instance.currentStageId = null;
      this.flags.unset(questId + ':active');
      this.journal.log('quest', this._abandoning.has(questId)
        ? `放棄任務：${this.journal.questName(questId)}`
        : `任務失敗：${this.journal.questName(questId)}`);
      this._abandoning.delete(questId);
      const recordAsCompleted = options?.recordAsCompleted ?? true;
      if (recordAsCompleted && !this.state.completedQuestIds.includes(questId)) {
        this.state.completedQuestIds.push(questId);
      }
      this.bus.emit(GameEvents.QUEST_FAILED, { questId });
      this.notifyUpdate();
    }
  }

  // ── Time ─────────────────────────────────────────────────────

  advanceTime(newTime: GameTime, newPeriod: TimePeriod): boolean {
    const periodChanged = newPeriod !== this.state.timePeriod;
    this.state.time       = newTime;
    this.state.timePeriod = newPeriod;
    this.syncCurfewFlag();
    this.notifyUpdate();
    return periodChanged;
  }

  // ── Curfew ───────────────────────────────────────────────────
  // 門禁的唯一來源：curfewConfig（區域預設）+ state.curfewOverride（當晚覆寫）。
  // 每次時間推進後同步 activeFlag；通道（access.flag）、事件（condition.flags）與地圖都只讀這個旗標。

  private curfewConfig?: CurfewConfig;

  /** 設定目前區域的門禁設定（區域切換、讀檔後呼叫），並立即同步旗標。 */
  setCurfewConfig(cfg: CurfewConfig | undefined): void {
    this.curfewConfig = cfg;
    this.syncCurfewFlag();
  }

  getCurfewConfig(): CurfewConfig | undefined {
    return this.curfewConfig;
  }

  /** 目前有效的門禁時間窗（含覆寫）；無門禁設定回傳 null。 */
  getEffectiveCurfew(): CurfewWindow | null {
    return getEffectiveCurfew(this.curfewConfig, this.state.curfewOverride, this.state.time.totalMinutes);
  }

  /**
   * 由事件效果呼叫：從候選時刻隨機選出當晚門禁開始時間。
   * 同一晚已有覆寫時不重抽（廣播冷卻較短，一天可能播多次），保持敘述與實際時間一致。
   */
  rollCurfewOverride(options: { hour: number; minute: number }[], random: () => number = Math.random): CurfewOverride | null {
    const cfg = this.curfewConfig;
    if (!cfg) return null;
    const t = this.state.time;
    const current = this.state.curfewOverride;
    if (current && isOverrideActive(current, t.totalMinutes)
        && current.expiresAtTotalMinutes === computeOverrideExpiry(cfg, t)) {
      return current;
    }
    const next = rollCurfewOverride(cfg, options, t, random);
    if (!next) return null;
    this.state.curfewOverride = next;
    const hh = String(next.startHour).padStart(2, '0');
    const mm = String(next.startMinute).padStart(2, '0');
    this.journal.log('location', `門禁時間調整：今晚 ${hh}:${mm} 起`);
    this.syncCurfewFlag();
    this.notifyUpdate();
    return next;
  }

  /** 依目前時間與覆寫同步門禁旗標；過期的覆寫在此清除。 */
  private syncCurfewFlag(): void {
    const cfg = this.curfewConfig;
    if (!cfg) return;
    const t = this.state.time;
    if (this.state.curfewOverride && !isOverrideActive(this.state.curfewOverride, t.totalMinutes)) {
      delete this.state.curfewOverride;
    }
    if (isCurfewActive(cfg, this.state.curfewOverride, t)) this.flags.set(cfg.activeFlag);
    else this.flags.unset(cfg.activeFlag);
  }

  /**
   * 檢查物品欄中所有未失效物品，將已到達時限的物品標記為 isExpired。
   * @param getExpiresAfterMinutes 接受 itemId，回傳該物品定義的時限分鐘數；無時限回傳 undefined
   */
  tickItemExpiry(getExpiresAfterMinutes: (itemId: string) => number | undefined): void {
    const now = this.state.time.totalMinutes;
    let changed = false;
    for (const item of this.state.player.inventory) {
      if (item.isExpired) continue;
      const expiresAfter = getExpiresAfterMinutes(item.itemId);
      if (expiresAfter === undefined) continue;
      if (now >= item.obtainedAtMinute + expiresAfter) {
        item.isExpired = true;
        changed = true;
        this.logItem('過期', item.itemId, item.variantId, item.itemOverrides?.name);
        this.bus.emit(GameEvents.ITEM_EXPIRED, { itemId: item.itemId, instanceId: item.instanceId, variantId: item.variantId });
      }
    }
    if (changed) this.notifyUpdate();
  }

  setEventCooldown(eventId: string, totalMinutes: number): void {
    this.state.eventCooldowns[eventId] = totalMinutes;
  }

  setAttemptCooldown(connectionKey: string, totalMinutes: number): void {
    this.state.attemptCooldowns[connectionKey] = totalMinutes;
  }

  getAttemptCooldown(connectionKey: string): number | undefined {
    return this.state.attemptCooldowns[connectionKey];
  }

  getEventCounter(counterId: string): number {
    return this.state.eventCounters[counterId] ?? 0;
  }

  setEventCounter(counterId: string, value: number): void {
    const next = Math.max(0, Math.trunc(value));
    if (next === 0) {
      delete this.state.eventCounters[counterId];
    } else {
      this.state.eventCounters[counterId] = next;
    }
    this.notifyUpdate();
  }

  modifyEventCounter(counterId: string, delta: number): void {
    this.setEventCounter(counterId, this.getEventCounter(counterId) + delta);
  }

  resetEventCounter(counterId: string): void {
    if (counterId in this.state.eventCounters) {
      delete this.state.eventCounters[counterId];
      this.notifyUpdate();
    }
  }

  // ── World phase ──────────────────────────────────────────────

  advancePhase(phaseId: WorldPhaseId): void {
    if (!this.state.worldPhase.appliedPhaseIds.includes(phaseId)) {
      this.state.worldPhase.currentPhase = phaseId;
      this.state.worldPhase.appliedPhaseIds.push(phaseId);
      this.bus.emit(GameEvents.PHASE_ADVANCED, { phaseId });
      this.notifyUpdate();
    }
  }

  // ── Narrative & thoughts ─────────────────────────────────────

  setThoughts(thoughts: Thought[]): void {
    this.state.pendingThoughts = thoughts;
    this.notifyUpdate();
  }

  setLastNarrative(text: string): void {
    this.state.lastNarrative = text;
  }

  /**
   * Append a history entry for the current turn, then increment turn counter.
   * flagsChanged format: '+flag_id' for set, '-flag_id' for unset.
   */
  appendHistory(
    action: PlayerAction,
    narrative: string,
    npcIds?: string[],
    flagsChanged?: string[],
  ): void {
    this.state.history.push({
      turn: this.state.turn,
      action,
      narrative,
      locationId: this.state.player.currentLocationId,
      npcIds,
      flagsChanged,
    });
    if (this.state.history.length > 20) {
      this.state.history.shift();
    }
    this.state.turn += 1;
    this.notifyUpdate();
  }

  // ── Internal ─────────────────────────────────────────────────

  /** Forward an arbitrary event to the bus (for use by sub-engines). */
  emit(event: string, payload: unknown): void {
    this.bus.emit(event, payload);
  }

  /** 取出並清空所有待顯示的獲取通知（由 GameController 在敘事結束後呼叫）。 */
  drainAcquisitions(): AcquisitionRecord[] {
    const records = this._acquisitions;
    this._acquisitions = [];
    return records;
  }

  private notifyUpdate(): void {
    this.bus.emit(GameEvents.STATE_UPDATED, this.state);
  }
}
