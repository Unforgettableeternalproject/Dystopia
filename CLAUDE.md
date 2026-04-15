# Dystopia — Claude Collaboration Guide

這個專案是一款由 LLM 驅動的劇場式互動 RPG 遊戲，以 Tauri + Svelte (TypeScript) 為技術棧，
並使用 Anthropic SDK 作為 DM 與規制器的推論後端。

---

## Project Structure

```
Dystopia/
├── src/                     # 前端：Svelte + TypeScript
│   ├── lib/
│   │   ├── components/      # UI 元件 (NarrativeBox, ChoicePanel, 等)
│   │   ├── engine/          # 遊戲引擎 (StateManager, FlagSystem, EventBus)
│   │   ├── ai/              # AI 整合 (DMAgent, Regulator, AnthropicClient)
│   │   ├── lore/            # Lore Vault 存取層
│   │   └── types/           # TypeScript 型別定義
│   └── routes/              # SvelteKit 頁面路由
├── src-tauri/               # Tauri 設定與 Rust shell
├── lore/                    # 設定資料庫 (JSON)
│   ├── world/               # 全域世界觀資料
│   ├── campbell/            # 三區坎貝爾專屬資料
│   └── items/               # 道具資料
└── docs/                    # 設計文件
```

---

## File Search

**Use the FFF MCP tools** (`mcp__fff__find_files`, `mcp__fff__grep`, `mcp__fff__multi_grep`) for file and code search — they are faster and frecency-ranked.

- `grep` → search file **contents** (definitions, usages, patterns)
- `find_files` → find a file by name when you don't have a specific identifier
- `multi_grep` → OR logic across multiple patterns (e.g., camelCase + snake_case variants)

> **KNOWN LIMITATION — `grep` query must not include filenames.**
> Combining a filename (e.g. `gameState.ts`) with a search term in a single `grep` query causes the tool to hang with no output.
>
> Correct approach when searching within a specific file:
> 1. Use `grep` with the identifier only → `grep "playerStats"`
> 2. FFF will rank the target file by frecency; the correct file typically appears first.
> 3. If there are too many results, use `Read` to inspect the target file directly.
> 4. Do not use '.' character when searching with multiple patterns, as it may be interpreted as a regex wildcard and cause the tool to hang.

Load tools via `ToolSearch` before calling them:
```
ToolSearch: select:mcp__fff__find_files
ToolSearch: select:mcp__fff__grep
ToolSearch: select:mcp__fff__multi_grep
```

---

## Git Conventions

### Branch Strategy (Git Flow)

```
main          ← 穩定版本，Tag 後綴 -stable，禁止直接推送
  └── release/*     ← 發布候選，Tag 後綴 -beta 或 -rc
        └── develop       ← 開發主線，Tag 後綴 -dev (選用)
              ├── feature/*    ← 新功能開發
              └── fix/*        ← Bug 修復
hotfix/*      ← 從 main 建立的緊急修補，Tag 後綴 -hotfix#
```

| 分支類型 | 命名規範 | 來源 | 目標 |
|---|---|---|---|
| `feature/*` | `feature/功能簡短描述` | develop | develop |
| `fix/*` | `fix/問題描述` 或 `fix/issue-編號` | develop | develop |
| `hotfix/*` | `hotfix/問題描述` | main | main + develop |
| `release/*` | `release/v主版號.次版號.修訂號` | develop | main + develop |

### Commit Message Format

```
[類型]: 簡短描述 (50 字元內). MM-DD

詳細說明 (選填，72 字元換行)
- 變更項目 1
- 變更項目 2
- 背景說明或設計決策

Closes #123
Related to #456
```

**Commit 類型：**

| 類型 | 說明 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修復 |
| `docs` | 文件更新 |
| `style` | 程式碼格式 |
| `refactor` | 程式碼重構 |
| `test` | 測試相關 |
| `chore` | 建置或工具 |

**範例：**
```
[feat]: 實作規制器動作驗證邏輯. 04-15

- 新增 ActionValidator 類別
- 整合玩家數值邊界檢查
- 拒絕能力範圍外的動作並回傳原因

Closes #12
```

### PR Title Format

```
[類型] - [來源分支] -> [目標分支] : 簡短描述
```

**範例：**
```
[feat] - feature/dm-agent -> develop : 實作 DM 敘述串流
[fix] - fix/lore-index -> develop : 修正 Lore Vault 索引查詢錯誤
```

---

## Architecture Notes

### Core AI Flow

```
玩家輸入
  → Regulator (驗證動作是否在能力範圍內)
  → GameEngine (更新狀態、查詢 Lore Vault、觸發事件/旗標)
  → DM (將結構化場景資料轉為敘述文字，串流輸出)
  → UI (NarrativeBox + ThoughtBubble 建議動作)
```

### Lore Vault 原則

- DM 不自行創造世界，只傳達 Lore Vault 中已定義的內容
- 每個地點、NPC、事件都是有索引的 JSON 節點
- DM 的 system prompt 必須包含當前場景相關的 lore 子集，不傳入整個 vault

### 規制器原則

- 動作合法性由玩家數值邊界決定，不依賴 LLM 主觀判斷
- 拒絕時應提供原因，可作為 Thought 的一部分回傳給玩家

---

## Key Types (參考)

- `GameState` — 完整遊戲狀態快照
- `PlayerState` — 玩家位置、數值、旗標、外部聲望
- `LocationNode` — 地點資料，含連接地點與可用 NPC
- `NPCNode` — NPC 資料，含類型（據點/任務/遊歷）與當前狀態
- `GameEvent` — 事件資料，含觸發條件與旗標變化
