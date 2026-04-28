// EncounterEngine — manages structured encounter flow.
//
// 遭遇（Encounter）是有別於自由探索和 NPC 對話的第三種遊戲模式：
//   - 由 EventOutcome.startEncounterId 觸發
//   - 使用 GameState.phase = 'event' 標記進行中
//   - 支援固定選項、條件分支、數值判定（stat check）
//
// 與 DialogueManager 的關係：
//   - 遭遇不綁定 NPC，選項由引擎呈現而非 LLM 生成
//   - 判定由引擎自動執行，結果決定跳轉節點
//   - DM 負責敘述進入節點的情境（使用 dmNarrative 或 displayText）

import type { LoreVault } from '../lore/LoreVault';
import type { StateManager } from './StateManager';
import type { EncounterDefinition, EncounterNode, EncounterChoice, EncounterChoiceEffects, ScriptLine } from '../types/encounter';
import type { PrimaryStatKey } from '../types/player';
import type { ItemRequirement } from '../types/item';
import { DiceEngine } from './DiceEngine';
import type { RollResult } from './DiceEngine';
import { GameEvents } from './EventBus';
import { createLogger } from '../utils/Logger';
import { checkDateTimeConditions } from '../utils/dateTimeCondition';

const log = createLogger('EncounterEngine');

/**
 * 節點解析結果：已決定下一步的節點狀態。
 * stat check 節點會被自動解析，只返回最終需要展示的節點。
 */
export interface ResolvedNode {
  node: EncounterNode;
  /** 過濾後玩家可見的選項（condition 評估後的結果） */
  visibleChoices: EncounterChoice[];
  /** 是否為結局節點（遭遇在展示後應結束） */
  isOutcome: boolean;
  /** 數值判定結果（若此節點經過 stat check 解析才有值） */
  statCheckResult?: { stat: string; dc: number; value: number; passed: boolean; rollResult?: RollResult; sides?: number };
}

/**
 * start() 回傳的 discriminated union。
 *   kind = 'node'  — event/dialogue/combat/shop：返回解析後的節點
 *   kind = 'story' — story 型別：返回第一幕
 */
export type EncounterStartResult =
  | { kind: 'node';  resolved: ResolvedNode }
  | { kind: 'story'; script: ScriptLine[]; currentLineIndex: number };

/** 待 GameController 處理的高層效果（需跨引擎協調） */
export interface EncounterPendingEffects {
  questGrant?: string;
  questFail?: string;
  /** 推進任務到指定階段（GameController 轉交 StateManager.advanceQuestStage） */
  advanceQuestStage?: { questId: string; stageId: string };
  /** 標記任務目標為已完成（GameController 轉交 QuestEngine） */
  completeQuestObjective?: { questId: string; objectiveId: string };
  /** 移動玩家到指定地點（GameController 轉交 StateManager.movePlayer） */
  movePlayer?: string;
  /** 推進遊戲時間（分鐘數，GameController 負責時段計算與 tick） */
  timeAdvance?: number;
  /**
   * 當 isOutcome 節點被選中時設置。
   * GameController 渲染完成後應呼叫 conclude() 完成遭遇結束流程。
   */
  outcomeType?: 'success' | 'failure' | 'neutral';
  /** 背叛並永久棄置指定任務（GameController 轉交 QuestEngine.ditchQuest） */
  questDitch?: string;
}

export class EncounterEngine {
  /** 暫存由遭遇 effects 產生的、需要 GameController 轉發的高層效果 */
  private pending: EncounterPendingEffects = {};

  constructor(
    private lore:  LoreVault,
    private state: StateManager,
  ) {}

  /**
   * 取出並清空待處理效果。
   * GameController 在每次 selectChoice 呼叫後呼叫此方法，確保 grantQuestId / failQuestId 被正確處理。
   */
  flushPendingEffects(): EncounterPendingEffects {
    const out = { ...this.pending };
    this.pending = {};
    return out;
  }

  /**
   * 啟動遭遇。
   * 設定 GameState.phase = 'event' 並建立 activeEncounter。
   * story 型別回傳 { kind: 'story', scene, isLast }；
   * 其他型別回傳 { kind: 'node', resolved }。
   */
  start(encounterId: string): EncounterStartResult | null {
    const def = this.lore.getEncounter(encounterId);
    if (!def) {
      log.warn('Unknown encounter', { encounterId });
      return null;
    }

    // ── story 型別：cutscene script ────────────────────────────
    if (def.type === 'story') {
      const script = def.script;
      if (!script?.length) {
        log.warn('Story encounter has no script', { encounterId });
        return null;
      }

      // Batch-advance from line 0 to first pause (or end of script).
      // Effects are NOT applied here — GameController applies them per-line after rendering.
      let idx = 0;
      while (idx < script.length) {
        if (script[idx].pause) break;
        idx++;
      }
      // idx = pause line index (inclusive), or script.length if no pause found.
      // currentLineIndex = last line processed (clamped to last index).
      const currentLineIndex = Math.min(idx, script.length - 1);

      const collectedNarrative = script
        .slice(0, currentLineIndex + 1)
        .filter(l => l.text)
        .map(l => l.speaker ? `${l.speaker}: ${l.text}` : l.text!)
        .join('\n');

      this.state.setPhase('event');
      this.state.setActiveEncounter({ encounterId, currentLineIndex, collectedNarrative });
      log.info('Story encounter started', { encounterId, currentLineIndex });
      this.state.emit(GameEvents.ENCOUNTER_STARTED, { encounterId });
      return { kind: 'story', script, currentLineIndex };
    }

    // ── node 型別：event / dialogue / combat / shop ────────────
    const entryNodeId = def.entryNodeId;
    const entryNode = entryNodeId ? def.nodes?.[entryNodeId] : undefined;
    if (!entryNode) {
      log.warn('Missing entry node', { encounterId, entryNodeId });
      return null;
    }

    this.state.setPhase('event');
    this.state.setActiveEncounter({
      encounterId,
      currentNodeId: entryNodeId,
      collectedNarrative: '',
    });

    log.info('Encounter started', { encounterId, entryNodeId });
    this.state.emit(GameEvents.ENCOUNTER_STARTED, { encounterId });

    return { kind: 'node', resolved: this.resolveNode(def, entryNode) };
  }

  /**
   * 選擇選項並推進遭遇。
   * @returns 下一個節點（或 null 如果遭遇結束）
   */
  selectChoice(choiceId: string): ResolvedNode | null {
    const active = this.state.getState().activeEncounter;
    if (!active) {
      log.warn('selectChoice called with no active encounter');
      return null;
    }

    const def = this.lore.getEncounter(active.encounterId);
    if (!def) return null;

    const currentNode = active.currentNodeId ? def.nodes?.[active.currentNodeId] : undefined;
    if (!currentNode) return null;

    // '__continue__' is a legacy synthetic choice ID; story type uses advanceStory() instead
    if (choiceId === '__continue__') {
      this.endEncounter(active.collectedNarrative);
      return null;
    }

    const choice = currentNode.choices?.find(c => c.id === choiceId);
    if (!choice) {
      log.warn('Unknown choice', { choiceId, nodeId: active.currentNodeId });
      return null;
    }

    // Apply choice effects
    if (choice.effects) {
      this.applyEffects(choice.effects);
    }

    // Append choice text to collected narrative
    const updatedNarrative = active.collectedNarrative + '\n[玩家]: ' + choice.text;

    // End encounter if nextNodeId is null
    if (choice.nextNodeId === null) {
      this.state.setActiveEncounter({ ...active, collectedNarrative: updatedNarrative });
      this.endEncounter(updatedNarrative);
      return null;
    }

    const nextNode = def.nodes?.[choice.nextNodeId];
    if (!nextNode) {
      log.warn('Missing next node', { nodeId: choice.nextNodeId });
      this.endEncounter(updatedNarrative);
      return null;
    }

    const resolved = this.resolveNode(def, nextNode);
    const resolvedNode = resolved.node;

    this.state.setActiveEncounter({
      ...active,
      currentNodeId: resolvedNode.id,
      collectedNarrative: updatedNarrative,
    });

    // Outcome node: apply effects and signal, but do NOT call endEncounter() yet.
    // GameController will render the node via DM first, then call conclude().
    if (resolved.isOutcome) {
      if (resolvedNode.effects) {
        this.applyEffects(resolvedNode.effects);
      }
      const outcomeType = resolvedNode.outcomeType ?? 'neutral';
      this.state.emit(
        GameEvents.ENCOUNTER_OUTCOME,
        { encounterId: active.encounterId, outcomeType },
      );
      // Append outcome narrative to collectedNarrative so DM context is complete
      this.state.setActiveEncounter({
        ...active,
        currentNodeId: resolvedNode.id,
        collectedNarrative: updatedNarrative + '\n' + (resolvedNode.displayText ?? resolvedNode.dmNarrative ?? ''),
      });
      this.pending.outcomeType = outcomeType;
    }

    return resolved;
  }

  /**
   * 在 GameController 渲染 outcome 節點後呼叫，正式完成遭遇結束流程。
   * outcomeType 由 GameController 從 flushPendingEffects() 的結果中取得並傳入。
   */
  conclude(outcomeType?: 'success' | 'failure' | 'neutral'): void {
    const active = this.state.getState().activeEncounter;
    if (!active) return;
    this.endEncounter(active.collectedNarrative, outcomeType);
  }

  /**
   * story 型別專用：玩家點「繼續」推進下一個批次。
   * 從目前行的下一行開始，自動前進直到遇到 pause:true 或 script 結尾。
   * 每行的 effects 依序套用。
   * 返回新狀態供 GameController 渲染；所有行處理完後套用 result 並結束，返回 null。
   */
  advanceLine(): { script: ScriptLine[]; currentLineIndex: number } | null {
    const active = this.state.getState().activeEncounter;
    if (!active || active.currentLineIndex === undefined) {
      log.warn('advanceLine called without active story encounter');
      return null;
    }

    const def = this.lore.getEncounter(active.encounterId);
    const script = def?.script;
    if (!script) return null;

    // Batch-advance from next line to next pause (or end).
    // Effects are NOT applied here — GameController applies them per-line after rendering.
    let idx = active.currentLineIndex + 1;
    while (idx < script.length) {
      if (script[idx].pause) break;
      idx++;
    }

    // Ran off end — return null; GameController renders remaining lines then calls concludeStory().
    if (idx >= script.length) {
      return null;
    }

    // Stopped at a pause line (idx)
    const newNarrative = script
      .slice(active.currentLineIndex + 1, idx + 1)
      .filter(l => l.text)
      .map(l => l.speaker ? `${l.speaker}: ${l.text}` : l.text!)
      .join('\n');

    this.state.setActiveEncounter({
      ...active,
      currentLineIndex: idx,
      collectedNarrative: [active.collectedNarrative, newNarrative].filter(Boolean).join('\n'),
    });
    return { script, currentLineIndex: idx };
  }

  /**
   * 套用指定行索引的效果。
   * GameController 在打字機渲染完每行後呼叫，確保效果在文字顯示後才生效。
   */
  applyLineEffects(lineIdx: number): void {
    const active = this.state.getState().activeEncounter;
    if (!active) return;
    const def = this.lore.getEncounter(active.encounterId);
    const effects = def?.script?.[lineIdx]?.effects;
    if (effects) this.applyEffects(effects);
  }

  /**
   * 套用 story 遭遇的最終結果效果並結束遭遇。
   * 在 GameController 渲染完最後一批行後呼叫，取代原本 advanceLine() 的行內 endEncounter。
   */
  concludeStory(): void {
    const active = this.state.getState().activeEncounter;
    if (!active) return;
    const def = this.lore.getEncounter(active.encounterId);
    if (def?.result?.effects) this.applyEffects(def.result.effects);
    const outcomeType = def?.result?.outcomeType ?? 'neutral';
    this.endEncounter(active.collectedNarrative, outcomeType);
  }

  /**
   * 強制結束遭遇（例如玩家移動、超時等外部原因）。
   */
  forceEnd(): void {
    const active = this.state.getState().activeEncounter;
    if (!active) return;
    this.endEncounter(active.collectedNarrative);
    log.info('Encounter force-ended', { encounterId: active.encounterId });
  }

  // -- Private -----------------------------------------------------------

  /**
   * 解析節點：自動處理 stat check 並過濾 choices。
   * stat check 節點會遞迴解析到下一個非 check 節點為止。
   */
  private resolveNode(def: EncounterDefinition, node: EncounterNode): ResolvedNode {
    // Weighted branch: pick a random destination by weight
    if (node.weightedBranch?.length) {
      const totalWeight = node.weightedBranch.reduce((s, b) => s + b.weight, 0);
      let roll = Math.random() * totalWeight;
      let picked = node.weightedBranch[0];
      for (const branch of node.weightedBranch) {
        roll -= branch.weight;
        if (roll <= 0) { picked = branch; break; }
      }
      log.debug('Weighted branch', { nodeId: node.id, picked: picked.nodeId, totalWeight });
      const nextNode = def.nodes?.[picked.nodeId];
      if (!nextNode) {
        log.warn('Missing weighted branch target node', { nodeId: picked.nodeId });
        return { node, visibleChoices: [], isOutcome: true };
      }
      return this.resolveNode(def, nextNode);
    }

    // Stat check: resolve automatically using DiceEngine
    if (node.statCheck) {
      const gs       = this.state.getState();
      const { stat, dc, successNodeId, failNodeId } = node.statCheck;
      const baseStat = this.resolveStatValue(gs, stat) ?? 0;

      const rollResult = DiceEngine.roll({
        dice:         node.statCheck.dice ?? { count: 1, sides: 20 },
        baseStat,
        modifiers:    node.statCheck.modifiers ?? [],
        advantage:    node.statCheck.advantage,
        disadvantage: node.statCheck.disadvantage,
      });
      const passed = DiceEngine.passes(rollResult, dc);
      const nextId = passed ? successNodeId : failNodeId;

      log.debug('Stat check (dice)', { stat, dc, rollResult, passed });

      const nextNode = def.nodes?.[nextId];
      if (!nextNode) {
        log.warn('Missing stat check target node', { nextId });
        return { node, visibleChoices: [], isOutcome: true, statCheckResult: { stat, dc, value: rollResult.total, passed, rollResult, sides: node.statCheck.dice?.sides ?? 20 } };
      }

      // Recurse — the resolved node is the final destination
      const resolved = this.resolveNode(def, nextNode);
      return { ...resolved, statCheckResult: { stat, dc, value: rollResult.total, passed, rollResult, sides: node.statCheck.dice?.sides ?? 20 } };
    }

    // Filter choices by conditions (flag, items, melphin, reputation, affinity)
    const gs = this.state.getState();
    const { reputation, affinity } = gs.player.externalStats;
    const visibleChoices = (node.choices ?? []).filter(c => {
      if (c.condition && !this.state.flags.evaluate(c.condition)) return false;
      if (c.itemRequirements?.length && !this.meetsItemRequirements(c.itemRequirements, gs)) return false;
      if (c.minMelphin !== undefined && gs.player.melphin < c.minMelphin) return false;
      if (!checkDateTimeConditions(c.dateTimeConditions, gs.time)) return false;
      if (c.minReputation) {
        for (const [fid, min] of Object.entries(c.minReputation)) {
          if ((reputation[fid] ?? 0) < min) return false;
        }
      }
      if (c.maxReputation) {
        for (const [fid, max] of Object.entries(c.maxReputation)) {
          if ((reputation[fid] ?? 0) > max) return false;
        }
      }
      if (c.minAffinity) {
        for (const [nid, min] of Object.entries(c.minAffinity)) {
          if ((affinity[nid] ?? 0) < min) return false;
        }
      }
      if (c.maxAffinity) {
        for (const [nid, max] of Object.entries(c.maxAffinity)) {
          if ((affinity[nid] ?? 0) > max) return false;
        }
      }
      return true;
    });

    return {
      node,
      visibleChoices,
      isOutcome: node.isOutcome ?? false,
    };
  }

  private applyEffects(effects: EncounterChoiceEffects): void {
    effects.flagsSet?.forEach(f => this.state.flags.set(f));
    effects.flagsUnset?.forEach(f => this.state.flags.unset(f));
    if (effects.statChanges) {
      for (const [key, delta] of Object.entries(effects.statChanges)) {
        if (delta !== undefined) this.state.modifyStat(key, delta);
      }
    }
    if (effects.reputationChanges) {
      for (const [factionId, delta] of Object.entries(effects.reputationChanges)) {
        if (delta !== undefined) this.state.modifyReputation(factionId, delta);
      }
    }
    if (effects.affinityChanges) {
      for (const [npcId, delta] of Object.entries(effects.affinityChanges)) {
        if (delta !== undefined) this.state.modifyAffinity(npcId, delta);
      }
    }
    if (effects.grantItems?.length) {
      const now = this.state.getState().time.totalMinutes;
      for (const { itemId, variantId } of effects.grantItems) {
        const def = this.lore.getItem(itemId);
        this.state.addItem(itemId, now, variantId, {
          stackable:          def?.stackable,
          maxStack:           def?.maxStack,
          maxUsesPerInstance: def?.maxUsesPerInstance,
        });
      }
    }
    if (effects.contactFactionIds?.length) {
      for (const factionId of effects.contactFactionIds) {
        this.state.contactFaction(factionId);
      }
    }
    if (effects.melphinChange) {
      this.state.modifyMelphin(effects.melphinChange);
    }
    if (effects.grantQuestId) {
      // Store for GameController to pick up via flushPendingEffects()
      this.pending.questGrant = effects.grantQuestId;
    }
    if (effects.failQuestId) {
      // Store for GameController to pick up via flushPendingEffects()
      this.pending.questFail = effects.failQuestId;
    }
    if (effects.advanceQuestStage) {
      this.pending.advanceQuestStage = effects.advanceQuestStage;
    }
    if (effects.completeQuestObjective) {
      this.pending.completeQuestObjective = effects.completeQuestObjective;
    }
    if (effects.grantIntelId) {
      this.state.addIntel(effects.grantIntelId);
    }
    if (effects.movePlayer) {
      this.pending.movePlayer = effects.movePlayer;
    }
    if (effects.timeAdvance) {
      this.pending.timeAdvance = (this.pending.timeAdvance ?? 0) + effects.timeAdvance;
    }
    if (effects.skillExpChanges) {
      for (const [statKey, baseAmount] of Object.entries(effects.skillExpChanges)) {
        if (baseAmount !== undefined) {
          this.state.grantSkillExp(statKey as PrimaryStatKey, baseAmount, 'encounter');
        }
      }
    }
    if (effects.characterExpGrant) {
      this.state.grantCharacterExp(effects.characterExpGrant);
    }
    if (effects.applyConditionId) {
      this.state.addCondition(effects.applyConditionId, id => this.lore.getCondition(id));
    }
    effects.removeConditionIds?.forEach(id => this.state.removeCondition(id));
    if (effects.npcFlagsSet) {
      this.state.applyNPCFlagsSet(effects.npcFlagsSet);
    }
    if (effects.ditchQuestId) {
      // Store for GameController to pick up via flushPendingEffects()
      this.pending.questDitch = effects.ditchQuestId;
    }
  }

  /** 玩家是否持有所有指定未失效物品 */
  private meetsItemRequirements(reqs: ItemRequirement[], gs: Readonly<import('../types').GameState>): boolean {
    return reqs.every(req =>
      gs.player.inventory.some(
        i => i.itemId === req.itemId
          && !i.isExpired
          && (req.variantId === undefined || i.variantId === req.variantId)
      )
    );
  }

  private endEncounter(collectedNarrative: string, outcomeType?: 'success' | 'failure' | 'neutral'): void {
    const active = this.state.getState().activeEncounter;
    if (!active) return;

    // Set completion flags for quest objective tracking
    this.state.flags.set(`encounter_${active.encounterId}_completed`);
    if (outcomeType) {
      this.state.flags.set(`encounter_${active.encounterId}_${outcomeType}`);
    }

    // Write to history with structured label for DM context continuity
    const def          = this.lore.getEncounter(active.encounterId);
    const encounterLabel = def?.name ? `[遭遇] ${def.name}` : `[遭遇] ${active.encounterId}`;
    const outcomeLabel   = outcomeType
      ? `（${outcomeType === 'success' ? '成功' : outcomeType === 'failure' ? '失敗' : '中性'}）`
      : '';
    this.state.appendHistory(
      { type: 'free', input: `${encounterLabel}${outcomeLabel}` },
      collectedNarrative.slice(0, 400),
    );

    this.state.setPhase('exploring');
    this.state.clearActiveEncounter();
    this.state.emit(GameEvents.ENCOUNTER_ENDED, { encounterId: active.encounterId });
    log.info('Encounter ended', { encounterId: active.encounterId });
  }

  private resolveStatValue(
    gs: Readonly<import('../types').GameState>,
    key: string,
  ): number | undefined {
    const [group, stat] = key.split('.');
    const statsGroup = (gs.player as unknown as Record<string, Record<string, number>>)[group];
    return statsGroup?.[stat];
  }
}
