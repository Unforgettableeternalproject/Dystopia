# Condition System Reference

本文件記錄 Dystopia 中所有條件判斷的結構、使用場景與欄位對照。
維護者在新增或修改條件相關邏輯時，應同步更新本文件與對應的 `_schema.json`。

---

## 條件結構總覽

專案中存在 4 種條件結構，各自負責不同場景：

| 結構 | 用途 | 定義檔 |
|---|---|---|
| `ConnectionAccess` | 通道進入、地點進入 (`accessCondition`)、Props 可見性 (`visibleWhen`) | `src/lib/types/world.ts` |
| `EventCondition` | 事件觸發條件 | `src/lib/types/world.ts` |
| `QuestFailCondition` | 任務/階段失敗條件 | `src/lib/types/quest.ts` |
| 散裝欄位 | 對話選項前置條件、遭遇選項前置條件 | `src/lib/types/dialogue.ts`, `src/lib/types/encounter.ts` |

---

## 判斷類型完整對照表

| 判斷類型 | ConnectionAccess | EventCondition | QuestFailCondition | Dialogue Choice | Encounter Choice |
|---|---|---|---|---|---|
| 旗標 | `flag` (表達式) | `flags[]` / `anyFlags[]` / `notFlags[]` | `flags[]` / `anyFlags[]` | `condition` (表達式) | `condition` (表達式) |
| 時段 | `timePeriods[]` | `timePeriods[]` | -- | -- | -- |
| 時鐘範圍 | `timeRanges[]` | -- | -- | -- | -- |
| 日期時間 | `dateTimeConditions[]` | `dateTimeConditions[]` | -- | `dateTimeConditions[]` | `dateTimeConditions[]` |
| 觸發整點 | -- | `triggerHours[]` | `triggerHours[]` | -- | -- |
| 情報/知識 | `knowledgeIds[]` | -- | -- | `knowledgeIds[]` | -- |
| 任務階段 | `questStages[]` | `questActiveId` + `questStageId` | -- | -- | -- |
| 物品持有 | `itemRequirements[]` | `itemRequirements[]` | -- | `itemRequirements[]` | `itemRequirements[]` |
| 反向物品 | -- | `notItemIds[]` | -- | -- | -- |
| 梅分門檻 | `minMelphin` | `minMelphin` | -- | `minMelphin` | `minMelphin` |
| 聲望下限 | -- | `minReputation{}` | -- | `minReputation{}` | `minReputation{}` |
| 聲望上限 | -- | `maxReputation{}` | -- | `maxReputation{}` | `maxReputation{}` |
| 好感下限 | -- | `minAffinity{}` | -- | `minAffinity{}` | `minAffinity{}` |
| 好感上限 | -- | `maxAffinity{}` | -- | `maxAffinity{}` | `maxAffinity{}` |
| 數值門檻 | -- | `minStats{}` | -- | -- | -- |
| 事件計數器 | -- | `min/max/exactEventCounters` | -- | -- | -- |
| NPC 在場 | -- | `npcIds[]` | -- | -- | -- |
| 冷卻 | -- | `cooldownMinutes` | -- | -- | -- |
| 機率 | -- | `triggerChance` | -- | -- | -- |
| 繞過 | `bypass{}` | -- | -- | -- | -- |

---

## 各結構詳細說明

### 1. ConnectionAccess

**使用位置：**
- `LocationConnection.access` — 通道進入條件
- `LocationBase.accessCondition` — 地點動態進入條件
- `PropNode.visibleWhen` — Props 可見性條件

**運算邏輯：** 所有設定的欄位為 AND 關係，全部滿足才通過。

**欄位：**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `flag` | `string` | 旗標表達式，支援 `&`, `\|`, `!` 運算子 |
| `timePeriods` | `TimePeriod[]` | 僅在這些時段開放（`work` / `rest` / `special`） |
| `timeRanges` | `GameTimeRange[]` | 精確時鐘範圍（陣列內 OR），支援跨午夜 |
| `dateTimeConditions` | `GameDateTimeCondition[]` | 進階日期時間條件（陣列內 OR）。支援 `before` / `after` / `between`，可同時考量日期（年月日）與時刻（時分），各欄位皆可省略（省略視為 0） |
| `knowledgeIds` | `string[]` | 玩家需擁有所有指定情報（AND） |
| `questStages` | `QuestStageRef[]` | 玩家在指定任務階段時開放（陣列內 OR） |
| `itemRequirements` | `ItemRequirement[]` | 玩家需持有所有指定物品（AND） |
| `minMelphin` | `number` | 最低梅分門檻 |
| `lockedMessage` | `string` | 條件不滿足時的提示文字 |
| `bypass` | `ConnectionBypass` | 繞過條件（OR 覆蓋 AND），見下方 |

**ConnectionBypass（繞過條件）：**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `flag` | `string` | 旗標表達式，true 時繞過 |
| `knowledgeIds` | `string[]` | 持有任一情報即繞過（OR） |
| `itemRequirements` | `ItemRequirement[]` | 持有任一物品即繞過（OR） |
| `bypassMessage` | `string` | DM context：繞過時的提示語 |
| `timePenaltyMinutes` | `number` | 繞過時的額外時間消耗 |

**引擎實作：** `LoreVault.evaluateAccessCondition()` (`src/lib/lore/LoreVault.ts`)

---

### 2. EventCondition

**使用位置：** `GameEvent.condition` — 事件觸發條件

**運算邏輯：** 所有設定的欄位為 AND 關係。`triggerChance` 在所有條件通過後額外擲骰。

**欄位：**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `flags` | `string[]` | 所有旗標必須存在（AND） |
| `anyFlags` | `string[]` | 至少一個旗標存在（OR） |
| `notFlags` | `string[]` | 所有旗標必須不存在（AND） |
| `minStats` | `Record<string, number>` | 數值門檻，dot-path 格式 |
| `timePeriods` | `TimePeriod[]` | 限定觸發時段 |
| `cooldownMinutes` | `number` | 重複觸發的冷卻（遊戲內分鐘） |
| `npcIds` | `string[]` | 至少一個 NPC 在場（OR） |
| `triggerHours` | `number[]` | 時鐘跨越這些整點時觸發 |
| `questActiveId` | `string` | 指定任務需進行中 |
| `questStageId` | `string` | 指定任務階段（需搭配 `questActiveId`） |
| `minEventCounters` | `Record<string, number>` | 計數器最小值門檻 |
| `maxEventCounters` | `Record<string, number>` | 計數器最大值門檻 |
| `exactEventCounters` | `Record<string, number>` | 計數器精確值 |
| `itemRequirements` | `ItemRequirement[]` | 物品持有需求（AND） |
| `notItemIds` | `string[]` | 反向物品條件（持有任一則封鎖） |
| `minMelphin` | `number` | 最低梅分門檻 |
| `minReputation` | `Record<string, number>` | 派系聲望下限（AND），key = factionId |
| `maxReputation` | `Record<string, number>` | 派系聲望上限（AND），key = factionId |
| `minAffinity` | `Record<string, number>` | NPC 好感下限（AND），key = npcId |
| `maxAffinity` | `Record<string, number>` | NPC 好感上限（AND），key = npcId |
| `dateTimeConditions` | `GameDateTimeCondition[]` | 進階日期時間條件（陣列內 OR） |
| `triggerChance` | `number` | 觸發機率 0--1（條件通過後擲骰） |

**引擎實作：** `EventEngine.canTrigger()` (`src/lib/engine/EventEngine.ts`)

---

### 3. QuestFailCondition

**使用位置：**
- `QuestDefinition.failCondition` — 任務全域失敗條件（任何階段）
- `QuestStage.failCondition` — 階段專屬失敗條件

**欄位：**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `triggerHours` | `number[]` | 跨越整點時觸發失敗檢查 |
| `flags` | `string[]` | 所有旗標存在時失敗（AND） |
| `anyFlags` | `string[]` | 任一旗標存在時失敗（OR） |

**引擎實作：** `QuestEngine.checkFailConditions()` (`src/lib/engine/QuestEngine.ts`)

---

### 4. 對話選項前置條件（Dialogue Choice Pre-conditions）

**使用位置：** `ScriptedChoice` — 對話樹選項

**運算邏輯：** 所有設定的欄位為 AND 關係，任一失敗則隱藏選項。

**欄位：**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `condition` | `string` | 旗標表達式 |
| `knowledgeIds` | `string[]` | 所有情報必須已知（AND） |
| `itemRequirements` | `ItemRequirement[]` | 所有物品必須持有（AND） |
| `minMelphin` | `number` | 最低梅分門檻 |
| `minReputation` | `Record<string, number>` | 派系聲望下限（AND），key = factionId |
| `maxReputation` | `Record<string, number>` | 派系聲望上限（AND），key = factionId |
| `minAffinity` | `Record<string, number>` | NPC 好感下限（AND），key = npcId |
| `maxAffinity` | `Record<string, number>` | NPC 好感上限（AND），key = npcId |
| `dateTimeConditions` | `GameDateTimeCondition[]` | 進階日期時間條件（陣列內 OR） |

**引擎實作：** `DialogueManager.filterChoices()` (`src/lib/engine/DialogueManager.ts`)

---

### 5. 遭遇選項前置條件（Encounter Choice Pre-conditions）

**使用位置：** `EncounterChoice` — 遭遇選項

**運算邏輯：** 所有設定的欄位為 AND 關係，任一失敗則隱藏選項。

**欄位：**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `condition` | `string` | 旗標表達式 |
| `itemRequirements` | `ItemRequirement[]` | 所有物品必須持有（AND） |
| `minMelphin` | `number` | 最低梅分門檻 |
| `minReputation` | `Record<string, number>` | 派系聲望下限（AND），key = factionId |
| `maxReputation` | `Record<string, number>` | 派系聲望上限（AND），key = factionId |
| `minAffinity` | `Record<string, number>` | NPC 好感下限（AND），key = npcId |
| `maxAffinity` | `Record<string, number>` | NPC 好感上限（AND），key = npcId |
| `dateTimeConditions` | `GameDateTimeCondition[]` | 進階日期時間條件（陣列內 OR） |

**引擎實作：** `EncounterEngine.advanceTo()` (`src/lib/engine/EncounterEngine.ts`)

---

## 命名統一紀錄

以下命名不一致已於 2026-04-23 統一修正：

| 概念 | 統一名稱 | 舊名（已移除） |
|---|---|---|
| 時段條件 | `timePeriods` | `timePeriod`（已全部修正：型別、schema 註解、文件） |
| 物品需求 | `itemRequirements` | `itemRequired`（Dialogue）, `itemCondition`（Encounter） |
| 知識需求 | `knowledgeIds` | `knowledgeRequired`（Dialogue） |

---

## Schema 與引擎對照

每個 `_schema.json` 應完整記錄該實體類型所有引擎支援的欄位。

| Schema 檔案 | 對應引擎型別 |
|---|---|
| `locations/_schema.json` | `LocationNode`, `LocationBase`, `ConnectionAccess`, `ConnectionBypass` |
| `events/_schema.json` | `GameEvent`, `EventCondition`, `EventOutcome` |
| `encounters/_schema.json` | `EncounterDefinition`, `EncounterNode`, `EncounterChoice`, `EncounterStatCheck` |
| `dialogues/_schema.json` | `DialogueProfile`, `ScriptedNode`, `ScriptedChoice`, `ContextSnippet` |
| `quests/_schema.json` | `QuestDefinition`, `QuestStage`, `QuestFailCondition`, `QuestObjective` |
| `npcs/_schema.json` | `NPCNode` |
| `flags/_schema.json` | `FlagManifestEntry` |
| `props/_schema.json` | `PropNode` |

**規則：** 新增或修改引擎中的條件欄位時，必須同步更新對應的 `_schema.json`。
