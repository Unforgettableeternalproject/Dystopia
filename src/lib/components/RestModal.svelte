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

  // ── Scuffed 選項（固定三檔）
  const SCUFFED_OPTIONS: Array<{ label: string; minutes: number }> = [
    { label: '短　30分', minutes: 30  },
    { label: '中　60分', minutes: 60  },
    { label: '長 120分', minutes: 120 },
  ];

  // ── Full rest 時間 spinner
  let fullHours   = 8;   // 0–12
  let fullMinutes = 0;   // 0 / 10 / 20 / 30 / 40 / 50

  function stepHours(delta: number) {
    fullHours = Math.max(0, Math.min(12, fullHours + delta));
    if (fullHours === 12) fullMinutes = 0;
  }

  function stepMinutes(delta: number) {
    if (fullHours === 12) return;
    const steps = [0, 10, 20, 30, 40, 50];
    const idx = steps.indexOf(fullMinutes);
    const next = idx + delta;
    if (next < 0) {
      if (fullHours > 0) { fullHours--; fullMinutes = 50; }
    } else if (next >= steps.length) {
      if (fullHours < 12) { fullHours++; fullMinutes = 0; }
    } else {
      fullMinutes = steps[next];
    }
  }

  $: fullSelectedMinutes = fullHours * 60 + fullMinutes;

  // ── Scuffed 選擇
  let scuffedSelected = 30;

  $: state = $restModalOpen;

  function confirm() {
    const mins = state?.canFullRest ? fullSelectedMinutes : scuffedSelected;
    controller.executeRest(mins);
    close();
  }

  function cancel() {
    controller.cancelRest();
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
          ? '有休息點可用。設定預計休息時間，實際時長可能因狀態偏移。'
          : '無休息點，只能短暫休息。回復效果大幅降低，無法降低壓力。'}
      </p>

      <div class="options-label">預計時長</div>

      {#if state?.canFullRest}
        <!-- ── Full rest: 時:分 spinner ── -->
        <div class="spinner-row">
          <div class="spinner-group">
            <button class="spin-btn" on:click={() => stepHours(1)}>▲</button>
            <span class="spin-val">{String(fullHours).padStart(2, '0')}</span>
            <button class="spin-btn" on:click={() => stepHours(-1)}>▼</button>
            <span class="spin-unit">時</span>
          </div>
          <span class="spin-sep">:</span>
          <div class="spinner-group">
            <button class="spin-btn" on:click={() => stepMinutes(1)}>▲</button>
            <span class="spin-val">{String(fullMinutes).padStart(2, '0')}</span>
            <button class="spin-btn" on:click={() => stepMinutes(-1)}>▼</button>
            <span class="spin-unit">分</span>
          </div>
        </div>
        <div class="spinner-hint">
          {fullSelectedMinutes < 60
            ? `${fullSelectedMinutes} 分鐘`
            : fullSelectedMinutes % 60 === 0
              ? `${fullHours} 小時`
              : `${fullHours} 小時 ${fullMinutes} 分`}
          　最多 12 小時
        </div>
      {:else}
        <!-- ── Scuffed: 固定三檔 ── -->
        <div class="options">
          {#each SCUFFED_OPTIONS as opt}
            <button
              class="opt-btn"
              class:selected={scuffedSelected === opt.minutes}
              on:click={() => { scuffedSelected = opt.minutes; }}
            >
              {opt.label}
            </button>
          {/each}
        </div>
        <div class="spinner-hint">時間可能出現 ±10 分鐘以上的偏差</div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="footer-btn" on:click={cancel}>取消</button>
      <button
        class="footer-btn confirm"
        disabled={state?.canFullRest && fullSelectedMinutes < 10}
        on:click={confirm}
      >確認休息</button>
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

  /* ── Header ── */
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

  /* ── Body ── */
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

  /* ── Spinner ── */
  .spinner-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .spinner-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .spin-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 9px;
    width: 36px;
    height: 20px;
    cursor: pointer;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.1s, color 0.1s;
    padding: 0;
    line-height: 1;
  }

  .spin-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .spin-val {
    font-family: var(--font-mono);
    font-size: 22px;
    color: var(--text-primary);
    min-width: 36px;
    text-align: center;
    line-height: 1.1;
  }

  .spin-unit {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .spin-sep {
    font-size: 22px;
    color: var(--text-dim);
    align-self: center;
    margin-bottom: 4px;
  }

  .spinner-hint {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }

  /* ── Scuffed options ── */
  .options {
    display: flex;
    gap: 5px;
  }

  .opt-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 5px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.1s, color 0.1s, background 0.1s;
    flex: 1;
  }

  .opt-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .opt-btn.selected {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-tertiary));
  }

  /* ── Footer ── */
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

  .footer-btn:hover:not(:disabled) {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .footer-btn.confirm {
    border-color: var(--accent);
    color: var(--accent);
  }

  .footer-btn.confirm:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .footer-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
