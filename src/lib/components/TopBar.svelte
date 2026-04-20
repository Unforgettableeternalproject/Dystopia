<script lang="ts">
  import { playerUI, isStreaming, isDebugMode } from '$lib/stores/gameStore';

  export let onSave: (() => void) | undefined = undefined;
  export let onLoadMenu: (() => void) | undefined = undefined;
</script>

<header class="top-bar">
  {#if $isDebugMode}
    <div class="region debug-region">◇ 除錯模式</div>
  {:else}
    <div class="region">{$playerUI.regionName}</div>
  {/if}

  <div class="center-info">
    {#if $playerUI.time}
      <span class="time">{$playerUI.time}</span>
      {#if $playerUI.timePeriod}
        <span class="sep">·</span>
        <span class="period">{$playerUI.timePeriod}</span>
      {/if}
    {/if}
  </div>

  <div class="right-bar">
    <div class="turn">T{$playerUI.turn}</div>
    <button
      class="topbar-btn"
      on:click={onSave}
      disabled={$isStreaming || !onSave || $isDebugMode}
      title={$isDebugMode ? '除錯模式不允許存檔' : '快速存檔 (存檔槽1)'}
    >存</button>
    <button
      class="topbar-btn"
      on:click={onLoadMenu}
      disabled={!onLoadMenu}
      title="讀取存檔"
    >讀</button>
  </div>
</header>

<style>
  .top-bar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    height: var(--top-bar-h);
    padding: 0 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
    gap: 12px;
    flex-shrink: 0;
  }

  .region {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .debug-region {
    color: #c9a96e;
    letter-spacing: 0.12em;
  }

  .center-info {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .time {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .sep {
    color: var(--text-dim);
    font-size: 10px;
  }

  .period {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
  }

  .right-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .turn {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    min-width: 28px;
    text-align: right;
  }

  .topbar-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.1s, color 0.1s;
    height: 22px;
    flex-shrink: 0;
  }

  .topbar-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .topbar-btn:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }
</style>
