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
import type { EncounterDefinition, EncounterNode, EncounterChoice, EncounterChoiceEffects } from '../types/encounter';
import type { ItemRequirement } from '../types/item';
import { GameEvents } from './EventBus';
import { createLogger } from '../utils/Logger';

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
  statCheckResult?: { stat: string; threshold: number; value: number; passed: boolean };
}

/** 待 GameController 處理的高層效果（需跨引擎協調） */
export interface EncounterPendingEffects {
  questGrant?: string;
  questFail?: string;
  /**
   * 當 isOutcome 節點被選中時設置。
   * GameController 渲染完成後應呼叫 conclude() 完成遭遇結束流程。
   */
  outcomeType?: 'success' | 'failure' | 'neutral';
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
   * 返回入口節點的解析結果，供 GameController 渲染。
   */
  start(encounterId: string): ResolvedNode | null {
    const def = this.lore.getEncounter(encounterId);
    if (!def) {
      log.warn('Unknown encounter', { encounterId });
      return null;
    }

    const entryNode = def.nodes[def.entryNodeId];
    if (!entryNode) {
      log.warn('Missing entry node', { encounterId, entryNodeId: def.entryNodeId });
      return null;
    }

    this.state.setPhase('event');
    this.state.setActiveEncounter({
      encounterId,
      currentNodeId: def.entryNodeId,
      collectedNarrative: '',
    });

    log.info('Encounter started', { encounterId, entryNodeId: def.entryNodeId });
    this.state.emit(GameEvents.ENCOUNTER_STARTED, { encounterId });

    return this.resolveNode(def, entryNode);
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

    const currentNode = def.nodes[active.currentNodeId];
    if (!currentNode) return null;

    // '__continue__' is a synthetic "no choices" advance used by narrative nodes
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

    const nextNode = def.nodes[choice.nextNodeId];
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
    // Stat check: resolve automatically
    if (node.statCheck) {
      const gs     = this.state.getState();
      const { stat, threshold, successNodeId, failNodeId } = node.statCheck;
      const value  = this.resolveStatValue(gs, stat);
      const passed = value !== undefined && value >= threshold;
      const nextId = passed ? successNodeId : failNodeId;

      log.debug('Stat check', { stat, threshold, value, passed });

      const nextNode = def.nodes[nextId];
      if (!nextNode) {
        log.warn('Missing stat check target node', { nextId });
        return { node, visibleChoices: [], isOutcome: true, statCheckResult: { stat, threshold, value: value ?? 0, passed } };
      }

      // Recurse — the resolved node is the final destination
      const resolved = this.resolveNode(def, nextNode);
      return { ...resolved, statCheckResult: { stat, threshold, value: value ?? 0, passed } };
    }

    // Filter choices by flag condition, item requirements, and melphin threshold
    const gs = this.state.getState();
    const visibleChoices = (node.choices ?? []).filter(c => {
      if (c.condition && !this.state.flags.evaluate(c.condition)) return false;
      if (c.itemCondition?.length && !this.meetsItemCondition(c.itemCondition, gs)) return false;
      if (c.minMelphin !== undefined && gs.player.melphin < c.minMelphin) return false;
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
    if (effects.grantIntelId) {
      this.state.addIntel(effects.grantIntelId);
    }
  }

  /** 玩家是否持有所有指定未失效物品 */
  private meetsItemCondition(reqs: ItemRequirement[], gs: Readonly<import('../types').GameState>): boolean {
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
