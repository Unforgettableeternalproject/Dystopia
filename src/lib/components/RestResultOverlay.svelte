<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { restResultOverlay } from '$lib/stores/gameStore';
  import type { GameController } from '$lib/engine/GameController';

  export let controller: GameController;

  // Phase animation
  // 0 = card entering, 1 = content appears, 2 = click-to-close enabled, 3 = fade-out
  let phase = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];

  onMount(() => {
    timers.push(setTimeout(() => { phase = 1; }, 300));
    timers.push(setTimeout(() => { phase = 2; }, 900));
  });

  onDestroy(() => timers.forEach(clearTimeout));

  function dismiss() {
    if (phase < 2) return;
    phase = 3;
    setTimeout(() => {
      restResultOverlay.set(null);
      controller.narrateRestResult();
    }, 220);
  }

  const QUALITY_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
    full:        { color: '#7ec8a0', label: '成功休息',  icon: '◆' },
    partial:     { color: '#c9a96e', label: '不完整休息', icon: '◈' },
    disoriented: { color: '#d35f5f', label: '喪失時間觀', icon: '◇' },
  };

  $: r = $restResultOverlay;
  $: cfg = r ? (QUALITY_CONFIG[r.quality] ?? { color: '#8a8a8a', label: r.quality, icon: '○' }) : null;

  function fmtMinutes(m: number): string {
    if (m < 60) return `${m} 分鐘`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h} 小時 ${rem} 分` : `${h} 小時`;
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="backdrop" class:fade-out={phase === 3} on:click={dismiss}>
  {#if r && cfg}
    <div class="card" class:visible={phase >= 1} class:fade-out={phase === 3}>

      <!-- Header -->
      <div class="card-header">
        <span class="header-line">━━</span>
        <span class="header-text">休 息 結 果</span>
        <span class="header-line">━━</span>
      </div>

      <!-- Quality badge -->
      <div class="quality-badge" style="color:{cfg.color}; border-color:{cfg.color}40" class:visible={phase >= 1}>
        <span class="quality-icon">{cfg.icon}</span>
        <span class="quality-label">{cfg.label}</span>
        <span class="quality-icon">{cfg.icon}</span>
      </div>

      <!-- Stat rows -->
      <div class="stats-section" class:visible={phase >= 1}>
        <div class="stat-row">
          <span class="stat-label">預計時長</span>
          <span class="stat-val">{fmtMinutes(r.plannedMinutes)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">實際時長</span>
          <span class="stat-val" style="color:{cfg.color}">
            {fmtMinutes(r.actualMinutes)}
            {#if r.deviationMinutes !== 0}
              <span class="deviation">
                ({r.deviationMinutes > 0 ? '+' : ''}{r.deviationMinutes}分)
              </span>
            {/if}
          </span>
        </div>

        <div class="stat-divider"></div>

        {#if r.staminaDelta !== 0}
          <div class="stat-row">
            <span class="stat-label">體力</span>
            <span class="stat-val" class:gain={r.staminaDelta > 0} class:loss={r.staminaDelta < 0}>
              {r.staminaDelta > 0 ? '+' : ''}{r.staminaDelta}
            </span>
          </div>
        {/if}

        {#if r.stressDelta !== 0}
          <div class="stat-row">
            <span class="stat-label">壓力</span>
            <span class="stat-val" class:gain={r.stressDelta < 0} class:loss={r.stressDelta > 0}>
              {r.stressDelta > 0 ? '+' : ''}{r.stressDelta}
            </span>
          </div>
        {/if}

        {#if r.fatigueDelta !== 0}
          <div class="stat-row">
            <span class="stat-label">疲勞</span>
            <span class="stat-val" class:gain={r.fatigueDelta < 0} class:loss={r.fatigueDelta > 0}>
              {r.fatigueDelta > 0 ? '+' : ''}{r.fatigueDelta}
            </span>
          </div>
        {/if}

        {#if r.staminaDelta === 0 && r.stressDelta === 0 && r.fatigueDelta === 0}
          <div class="stat-row">
            <span class="stat-label">效果</span>
            <span class="stat-val muted">無回復</span>
          </div>
        {/if}
      </div>

      <span class="dismiss-hint" class:visible={phase >= 2}>（點擊繼續）</span>
    </div>
  {/if}
</div>

<style>
  /* ── Backdrop ── */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: backdropIn 0.2s ease-out;
    transition: opacity 0.22s ease;
  }

  .backdrop.fade-out {
    opacity: 0;
    pointer-events: none;
  }

  @keyframes backdropIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* ── Card ── */
  .card {
    width: 240px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 24px;
    gap: 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
    animation: cardIn 0.28s cubic-bezier(0.34, 1.4, 0.64, 1);
    opacity: 0;
    transition: opacity 0.3s ease, transform 0.22s ease;
  }

  .card.visible { opacity: 1; }

  .card.fade-out {
    opacity: 0;
    transform: scale(0.92);
  }

  @keyframes cardIn {
    from { opacity: 0; transform: scale(0.86); }
    to   { opacity: 1; transform: scale(1); }
  }

  /* ── Header ── */
  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    justify-content: center;
  }

  .header-line {
    font-size: 8px;
    color: var(--text-dim);
    opacity: 0.5;
  }

  .header-text {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.28em;
    font-family: var(--font-mono);
  }

  /* ── Quality badge ── */
  .quality-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    border: 1px solid;
    border-radius: 2px;
    opacity: 0;
    transform: scale(0.9);
    transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.34, 1.4, 0.64, 1);
  }

  .quality-badge.visible {
    opacity: 1;
    transform: scale(1);
  }

  .quality-icon { font-size: 9px; }

  .quality-label {
    font-size: 12px;
    letter-spacing: 0.18em;
    font-family: var(--font-mono);
    font-weight: 500;
  }

  /* ── Stat rows ── */
  .stats-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 5px;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 0.35s ease 0.1s, transform 0.35s ease 0.1s;
  }

  .stats-section.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .stat-label {
    color: var(--text-dim);
    font-size: 9px;
    letter-spacing: 0.08em;
  }

  .stat-val {
    color: var(--text-primary);
    font-size: 11px;
  }

  .stat-val.gain { color: #7ec8a0; }
  .stat-val.loss { color: #d35f5f; }
  .stat-val.muted { color: var(--text-dim); font-style: italic; font-size: 10px; }

  .deviation {
    font-size: 9px;
    color: var(--text-dim);
    margin-left: 4px;
  }

  .stat-divider {
    height: 1px;
    background: var(--border);
    opacity: 0.5;
    margin: 2px 0;
  }

  /* ── Dismiss hint ── */
  .dismiss-hint {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    opacity: 0;
    margin-top: -4px;
    transition: opacity 0.4s ease;
  }

  .dismiss-hint.visible { opacity: 0.5; }
</style>
