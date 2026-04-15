# Game Design Document

> MVP 範疇設計文件，以坎貝爾（三區）為場景。

## Core Loop

```
進入場景 → 接收敘述 → 選擇/輸入動作 → 規制器判定 → 引擎更新狀態
    ↑_______________________________________________|
```

## Player Stats Reference

### Primary Stats（判定用）
| 數值 | 說明 | 典型應用 |
|---|---|---|
| 力量 (strength) | 體能、強制 | 戰鬥、搬重物、破門 |
| 知識 (knowledge) | 資訊、學習 | 解謎、識別物品、說服（邏輯） |
| 才能 (talent) | 技藝、手巧 | 製作、鎖頭、潛行 |
| 精神 (spirit) | 意志、感知 | 察覺隱情、抗壓、感應 |
| 運氣 (luck) | 機率、奇遇 | 隨機事件、巧遇、意外 |

### Secondary Stats（影響判定，MVP 可簡化）
| 數值 | 領域 |
|---|---|
| 意識 (consciousness) | 精神學 |
| 奧秘 (arcane) | 魔法 |
| 科技 (technology) | 科學/工程 |

### Status Stats
| 數值 | 說明 |
|---|---|
| 體力 (stamina) | 歸零時行動受限 |
| 壓力 (stress) | 過高時影響判定結果 |
| 魔力 (mana) | MVP 後啟用 |
| 經驗 (experience) | 影響技能成長方向 |

### External Stats
| 數值 | 單位 | 說明 |
|---|---|---|
| 聲望 (reputation) | 對派系 | 影響 NPC 態度、可用服務 |
| 好感 (affinity) | 對 NPC | 影響對話選項、情報取得 |
| 熟悉 (familiarity) | 對地點 | 影響探索細節、隱藏地點發現 |

## NPC Types

| 類型 | 特性 | MVP 角色數 |
|---|---|---|
| 據點式 (stationed) | 固定位置，觸發關鍵劇情 | 2-3 個 |
| 任務式 (quest) | 提供資源、解鎖支線 | 1-2 個 |
| 遊歷式 (wandering) | 罕見，改變路線 | MVP 後 |

## Thought System

Thought 是規制器建議給玩家的動作選項，顯示在 UI 底部。

- 玩家可以選擇 Thought 或自由輸入
- 自由輸入走完整的規制器流程
- Thought 通常是已知安全的選項，但不一定是最優解
- **遊戲機制延伸**：某些敵人可能操控 Thought 內容（心靈控制）

## Flag Naming Convention

```
<區域>_<類型>_<描述>

campbell_quest_intro_done      ← 坎貝爾主線：介紹完成
campbell_npc_grey_met          ← 與 NPC Grey 第一次對話
campbell_location_delth_found  ← 發現戴司象限
campbell_event_quota_failed    ← 配額未達成事件觸發
```

## MVP Campbell Outline

**起始位置**：戴司象限（Delth）公有宿舍

**玩家出身選項**（MVP 提供 2 種）：
1. 礦工（力量+、科技+，知識-）
2. 文書（知識+，力量-）

**主要目標**：找到離開坎貝爾的方法

**可能路線**：
- 通過正規管道：提升聲望 → 申請出境許可（知識/才能路線）
- 加入地下網路：找到叛亂組織 → 秘密出逃（精神/運氣路線）
- 揭發高層腐敗：蒐集證據 → 上報（需要高知識 + 低聲望）
- 留下：接受現實，在坎貝爾找到自己的位置（任何路線都可觸發）
