<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { restModalOpen } from '$lib/stores/gameStore';
  import type { GameController } from '$lib/engine/GameController';

  export let controller: GameController;

  function close() { restModalOpen.set(null); }
  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  const OPTIONS: Array<{ label: string; minutes: number }> = [
    { label: '30 分鐘',  minutes: 30  },
    { label: '1 小時',   minutes: 60  },
    { label: '2 小時',   minutes: 120 },
    { label: '4 小時',   minutes: 240 },
    { label: '8 小時',   minutes: 480 },
  ];

  let selectedMinutes = 480;

  $: state = $restModalOpen;
  $: maxAllowed = state?.canFullRest ? 480 : (state?.scuffedMaxMinutes ?? 30);
  $: {
    // If current selection exceeds max, reset to max allowed option
    const best = OPTIONS.filter(o => o.minutes <= maxAllowed).at(-1);
    if (best && selectedMinutes > maxAllowed) selectedMinutes = best.minutes;
  }

  function confirm() {
    controller.executeRest(selectedMinutes);
    close();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click={handleBg}>
  <aside class="modal-panel" transition:fly={{ y: -8, duration: 200, easing: cubicOut }} role="dialog" aria-label="休息">
    <div class="modal-header">
      <span class="modal-title">休 息</span>
      <span class="rest-mode" class:scuffed={!state?.canFullRest}>
        {state?.canFullRest ? '▣ 完整休息點' : '▤ 無休息點（短眠）'}
      </span>
    </div>

    <div class="modal-body">
      <p class="rest-desc">
        {state?.canFullRest
          ? '有休息點可用。選擇預計休息時間，實際時長可能因狀態偏移。'
          : `無休息點，只能短暫休息（最多 ${state?.scuffedMaxMinutes} 分鐘）。回復效果大幅降低。`
        }
      </p>

      <div class="options-label">預計時長</div>
      <div class="options">
        {#each OPTIONS as opt}
          {@const disabled = opt.minutes > maxAllowed}
          <button
            class="opt-btn"
            class:selected={selectedMinutes === opt.minutes}
            class:disabled
            {disabled}
            on:click={() => { if (!disabled) selectedMinutes = opt.minutes; }}
          >
            {opt.label}
            {#if disabled}
              <span class="opt-lock">✕</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <div class="modal-footer">
      <button class="footer-btn" on:click={close}>取消</button>
      <button class="footer-btn confirm" on:click={confirm}>確認休息</button>
    </div>
  </aside>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-panel {
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 2px;
    width: 300px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ───────────────────────── */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-tertiary);
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 12px;
    color: var(--text-primary);
    letter-spacing: 0.22em;
    font-family: var(--font-mono);
  }

  .rest-mode {
    font-size: 9px;
    color: var(--accent);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    opacity: 0.8;
  }

  .rest-mode.scuffed {
    color: var(--text-dim);
  }

  /* ── Body ─────────────────────────── */
  .modal-body {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .rest-desc {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.65;
    margin: 0;
  }

  .options-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .opt-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 5px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.1s, color 0.1s, background 0.1s;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .opt-btn:hover:not(.disabled) {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .opt-btn.selected {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-tertiary));
  }

  .opt-btn.disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .opt-lock {
    font-size: 8px;
    color: var(--text-dim);
  }

  /* ── Footer ───────────────────────── */
  .modal-footer {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    background: var(--bg-tertiary);
  }

  .footer-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 5px 14px;
    background: transparent;
    border: 1px solid var(--border-accent);
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 2px;
    letter-spacing: 0.04em;
    transition: background 0.1s, color 0.1s;
  }

  .footer-btn:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .footer-btn.confirm {
    border-color: var(--accent);
    color: var(--accent);
  }

  .footer-btn.confirm:hover {
    background: var(--accent);
    color: var(--bg-primary);
  }
</style>
