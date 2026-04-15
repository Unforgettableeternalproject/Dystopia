# Architecture Overview

> 本文件描述 Dystopia 遊戲引擎的核心架構設計。

## Core Flow

```
玩家輸入（自由文字 or Thought 選擇）
        ↓
  ┌─────────────┐
  │  Regulator  │  ← 讀取 PlayerState，判斷動作是否在能力範圍內
  └─────────────┘
    ↓ 允許/修正/拒絕
  ┌─────────────┐
  │ GameEngine  │  ← 查詢 LoreVault，更新 StateManager，觸發 FlagSystem
  └─────────────┘
        ↓ 結構化場景資料
  ┌─────────────┐
  │   DMAgent   │  ← 將場景資料轉為敘述文字（串流）
  └─────────────┘
        ↓
  ┌─────────────┐
  │     UI      │  NarrativeBox（打字機效果） + ThoughtBubble（建議動作）
  └─────────────┘
```

## Module Responsibilities

### LoreVault (`src/lib/lore/LoreVault.ts`)
- 從 JSON 載入世界設定資料
- 提供地點、NPC、事件、派系的索引查詢
- 為 DM 組合當前場景的 lore 子集（`buildSceneContext`）
- **原則：DM 只從這裡取資料，不自行創造**

### StateManager (`src/lib/engine/StateManager.ts`)
- 持有 `GameState` 的單一來源
- 所有狀態變更必須透過此類進行
- 透過 EventBus 廣播狀態更新

### FlagSystem (`src/lib/engine/FlagSystem.ts`)
- 管理遊戲旗標（任務進度、事件觸發紀錄）
- 支援條件表達式評估（`flag1 & flag2 | flag3`）
- 旗標只是字串 ID，語義由 Lore 資料定義

### EventBus (`src/lib/engine/EventBus.ts`)
- 發布/訂閱系統，用於引擎模組解耦
- 主要事件：`state:updated`、`flag:set`、`location:changed`、`narrative:stream`

### Regulator (`src/lib/ai/Regulator.ts`)
- **硬邊界**：純數值判斷（不需 LLM），例如體力歸零禁止戰鬥
- **語意層**：LLM 解析玩家輸入的意圖，判斷是否合理
- 拒絕時提供世界觀語言的理由，不暴露數值細節

### DMAgent (`src/lib/ai/DMAgent.ts`)
- 接收結構化場景資料 + 玩家動作 + 歷史記錄
- 串流輸出敘述文字（打字機效果）
- System prompt 嚴格限制 DM 只能描述已知資料

### AnthropicClient (`src/lib/ai/AnthropicClient.ts`)
- 封裝 Anthropic SDK
- `complete()` — 單次呼叫（規制器用）
- `stream()` — 串流呼叫（DM 用）

## Data Flow: Lore JSON Format

每個 JSON 檔案對應一個資料類型，以 ID 為 key：

```json
// lore/campbell/locations.json
{
  "delth_bunkhouse": {
    "id": "delth_bunkhouse",
    "name": "戴司 — 公有宿舍",
    "regionId": "campbell",
    "description": "...",
    "ambience": "壓抑、疲憊、沉默",
    "connections": [...],
    "npcIds": ["foreman_grey"],
    "eventIds": ["morning_quota_check"],
    "isDiscovered": false
  }
}
```

## State Shape

```typescript
GameState {
  player: PlayerState {
    primaryStats: { strength, knowledge, talent, spirit, luck }
    secondaryStats: { consciousness, arcane, technology }
    statusStats: { stamina, stress, mana, experience }
    externalStats: { reputation, affinity, familiarity }
    activeFlags: Set<string>
    currentLocationId: string
  }
  turn: number
  phase: GamePhase
  pendingThoughts: Thought[]
  history: HistoryEntry[]  // 最近 20 筆
}
```

## MVP Scope (Sprint 1 目標)

- [ ] 單一起始場景（坎貝爾：戴司象限宿舍）
- [ ] DM 串流敘述正常運作
- [ ] Regulator 硬邊界 + 語意層判斷
- [ ] 玩家可自由輸入 + Thought 建議
- [ ] 旗標系統可觸發分支
- [ ] 至少一個 NPC 可對話（據點式）
- [ ] 至少一個可達成的結局

## Open Questions

- API key 管理：開發期用 `.env`，打包後如何安全傳遞？
  - 方案 A：Tauri 的 `tauri.conf.json` 環境設定
  - 方案 B：啟動時讓使用者自行輸入
- 歷史記錄的 context 長度管理策略（目前保留最近 20 筆）
- 存檔格式：JSON 序列化 `GameState` 到 Tauri 本地檔案系統
