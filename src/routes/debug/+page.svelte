<script lang="ts">
  import { onMount } from 'svelte';
  import { GameController } from '$lib/engine/GameController';
  import { loadCrambellLore } from '$lib/utils/LoreLoader';

  let controller: GameController | null = null;
  let preview: { systemPrompt: string; sceneContext: string; fullUserMessage: string } | null = null;
  let actionInput = '觀察四周';
  let activeTab: 'scene' | 'user' | 'system' = 'scene';
  let copied = '';
  let flags: string[] = [];
  let locationId = '';

  onMount(() => {
    controller = new GameController();
    loadCrambellLore(controller);
    refresh();
  });

  function refresh() {
    if (!controller) return;
    preview  = controller.getDMContextPreview(actionInput);
    flags    = controller.getFlags();
    const gs = controller.getState();
    locationId = gs.player.currentLocationId;
  }

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    copied = key;
    setTimeout(() => (copied = ''), 1500);
  }

  $: activeContent = preview
    ? activeTab === 'scene'  ? preview.sceneContext
    : activeTab === 'user'   ? preview.fullUserMessage
    :                          preview.systemPrompt
    : '';

  $: charCount = activeContent.length;
  $: lineCount = activeContent.split('\n').length;
</script>

<div class="dbg-root">
  <!-- Header -->
  <div class="dbg-header">
    <span class="dbg-title">DM Context Inspector</span>
    <span class="dbg-subtitle">開發工具 — 模擬 DM 注入的完整 context</span>
  </div>

  <!-- Toolbar -->
  <div class="dbg-toolbar">
    <input
      class="dbg-input"
      bind:value={actionInput}
      placeholder="模擬玩家行動..."
      on:keydown={(e) => e.key === 'Enter' && refresh()}
    />
    <button class="dbg-btn primary" on:click={refresh}>重新產生</button>
  </div>

  <!-- Meta strip -->
  {#if preview}
  <div class="dbg-meta">
    <span class="meta-tag">
      <span class="meta-label">地點</span>
      <span class="meta-val">{locationId}</span>
    </span>
    <span class="meta-tag">
      <span class="meta-label">旗標</span>
      <span class="meta-val">{flags.length > 0 ? flags.join(', ') : '(無)'}</span>
    </span>
  </div>
  {/if}

  <!-- Tabs -->
  <div class="dbg-tabs">
    <button
      class="dbg-tab"
      class:active={activeTab === 'scene'}
      on:click={() => (activeTab = 'scene')}
    >場景 Context</button>
    <button
      class="dbg-tab"
      class:active={activeTab === 'user'}
      on:click={() => (activeTab = 'user')}
    >完整 User Message</button>
    <button
      class="dbg-tab"
      class:active={activeTab === 'system'}
      on:click={() => (activeTab = 'system')}
    >System Prompt</button>

    <span class="dbg-stats">{lineCount} 行 / {charCount} 字元</span>

    <button
      class="dbg-btn copy"
      class:ok={copied === activeTab}
      on:click={() => copy(activeContent, activeTab)}
    >{copied === activeTab ? '已複製 ✓' : '複製'}</button>
  </div>

  <!-- Content -->
  <div class="dbg-content">
    {#if preview}
      <pre class="dbg-pre">{activeContent}</pre>
    {:else}
      <div class="dbg-loading">載入中...</div>
    {/if}
  </div>
</div>

<style>
  :global(body) {
    background: #0d0d0d;
  }

  .dbg-root {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--font-mono, 'Courier New', monospace);
    font-size: 12px;
    color: #c8c8c8;
    background: #0d0d0d;
  }

  /* Header */
  .dbg-header {
    display: flex;
    align-items: baseline;
    gap: 14px;
    padding: 10px 16px;
    border-bottom: 1px solid #2a2a2a;
    flex-shrink: 0;
  }
  .dbg-title {
    font-size: 13px;
    color: #e8e8e8;
    letter-spacing: 0.08em;
  }
  .dbg-subtitle {
    font-size: 11px;
    color: #555;
  }

  /* Toolbar */
  .dbg-toolbar {
    display: flex;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid #1e1e1e;
    flex-shrink: 0;
  }
  .dbg-input {
    flex: 1;
    background: #141414;
    border: 1px solid #2a2a2a;
    color: #c8c8c8;
    font-family: inherit;
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 2px;
    outline: none;
  }
  .dbg-input:focus {
    border-color: #4a6fa5;
  }

  /* Meta strip */
  .dbg-meta {
    display: flex;
    gap: 20px;
    padding: 6px 16px;
    border-bottom: 1px solid #1a1a1a;
    flex-shrink: 0;
    background: #111;
    flex-wrap: wrap;
  }
  .meta-tag {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .meta-label {
    font-size: 10px;
    color: #555;
    letter-spacing: 0.06em;
  }
  .meta-val {
    font-size: 11px;
    color: #87a0c8;
    max-width: 600px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Tabs */
  .dbg-tabs {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 16px;
    border-bottom: 1px solid #2a2a2a;
    flex-shrink: 0;
    background: #101010;
  }
  .dbg-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #555;
    font-family: inherit;
    font-size: 11px;
    padding: 8px 14px;
    cursor: pointer;
    letter-spacing: 0.04em;
    transition: color 0.1s;
  }
  .dbg-tab:hover { color: #999; }
  .dbg-tab.active {
    color: #87a0c8;
    border-bottom-color: #4a6fa5;
  }
  .dbg-stats {
    margin-left: auto;
    font-size: 10px;
    color: #3a3a3a;
    padding: 0 8px;
  }

  /* Buttons */
  .dbg-btn {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    color: #888;
    font-family: inherit;
    font-size: 11px;
    padding: 5px 12px;
    cursor: pointer;
    border-radius: 2px;
    letter-spacing: 0.04em;
    transition: background 0.1s, color 0.1s;
  }
  .dbg-btn:hover { background: #222; color: #c8c8c8; }
  .dbg-btn.primary {
    border-color: #3a5278;
    color: #87a0c8;
  }
  .dbg-btn.primary:hover {
    background: #1a2a40;
    color: #a8c0e0;
  }
  .dbg-btn.copy.ok {
    border-color: #3a6644;
    color: #6ac87a;
  }

  /* Content */
  .dbg-content {
    flex: 1;
    overflow: auto;
    padding: 16px;
  }
  .dbg-pre {
    margin: 0;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.65;
    color: #b8b8b8;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* Section headers in the context */
  .dbg-pre :global(strong) { color: #e8e8e8; }

  .dbg-loading {
    color: #555;
    padding: 40px;
    text-align: center;
  }
</style>
