// Dialogue profile types.
// Dialogue is DM-generated, NOT scripted line by line.
// A DialogueProfile provides the context the DM needs to conduct an NPC conversation.
//
// Structure:
//   initialContext  → injected on first meeting (interactionCount === 0)
//   defaultContext  → always injected (NPC personality, speech style, current disposition)
//   milestones      → flag-triggered context blocks; permanent ones enter NPC long-term memory

// ── Attitude ─────────────────────────────────────────────────────

/**
 * 玩家對某 NPC 的態度，從 DM 的 <<NPC>> 信號更新。
 * 影響 DM 在生成對話時對玩家行為的詮釋方式。
 */
export type PlayerAttitude = 'friendly' | 'neutral' | 'cautious' | 'hostile';

// ── Milestone ─────────────────────────────────────────────────────

/**
 * 對話里程碑。
 * 當 condition 旗標表達式為 true 時，context 被注入 DM 的對話 context。
 * isPermanent = true 時，一旦觸發就永久進入 NPC 記憶（NPC 不會忘記）。
 */
export interface DialogueMilestone {
  id: string;
  /** 設計備注：這個里程碑代表什麼事件（不進 prompt） */
  label: string;
  /** 旗標運算式；為 true 時此 milestone 被啟動 */
  condition: string;
  /**
   * DM-facing context。
   * 描述在此里程碑條件下 NPC 知道什麼、感受什麼、打算怎麼應對玩家。
   */
  context: string;
  /**
   * 是否為永久里程碑。
   * true = 一旦觸發，DM 信號 <<MILESTONE: id>> 確認後，此 context 的摘要
   * 永久記錄在 NPCMemoryEntry.permanentMilestoneIds，未來對話始終包含。
   */
  isPermanent: boolean;
  /**
   * 永久記憶摘要。
   * isPermanent = true 時使用，是比完整 context 更簡短的一句話摘要，
   * 用於未來對話的「NPC 永久記憶」區塊。
   */
  permanentSummary?: string;
}

// ── Profile ────────────────────────────────────────────────────────

/**
 * NPC 的對話 context 提供者。
 * 每個 NPC 一份，存於 lore/.../dialogues/<dialogueId>.json。
 * dialogueId 對應 NPCNode.dialogueId（也可有 phaseOverride 版本）。
 */
export interface DialogueProfile {
  /** 對應 NPCNode.dialogueId 的 profile ID */
  id: string;
  npcId: string;

  /**
   * 初始對話 context。
   * 只在 NPCMemoryEntry.interactionCount === 0 時注入。
   * 描述 NPC 第一次遇到陌生人的態度與行為傾向。
   */
  initialContext: string;

  /**
   * 預設 context。
   * 每次對話都注入。描述 NPC 的說話方式、當前角色身份與一般互動傾向。
   */
  defaultContext: string;

  /**
   * 里程碑列表。
   * 每次對話時，系統過濾出 condition 為 true 的里程碑並注入其 context。
   * 已成為永久記憶的里程碑改用 permanentSummary 注入。
   */
  milestones: DialogueMilestone[];
}
