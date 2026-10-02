<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    settings, settingsOpen, updateSettings, resetSettings,
    UI_SCALE_PRESETS, DEFAULT_SETTINGS,
  } from '$lib/stores/settingsStore';

  function close() { settingsOpen.set(false); }
  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" transition:fade={{ duration: 150 }} on:click={handleBg}>
  <aside class="modal-panel" transition:fly={{ y: -8, duration: 180, easing: cubicOut }} role="dialog" aria-label="設定">
    <div class="modal-header">
      <span class="modal-title">設定</span>
      <button class="close-btn" on:click={close} aria-label="關閉">✕</button>
    </div>

    <div class="modal-body">
      <!-- 介面設定區塊：之後的介面類設定加在這個區塊（或新增同結構的 section） -->
      <section class="settings-section">
        <div class="section-title">介面</div>

        <div class="setting-row">
          <div class="setting-label">
            <span class="label-text">字級縮放</span>
            <span class="label-value">{pct($settings.uiScale)}</span>
          </div>
          <div class="preset-group" role="radiogroup" aria-label="字級縮放">
            {#each UI_SCALE_PRESETS as preset}
              <button
                class="preset-btn"
                class:active={$settings.uiScale === preset}
                role="radio"
                aria-checked={$settings.uiScale === preset}
                on:click={() => updateSettings({ uiScale: preset })}
              >{pct(preset)}</button>
            {/each}
          </div>
          <p class="preview">預覽：調整後，所有介面文字都會依此比例縮放。</p>
        </div>
      </section>
    </div>

    <div class="modal-footer">
      <button
        class="footer-btn"
        on:click={resetSettings}
        disabled={$settings.uiScale === DEFAULT_SETTINGS.uiScale}
      >恢復預設</button>
      <button class="footer-btn" on:click={close}>關閉</button>
    </div>
  </aside>
</div>

<style>
  /* 高於標題畫面 (200)，低於關閉確認 (300) */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 250;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-panel {
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 2px;
    width: min(calc(var(--ui-scale) * 380px), 92vw);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-tertiary);
    flex-shrink: 0;
  }

  .modal-title {
    font-size: calc(var(--ui-scale) * 13px);
    color: var(--text-primary);
    font-weight: 500;
    letter-spacing: 0.03em;
    flex: 1;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: calc(var(--ui-scale) * 12px);
    cursor: pointer;
    padding: 2px 4px;
    flex-shrink: 0;
    transition: color 0.1s;
  }

  .close-btn:hover { color: var(--text-primary); }

  .modal-body {
    padding: 12px 14px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-title {
    font-size: calc(var(--ui-scale) * 10px);
    color: var(--text-dim);
    letter-spacing: 0.1em;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  .setting-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .setting-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .label-text {
    font-size: calc(var(--ui-scale) * 12px);
    color: var(--text-primary);
  }

  .label-value {
    font-size: calc(var(--ui-scale) * 11px);
    color: var(--accent);
    font-family: var(--font-mono);
  }

  .preset-group {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .preset-btn {
    flex: 1;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: calc(var(--ui-scale) * 11px);
    padding: 4px 6px;
    border-radius: 2px;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .preset-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .preset-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-tertiary);
  }

  .preview {
    font-size: calc(var(--ui-scale) * 13px);
    color: var(--text-secondary);
    line-height: 1.7;
    padding: 8px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 2px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .footer-btn {
    font-family: var(--font-mono);
    font-size: calc(var(--ui-scale) * 11px);
    padding: 5px 14px;
    background: transparent;
    border: 1px solid var(--border-accent);
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 2px;
    letter-spacing: 0.04em;
    transition: background 0.1s, color 0.1s;
  }

  .footer-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .footer-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
