# 遠端存取設定指南 / Remote Access Setup Guide

本文件說明如何設定 Dystopia，讓你可以在遠端裝置上透過 Radmin、VPN 或區域網路存取遊戲。

---

## 問題說明

預設情況下，Dystopia 的前端會直接連接到 `localhost:11434` 來呼叫本地 LLM（如 Ollama）。這在本機運行時沒問題，但當你在遠端裝置上開啟遊戲時：

- ✅ Vite 前端可以透過 `伺服器IP:5173` 存取
- ❌ LLM 呼叫失敗，因為遠端裝置的 `localhost` 指向它自己，而不是伺服器

---

## 解決方案：LLM 代理模式

我們實作了 **SvelteKit API 代理**，讓前端透過伺服器的 API 路由來呼叫 LLM：

```
遠端瀏覽器 → 伺服器 Vite (0.0.0.0:5173)
            ↓
         /api/llm/chat (SvelteKit API route)
            ↓
         Ollama (localhost:11434)
```

這樣做的好處：
- ✅ Ollama 保持在 localhost，不需暴露在網路上（更安全）
- ✅ 遠端裝置可以透過 Vite 伺服器存取 LLM
- ✅ 不需要修改防火牆或 Ollama 設定

---

## 設定步驟

### 1. 設定環境變數

在專案根目錄建立或編輯 `.env` 檔案：

```bash
# 啟用 Ollama
VITE_OLLAMA_MODEL=gemma4:e4b-it-q4_K_M

# 啟用代理模式（重要！）
VITE_USE_LLM_PROXY=true
```

### 2. 確認 Ollama 運行中

確保伺服器上的 Ollama 正在運行：

```bash
# 檢查 Ollama 是否運行
curl http://localhost:11434/api/tags

# 如果沒有運行，啟動 Ollama
ollama serve
```

### 3. 啟動開發伺服器

```bash
npm run tauri dev
```

Vite 已經設定為監聽 `0.0.0.0:5173`，所以會自動接受遠端連線。

### 4. 從遠端裝置連接

在遠端裝置的瀏覽器中，使用伺服器的 IP 位址：

```
http://192.168.x.x:5173
```

或透過 Radmin VPN 的 IP：

```
http://26.x.x.x:5173
```

---

## 運作原理

### 代理模式關閉時（預設）

```typescript
// LocalModelClient 直接連接 Ollama
fetch('http://localhost:11434/v1/chat/completions', { ... })
```

### 代理模式開啟時

```typescript
// LocalModelClient 透過相對路徑呼叫 API
fetch('/api/llm/chat', { ... })

// SvelteKit API route 轉發到本地 Ollama
// src/routes/api/llm/chat/+server.ts
fetch('http://localhost:11434/v1/chat/completions', { ... })
```

---

## 進階設定

### 自訂 Ollama Port 或 URL

如果你的 Ollama 不在預設 port，可以在伺服器端設定：

```bash
# .env (伺服器端)
VITE_LLM_BACKEND_URL=http://localhost:12345
```

這個變數只在伺服器端（SvelteKit API route）使用，前端不需要知道實際的 LLM 位址。

### 在 LM Studio 使用代理模式

LM Studio 預設使用 port 1234，設定方式相同：

```bash
VITE_OLLAMA_MODEL=你的模型名稱
VITE_USE_LLM_PROXY=true
VITE_LLM_BACKEND_URL=http://localhost:1234
```

---

## 疑難排解

### 遠端裝置顯示「Failed to connect to LLM backend」

1. 檢查 `.env` 中 `VITE_USE_LLM_PROXY=true` 是否設定
2. 重新啟動開發伺服器（環境變數變更需要重啟）
3. 確認伺服器上的 Ollama 正在運行

### API 請求超時

1. 檢查 Ollama 是否有足夠的資源（GPU/CPU）
2. 嘗試使用更小的模型（如 `gemma3:1b-it`）
3. 檢查伺服器的網路連線

### 無法載入 Vite 前端

1. 確認防火牆沒有阻擋 5173 port
2. 檢查伺服器 IP 位址是否正確
3. 確認 Radmin VPN 或網路連線正常

---

## 安全考量

### 代理模式的安全性

- ✅ **更安全**：LLM 服務保持在 localhost，不直接暴露在網路上
- ✅ **簡單**：不需要設定 Ollama 的網路監聽
- ⚠️ **注意**：任何能存取 Vite 伺服器的人都能使用 LLM

### 建議做法

- 只在信任的網路（如 Radmin VPN）上使用遠端存取
- 不要將 Vite 開發伺服器暴露在公開網路
- 生產環境應使用適當的認證機制

---

## 總結

| 模式 | 前端連接 | 適用情境 |
|------|---------|---------|
| **直接模式** | `localhost:11434` | 本機開發 |
| **代理模式** | `/api/llm/chat` | 遠端存取、多裝置測試 |

代理模式讓你可以在保持安全的前提下，輕鬆地在遠端裝置上測試遊戲！
