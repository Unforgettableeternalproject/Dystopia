# Lore Editor — 設計與實作計畫

> 狀態：計畫中  
> 優先分支：`feature/lore-editor`  
> 目標：為所有 lore JSON 實體提供 GUI 編輯介面，取代手動寫 JSON

---

## 1. 目標與範圍

### 解決的痛點

| 問題 | 現狀 | 目標 |
|---|---|---|
| 手動維護大量 JSON | 容易打錯 ID、忘記同步 index | Form 表單 + EntityPicker |
| 跨實體引用無法驗證 | 直到遊戲跑才發現 broken ref | 即時驗證 + 警告 |
| 新增實體需要查 schema | 每次都要對照 `_schema.json` | 精靈（Wizard）引導 |
| 不知道一個 event 被哪些地方用到 | 要全域搜尋 | 自動反向引用面板 |

### 不在範圍內

- 視覺化節點圖（encounter/dialogue 的 graph view）→ M4+ 再評估
- 直接在遊戲 runtime 編輯（編輯器與 runtime 完全分離）
- 自動 AI 生成 lore 內容

---

## 2. 架構決策

### 2.1 視窗模式

跟隨現有 `/console` 視窗完全相同的模式：

```typescript
// 在 DebugPanel 新增按鈕，照 openConsoleWindow 複製
async function openLoreEditorWindow() {
  if (IS_TAURI) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel('lore-editor');
    if (existing) { await existing.setFocus(); return; }
    new WebviewWindow('lore-editor', {
      url: '/lore',
      title: 'Lore Editor',
      width: 1280,
      height: 800,
      resizable: true,
      decorations: true,
    });
  } else {
    window.open('/lore', 'lore_editor', 'width=1280,height=800,resizable=yes');
  }
}
```

- **Tauri 模式**：`WebviewWindow('lore-editor', { url: '/lore' })`
- **瀏覽器模式**：`window.open('/lore', ...)`
- **路由**：新增 `src/routes/lore/+page.svelte`

### 2.2 檔案 I/O

使用已安裝的 `@tauri-apps/plugin-fs`（console 已在用 `writeTextFile`），不需要新的 Rust command：

```typescript
import { readTextFile, writeTextFile, readDir, remove } from '@tauri-apps/plugin-fs';
```

安全性：編輯器只操作 `lore/` 目錄，path 必須通過前綴驗證。

### 2.3 編輯器 LoreIndex（與 runtime 完全分離）

編輯器建立自己的輕量索引，**不依賴遊戲的 `LoreVault`**：

```typescript
// src/lib/lore-editor/LoreIndex.ts
export class LoreIndex {
  entities: Map<string, LoreEntity>   // id → entity + metadata
  byType: Map<EntityType, LoreEntity[]>
  reverseRefs: Map<string, RefEntry[]> // id → 哪些 entity 引用了它
  brokenRefs: RefEntry[]               // 引用了不存在 ID 的清單

  async loadAll(loreBasePath: string): Promise<void>  // 掃描所有 JSON
  getById(id: string): LoreEntity | undefined
  getByType(type: EntityType): LoreEntity[]
  whoReferences(id: string): RefEntry[]               // 反向查找
  validateAll(): BrokenRef[]
}
```

### 2.4 UI 框架

- 純 Svelte（不引入新 UI 庫）
- 跟遊戲 UI 共用 CSS 變數（`var(--bg-primary)` 等），但用不同 layout
- 編輯器不 import 任何遊戲 runtime 模組（GameController, StateManager 等）

---

## 3. 實體類型總覽

| 類型 | 每檔案 | 跨引用複雜度 | 編輯頻率 |
|---|---|---|---|
| Location | 單實體 + 子位置遞迴 | 高（connections, npcIds, eventIds, propIds） | 高 |
| NPC | 單實體 | 中（schedule, dialogueRules, factionId） | 高 |
| Event | 單實體 | 高（condition 條件系統 + outcomes + encounterId） | 高 |
| Encounter | 單實體 | 最高（nodes 圖 + 每節點 effects + choices） | 高 |
| Dialogue | 單實體 | 高（nodes + triggers + contextSnippets） | 高 |
| Quest | 單實體 | 中（stages map + objectives + eventId refs） | 中 |
| Item | 單實體 | 低（主要被引用，自身引用少） | 中 |
| Prop | 單實體 | 低（被 location.propIds 引用） | 高 |
| Faction | 單實體 | 低（relations × factionId） | 低 |
| Flag Manifest | 陣列（多 flag per 檔案） | 低（proximity filters） | 低 |
| District | 單實體 | 低 | 低 |

---

## 4. Milestone 計畫

---

### Milestone 1 — 基礎架構

> **目標**：可以開視窗、載入所有 lore、用 raw JSON viewer 瀏覽任何實體

#### Story 1.1 — 視窗入口

- `DebugPanel.svelte` 新增「Lore Editor」按鈕
- 實作 `openLoreEditorWindow()`（照 console 模式）
- 新增 `src/routes/lore/+page.svelte`（空頁面 + 標題即可）

#### Story 1.2 — LoreIndex 核心

- `src/lib/lore-editor/LoreIndex.ts`
- 掃描 `lore/` 下所有 JSON，依類型分類
- 建立 `id → entity` 查找表
- 建立 reverse reference map（掃描所有已知的引用欄位，詳見§5）
- 回傳 broken refs 清單

#### Story 1.3 — Editor Shell UI

- 左側：實體類型選擇器 + 搜尋過濾框 + 實體列表
- 右側：主編輯區（此 milestone 為 raw JSON viewer/editor，用 `<textarea>`）
- 底部 status bar：載入狀態、broken ref 數量
- Region 切換（目前只有 crambell，但結構要支援未來多 region）

#### Story 1.4 — 基礎讀寫

- 點擊實體 → 讀入 JSON → 顯示在 raw editor
- 儲存按鈕 → `writeTextFile` 寫回
- 新增檔案：輸入 filename → 寫入空 template
- 刪除（有 reverse ref 則警告）

---

### Milestone 2 — 各實體 Form 編輯器

> **目標**：每種實體都有結構化 Form，不需要手動寫 JSON

#### 共用元件（M2 開始前先實作）

**`EntityPicker.svelte`**
```
Props: type: EntityType, value: string, onChange
UI: 搜尋式下拉 → 顯示 id + name，選取後回傳 id
```

**`ConditionEditor.svelte`**  
Event/Encounter/Dialogue 的觸發條件共用此元件：
```
欄位：flags[], anyFlags[], notFlags[], timePeriods[], timeRanges[],
       npcIds[], questActiveId, itemRequirements[], minStats{},
       cooldownMinutes, triggerChance, minMelphin,
       minReputation{}, maxReputation{}, minAffinity{}, maxAffinity{}
UI：折疊式，只顯示非空欄位，有「+ 新增條件」
```

**`EffectsEditor.svelte`**  
Encounter choices / Event outcomes 的效果共用此元件：
```
欄位：flagsSet[], flagsUnset[], statChanges{}, melphinChange,
       grantItems[], grantQuestId, startEncounterId, movePlayer,
       reputationChanges{}, affinityChanges{}, applyConditionId,
       removeConditionIds[], advanceQuestStage, completeQuestObjective,
       failQuestId, skillExpChanges{}, characterExpGrant, npcFlagsSet{}
UI：折疊式分組（旗標/數值/物品/任務/移動/聲望）
```

**`ArrayEditor.svelte`**  
通用陣列元件，支援 add/remove/drag reorder。

---

#### Story 2.1 — Prop 編輯器（最簡單，先熱身）

欄位：`id`, `name`, `description`, `tags[]`, `checkPrompt`（多行 textarea）

#### Story 2.2 — Item 編輯器

欄位：`id`, `name`, `type`（select）, `description`, `obtainedFrom[]`  
依 type 顯示子表單：
- `consumable`：effect（statusChanges, applyCondition, flagsSet）, useNarrative
- `equipment`：statBonus{} 
- `key`：variants[]（id/label/description per variant）, expiresAfterMinutes
- `info`：content（大 textarea）

#### Story 2.3 — Faction 編輯器

欄位：`id`, `name`, `regionId`（EntityPicker）, `description`, `defaultReputation`, `relations[]`（EntityPicker × factionId + weight）

#### Story 2.4 — Quest 編輯器

結構：stages map（展開式列表）
- 每個 stage：`id`, `description`, `objectives[]`（type/description/flag）, `failCondition`, `onFail`（nextStageId + startEventId EntityPicker）, `onComplete`（flagsSet[], nextStageId）

#### Story 2.5 — Location 編輯器（中複雜度）

結構：`base` + `sublocations[]` 遞迴（展開/折疊）  
每個 location node：
- 基本：`id`, `name`, `description`, `ambience[]`, `tags[]`, `isAccessible`
- `npcIds[]`（EntityPicker × npcId）
- `eventIds[]`（EntityPicker × eventId）  
- `propIds[]`（EntityPicker × propId）
- `connections[]`：targetLocationId（EntityPicker）+ description + access conditions（ConditionEditor）
- `localVariants[]`（條件式敘述覆蓋）

#### Story 2.6 — NPC 編輯器（中複雜度）

欄位：`id`, `name`, `defaultLocationId`（EntityPicker）, `factionId`（EntityPicker）, `publicDescription`  
子區塊：
- `secretLayers[]`：id/label/condition/context
- `schedule[]`：id/label/locationId（EntityPicker）/timePeriods[]/condition
- `dialogueId`（EntityPicker × dialogueId）
- `dialogueRules[]`：id/label/condition/dialogueId（EntityPicker）/priority
- `questIds[]`（EntityPicker × questId）

#### Story 2.7 — Flag Manifest 編輯器

陣列編輯：每個 FlagManifestEntry：
- `flagId`（可手動輸入）
- `description`, `setCondition`, `unsetCondition`
- `proximity`：locationIds[], districtIds[], questIds[], flags[], anyFlags[], notFlags[], timePeriods[]

#### Story 2.8 — Event 編輯器（高複雜度）

結構：
```
id, locationId[] (EntityPicker × locationId), description, isRepeatable
triggerVariants[]（optional，每個有 condition + notificationVariant）
condition → ConditionEditor
outcomes[]（Array）：
  每個 outcome：id, condition（ConditionEditor）, weight, description
                effects → EffectsEditor
```

#### Story 2.9 — Dialogue 編輯器（高複雜度）

結構：
```
id, npcId（EntityPicker）, defaultContext（大 textarea）
nodes（map，展開式列表）：
  每個 node：id
    lines[]：speaker / text
    choices[]：
      id, text, nextNodeId（select 從本 dialogue nodes），
      condition（ConditionEditor）,
      itemRequirements[]（EntityPicker × itemId）,
      effects（EffectsEditor subset：affinity/reputation/flagsSet/grantQuest/grantIntel...）
triggers[]：nodeId / firstMeetingOnly / condition（ConditionEditor）/ probability
contextSnippets[]：label / condition（ConditionEditor）/ context（textarea）
```

#### Story 2.10 — Encounter 編輯器（最高複雜度）

Encounter 有四種 type，UI 依 type 切換：

**`story` type**：
```
script[]（ArrayEditor）：
  每行：speaker / text / effects（EffectsEditor）/ pause
result → EffectsEditor
```

**`event` type**（主要用的）：
```
entryNodeId（select 從 nodes keys）
nodes（map，展開式列表）：
  每個 node：id, dmNarrative, displayText, isOutcome, outcomeType
    statCheck（可選）：stat / threshold / passNodeId / failNodeId
    choices[]：
      id, text, nextNodeId, condition（ConditionEditor）,
      itemRequirements[], minMelphin, minReputation{}, minAffinity{},
      transitionLines[]（speaker/text）,
      branches[]（條件分支 → 不同 nextNodeId）,
      effects（EffectsEditor）
```

**`dialogue` / `combat` / `shop`**：依各自結構展開（M2 先做 story + event）

---

### Milestone 3 — 跨實體功能

> **目標**：讓引用關係可視化、可驗證

#### Story 3.1 — "Used By" 反向引用面板

- 每個實體編輯頁底部：「此實體被以下 N 個對象引用」
- 按類型分組列出，點擊可跳轉
- 資料來源：LoreIndex.reverseRefs

#### Story 3.2 — Broken Reference Validator

- 左側欄 broken ref 計數（紅色數字）
- 點開 Validator panel：列出所有 broken ref，分「引用來源 → 斷掉的 ID」
- 點擊跳轉至問題實體

#### Story 3.3 — Region Index 同步工具

- 比較 `crambell/index.json` 中的 locationIds/npcIds/questIds 等 arrays 與實際檔案
- 顯示 diff（多了/少了哪些 ID）
- 一鍵 apply sync

---

### Milestone 4 — 生產力功能

> **目標**：讓新增實體、重構 lore 更快

#### Story 4.1 — 新實體精靈（New Entity Wizard）

1. 選擇類型
2. 填入必填欄位（id/name/regionId）
3. 自動產生合規 filename（e.g. `crambell_event_NAME.json`）
4. 寫入磁碟 + 更新 LoreIndex + 提示同步 region index

#### Story 4.2 — 安全刪除

- 刪除前查 reverseRefs
- 若有引用 → 顯示清單：「以下 N 個實體引用了此 ID，確定刪除？」
- 提供選項：只刪除檔案 / 同時清理引用（自動 patch 引用它的檔案）

#### Story 4.3 — Duplicate / Clone

- 複製一個實體為新 id
- 自動產生新 filename
- 適用場景：基於既有 event 快速建立相似的新 event

---

## 5. 引用欄位掃描清單（LoreIndex 建立 reverse map 時需掃描）

LoreIndex 需掃描以下欄位來建立反向引用：

| 欄位路徑 | 指向類型 |
|---|---|
| `event.locationId` | locationId |
| `event.condition.npcIds[]` | npcId |
| `event.condition.questActiveId` | questId |
| `event.condition.itemRequirements[].itemId` | itemId |
| `event.outcomes[].startEncounterId` | encounterId |
| `event.outcomes[].grantQuestId` | questId |
| `event.outcomes[].grantItems[].itemId` | itemId |
| `event.outcomes[].reputationChanges` keys | factionId |
| `event.outcomes[].affinityChanges` keys | npcId |
| `encounter.*.effects.grantQuestId` | questId |
| `encounter.*.effects.grantItems[].itemId` | itemId |
| `encounter.*.effects.movePlayer` | locationId |
| `encounter.*.effects.applyConditionId` | conditionId |
| `encounter.*.effects.advanceQuestStage.questId` | questId |
| `encounter.*.itemRequirements[].itemId` | itemId |
| `dialogue.npcId` | npcId |
| `dialogue.choices[].effects.grantQuest` | questId |
| `npc.defaultLocationId` | locationId |
| `npc.factionId` | factionId |
| `npc.schedule[].locationId` | locationId |
| `npc.dialogueId` | dialogueId |
| `npc.dialogueRules[].dialogueId` | dialogueId |
| `npc.questIds[]` | questId |
| `location.base.connections[].targetLocationId` | locationId |
| `location.base.npcIds[]` | npcId |
| `location.base.eventIds[]` | eventId |
| `location.base.propIds[]` | propId |
| `quest.stages[].onFail.startEventId` | eventId |
| `faction.relations[].targetFactionId` | factionId |

---

## 6. 目錄結構規劃

```
src/
├── routes/
│   └── lore/
│       ├── +page.svelte          # Editor Shell 主頁
│       └── +layout.svelte        # （可選）editor-specific layout
├── lib/
│   └── lore-editor/
│       ├── LoreIndex.ts          # 掃描 + 索引 + reverse refs
│       ├── loreEditorStore.ts    # editor 全局狀態（selected entity、dirty flag 等）
│       ├── entityTypes.ts        # EntityType enum + metadata（displayName, icon, schema hints）
│       ├── fileUtils.ts          # readLoreFile, writeLoreFile, listLoreDir（fs plugin 封裝）
│       └── components/
│           ├── EditorShell.svelte
│           ├── EntityBrowser.svelte       # 左側欄
│           ├── EntityPicker.svelte        # 共用：搜尋式 ID 選擇器
│           ├── ConditionEditor.svelte     # 共用：觸發條件表單
│           ├── EffectsEditor.svelte       # 共用：效果表單
│           ├── ArrayEditor.svelte         # 共用：陣列 add/remove/sort
│           ├── RawJsonEditor.svelte       # fallback：原始 JSON textarea
│           ├── UsedByPanel.svelte         # 反向引用面板
│           ├── BrokenRefPanel.svelte      # 破損引用清單
│           └── editors/
│               ├── PropEditor.svelte
│               ├── ItemEditor.svelte
│               ├── FactionEditor.svelte
│               ├── QuestEditor.svelte
│               ├── LocationEditor.svelte
│               ├── NpcEditor.svelte
│               ├── FlagEditor.svelte
│               ├── EventEditor.svelte
│               ├── DialogueEditor.svelte
│               └── EncounterEditor.svelte
```

---

## 7. 實作順序建議

```
M1 完整（架構先行）
  └── M2 共用元件（EntityPicker / ConditionEditor / EffectsEditor / ArrayEditor）
        ├── M2 簡單編輯器（Prop → Item → Faction → Quest → Flag）
        ├── M2 中複雜度（Location → NPC）
        └── M2 高複雜度（Event → Dialogue → Encounter）
              └── M3（反向引用 → Validator → Index Sync）
                    └── M4（Wizard → 安全刪除 → Clone）
```

M2 共用元件一定要先做，因為後面 8 個編輯器都依賴它們。

---

## 8. 開放問題

| 問題 | 當前傾向 |
|---|---|
| Encounter editor 的 nodes 要不要 visual graph？ | M2 先做 list 展開，M4+ 評估 graph |
| 編輯器是否要支援 undo/redo？ | M2 先只做 dirty flag + 離開警告，undo 延後 |
| 多 region 支援？ | 架構設計要支援，但 M1-M3 聚焦 crambell |
| 是否需要 Git 整合（commit from editor）？ | 不做，保持 Git 工作流獨立 |
