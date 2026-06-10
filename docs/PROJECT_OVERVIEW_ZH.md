# Dystopia - 專案概覽

## 專案簡介

Dystopia 是一款以 **LLM 驅動的劇場式文字 RPG**，背景設定在命運織者宇宙中。以 Tauri 2 桌面應用搭配 SvelteKit 打造，透過多代理 AI 架構實現連貫的桌上型 RPG 敘事——DM 代理負責敘事生成、Regulator 驗證玩家行動是否符合數值邊界、Judge 驗證 DM 的約束合規性。遊戲具備完整引擎系統，包含事件系統、任務管理、骰點機制、對話樹與陣營關係。

### 核心理念
- **敘事沉浸**：沒有傳統遊戲 UI——玩家完全透過散文、腳本遭遇與 NPC 對話體驗世界
- **邏輯一致性**：每個行動在 DM 處理前都由 Regulator 根據角色屬性與世界規則驗證
- **世界觀驅動上下文**：DM 只接收場景相關的 Lore 片段，在維持世界一致性的同時高效使用 token
- **湧現式遊戲性**：以旗標驅動的事件系統搭配條件（時間、聲望、道具、NPC 在場）創造動態世界反應

---

## 我的職責

作為本專案唯一開發者，我負責：

### 系統架構設計
- 設計多代理 AI 架構：DM（雙階段敘事）→ Regulator（行動驗證）→ Judge（約束驗證）
- 規劃完整遊戲引擎搭配事件觸發、任務生命週期、遭遇流程與狀態管理
- 設計結構化 JSON 資料的 Lore Vault 系統（地點、NPC、事件、遭遇、任務、場景物件、道具、情報）

### 核心引擎實作
- **GameController**：主回合管線——Regulator 驗證 → 事件觸發 → DM 敘述 → 任務檢查 → UI 同步
- **EventEngine**：完整觸發系統，支援旗標條件、時段條件、機率、NPC 在場、道具持有、聲望門檻、冷卻時間
- **QuestEngine**：完整任務生命週期（授予/推進/完成/失敗/放棄/計時）
- **DialogueManager**：腳本對話樹 + LLM 驅動的動態對話
- **EncounterEngine**：結構化遭遇流程搭配故事型遭遇
- **DiceEngine**：DnD 風格骰點系統（1d20、優勢/劣勢、屬性修正 = floor((stat-8)/3)）
- **ExperienceEngine**：技能 XP 系統（1–20 等級搭配傾向機制）
- **TimeManager / PhaseManager / FlagSystem / RestResolver**：支援系統

### AI 層
- **DMAgent**：雙階段架構——Phase 1 產生意圖 JSON，Phase 2 串流敘事散文
- **Regulator**：根據數值邊界與世界規則驗證玩家行動
- **JudgeAgent**：獨立驗證 DM Phase 1 輸出的約束合規性
- **多後端支援**：Anthropic Claude（主要）、HuggingFace、本地模型支援

### 世界觀建構（Crambell / 第四象限）
- 10 個地點、6 個 NPC 搭配對話檔、31 個事件、22 個遭遇、10 個任務、18 個場景物件、9 個道具、5 份情報
- 5 條逃脫路線搭配分支劇情與旗標驅動進度
- 路線 1、4、5 的完整故事流程；路線 2、3 規劃於 MVP v2

---

## 核心功能

### 1. 多代理 AI 架構
- **DMAgent**（雙階段）：意圖 JSON 生成 → 搭配場景範圍 Lore 注入的串流敘事散文
- **Regulator**：在 DM 處理前對玩家行動進行數值邊界硬性驗證
- **JudgeAgent**：獨立驗證 DM 約束合規性
- 清晰的職責分離：敘事創意 → 規則執行 → 品質保證

### 2. 完整遊戲引擎
- **回合管線**：玩家輸入 → Regulator → 事件觸發 → DM 敘述 → 任務檢查 → UI 同步
- **事件系統**：31+ 個事件搭配複雜觸發條件（旗標、時間、機率、NPC 在場、道具、聲望）
- **任務系統**：完整生命週期搭配計時任務、多步驟推進、分支追蹤
- **骰點系統**：DnD 風格 1d20 擲骰搭配優勢/劣勢與屬性修正
- **陣營與聲望**：關係追蹤影響 NPC 互動與事件可用性

### 3. 豐富世界資料（Crambell）
- **地點**：宿舍、礦坑、森林、倉庫、巡邏區、傳送點——各有場景物件與觀察互動
- **NPC**：6 個完整塑造的 NPC（Kach、Mildore、Kane、Elowan、Karin、Orland），搭配腳本對話與關係動態
- **故事路線**：5 條設計的礦場逃脫路線，3 條已大幅實作
- **動態事件**：日夜循環、旗標門控進度、冷卻式遭遇

### 4. 27 個 UI 元件
- NarrativePanel、EncounterPanel、ScriptedChoicePanel 用於遊戲進行
- InventoryModal、QuestListModal、QuestDetailModal 用於管理
- MiniMap、RegionMap、TransitMapOverlay 用於導航
- StatCheckOverlay、RestModal、DangerOverlay（瀕危粒子特效）用於機制
- DebugPanel、FactionGraphModal 用於開發

### 5. Tauri 桌面應用
- SvelteKit 前端搭配 TypeScript
- Tauri 2 Rust shell 提供跨平台桌面封裝
- 透過 Tauri API 實現本地檔案系統持久化

---

## 使用技術

### 前端
- **SvelteKit**：搭配 Vite 打包的響應式 UI 框架
- **TypeScript**：型別安全開發
- **Tauri 2**：基於 Rust 的桌面應用框架

### AI / LLM
- **Anthropic SDK**（`@anthropic-ai/sdk`）：Claude 整合用於 DM、Regulator、Judge 代理
- **HuggingFace Client**：替代 LLM 後端
- **NotebookLM**（`notebooklm-client`）：外部世界觀知識庫

### 開發工具
- **Vitest**：24 個測試檔案含路線整合測試
- **pnpm**：套件管理

---

## 專案狀態

### 目前版本：MVP v1（feature/MVP_v1 分支）
- ✅ 完整遊戲引擎（GameController、EventEngine、QuestEngine、EncounterEngine、DiceEngine、ExperienceEngine）
- ✅ 多代理 AI 層（DM 雙階段、Regulator、Judge）
- ✅ 27 個 UI 元件全部實作
- ✅ Crambell 世界資料：10 個地點、6 個 NPC、31 個事件、22 個遭遇、10 個任務
- ✅ 路線一（轉調申請）：可玩
- ✅ 路線四（凱恩雙面間諜）：大部分完成
- 🔄 路線五（凱奇測試 → 奧蘭逃脫）：60-70% 完成
- 🔄 已知旗標邏輯問題（米爾多雷營救死結、許可證旗標缺口）
- ❌ 路線二與三：規劃於 MVP v2

### 測試狀況
- 24 個測試檔案含路線專屬整合測試
- CrambellRoute1/4/5 整合測試
- GameController 事件流與腳本觸發測試
- QuestEngine 生命週期測試

---

## 開發挑戰與成就

### 1. 雙階段 DM 架構
**挑戰**：如何從 LLM 取得結構化遊戲資料（屬性變動、道具授予、NPC 反應），同時產生沉浸式敘事散文？

**解法**：將 DM 拆為兩階段——Phase 1 生成結構化意圖 JSON（屬性變動、旗標、道具），Phase 2 使用該意圖串流文學敘事。Judge 獨立驗證 Phase 1 合規性。

**成果**：遊戲機制與敘事輸出的清晰分離，確保可靠的狀態更新同時保留創意敘事。

### 2. 複雜事件觸發系統
**挑戰**：世界事件需要對數十種條件作出反應——時段、玩家旗標、NPC 在場、道具持有、聲望等級、冷卻時間、機率。

**解法**：建構搭配可組合條件評估的 EventEngine，支援巢套旗標邏輯、時段匹配與多標準閘門。

**成果**：僅 Crambell 就有 31 個事件，創造一個跨多個 session 對玩家選擇產生反應的動態世界。

### 3. 多路線分支敘事
**挑戰**：5 條逃脫路線搭配交叉的 NPC、共享旗標與互斥結果產生指數級複雜度。

**解法**：旗標驅動進度搭配 FlagRegistry manifest、驗證完整路徑的路線整合測試、以及防止死結的精心 NPC 互動設計。

**成果**：三條大幅實作的逃脫路線搭配分支子路徑，由自動化整合測試驗證。

---

## 未來規劃

### MVP v1 剩餘工作
- 完成路線五（凱奇測試三 → 奧蘭最終傳送）
- 修復旗標邏輯問題（米爾多雷營救死結、許可證缺口）
- DM 動態 GRANT/REVOKE 信號系統
- 音樂音效系統

### MVP v2
- 新遭遇類型（戰鬥、商店）
- 裝備系統
- 日誌系統
- 罪惡/通緝系統
- 第三象限擴展
- 被捕獲機制
- 完成路線二與三

### 長期目標
- 多區域旅行搭配持久化世界狀態
- Crambell 以外的區域擴展
- 社群貢獻的 Lore 擴充

---

## 專案亮點

### 技術創新
- ✅ 雙階段 DM 架構（意圖 JSON → 串流敘事）搭配獨立 Judge 驗證
- ✅ 完整事件系統搭配 10+ 種條件類型與旗標驅動世界狀態
- ✅ DnD 風格骰點機制搭配屬性修正與優勢/劣勢

### 內容成就
- ✅ 僅 Crambell 就有 10 個地點、6 個 NPC、31 個事件、22 個遭遇、10 個任務
- ✅ 設計 5 條逃脫路線，3 條已大幅實作
- ✅ 路線整合測試驗證完整故事線路徑

### 開發品質
- ✅ 24 個測試檔案含路線專屬整合覆蓋
- ✅ 多 LLM 後端支援（Anthropic、HuggingFace、本地）
- ✅ 結構化 Lore 資料實現系統化世界擴展

---

**技術棧**：SvelteKit、TypeScript、Tauri 2（Rust）、Anthropic Claude、Vitest
**引擎系統**：GameController、EventEngine、QuestEngine、EncounterEngine、DiceEngine、ExperienceEngine
**世界資料**：10 個地點、6 個 NPC、31 個事件、22 個遭遇、10 個任務（Crambell）
**目前階段**：MVP v1——路線 1/4 可玩，路線 5 進行中
