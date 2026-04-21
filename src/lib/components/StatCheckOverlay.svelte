<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { statCheckOverlay } from '$lib/stores/gameStore';

  // Props — pulled from store by parent
  export let stat: string;
  export let threshold: number;
  export let value: number;
  export let passed: boolean;

  const statKey = stat.split('.').pop() ?? stat;
  const STAT_LABELS: Record<string, string> = {
    knowledge:   '知識',
    strength:    '力量',
    agility:     '敏捷',
    charisma:    '魅力',
    stamina:     '耐力',
    perception:  '感知',
    luck:        '幸運',
    body:        '體格',
    mind:        '智力',
    spirit:      '意志',
    endurance:   '持久',
    influence:   '影響力',
  };
  const statLabel = STAT_LABELS[statKey] ?? statKey;

  // Bar geometry
  const barMax   = Math.max(threshold + Math.ceil(threshold * 0.6), value + 2, 6);
  const valuePct = Math.min((value / barMax) * 100, 100);
  const thresholdPct = Math.min((threshold / barMax) * 100, 100);

  const COLOR_PASS = '#7ec8a0';
  const COLOR_FAIL = '#d35f5f';
  const resultColor = passed ? COLOR_PASS : COLOR_FAIL;

  // Animation phases
  // 0 = card entering
  // 1 = stat info appears
  // 2 = result reveals (click-to-close enabled)
  let phase = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];

  onMount(() => {
    timers.push(setTimeout(() => { phase = 1; }, 350));
    timers.push(setTimeout(() => { phase = 2; }, 950));
  });

  onDestroy(() => timers.forEach(clearTimeout));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="backdrop" on:click={() => { if (phase >= 1) statCheckOverlay.set(null); }}>
  <div class="card">

    <!-- Header -->
    <div class="card-header">
      <span class="header-line">━━</span>
      <span class="header-text">數 值 判 定</span>
      <span class="header-line">━━</span>
    </div>

    <!-- Stat info (phase 1+) -->
    <div class="stat-section" class:visible={phase >= 1}>
      <div class="stat-name">{statLabel}</div>

      <div class="bar-wrap">
        <div class="bar-track">
          <div
            class="bar-fill"
            style="width: {phase >= 1 ? valuePct : 0}%; background: {resultColor}"
          ></div>
          <div class="bar-threshold" style="left: {thresholdPct}%"></div>
        </div>
      </div>

      <div class="numbers">
        <span class="num-group">你&nbsp;<span class="num-val" style="color:{resultColor}">{value}</span></span>
        <span class="num-sep">{passed ? '≥' : '<'}</span>
        <span class="num-group">門檻&nbsp;<span class="num-val">{threshold}</span></span>
      </div>
    </div>

    <!-- Result (phase 2+) -->
    <div class="result-section" class:visible={phase >= 2} style="color:{resultColor}; border-top-color: {resultColor}20">
      <span class="result-icon">{passed ? '◆' : '◇'}</span>
      <span class="result-text">{passed ? '判 定 成 功' : '判 定 失 敗'}</span>
      <span class="result-icon">{passed ? '◆' : '◇'}</span>
    </div>

    <span class="dismiss-hint" class:visible={phase >= 1}>（點擊關閉）</span>

  </div>
</div>

<style>
  /* ── Backdrop ────────────────────────────────────────── */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: backdropIn 0.2s ease-out;
    cursor: default;
  }

  @keyframes backdropIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* ── Card ────────────────────────────────────────────── */
  .card {
    width: 260px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 28px;
    gap: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
    animation: cardIn 0.28s cubic-bezier(0.34, 1.4, 0.64, 1);
    transition: opacity 0.3s ease;
  }

  @keyframes cardIn {
    from { opacity: 0; transform: scale(0.86); }
    to   { opacity: 1; transform: scale(1); }
  }

  /* ── Header ──────────────────────────────────────────── */
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
    letter-spacing: 0;
    opacity: 0.5;
  }

  .header-text {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.28em;
    font-family: var(--font-mono);
  }

  /* ── Stat section ────────────────────────────────────── */
  .stat-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.35s ease, transform 0.35s ease;
  }

  .stat-section.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .stat-name {
    font-size: 18px;
    color: var(--text-primary);
    letter-spacing: 0.22em;
    font-family: var(--font-mono);
  }

  /* Bar */
  .bar-wrap {
    width: 100%;
    padding: 0 2px;
  }

  .bar-track {
    position: relative;
    height: 3px;
    background: var(--bg-tertiary);
    border-radius: 1px;
    overflow: visible;
  }

  .bar-fill {
    height: 100%;
    border-radius: 1px;
    transition: width 0.65s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .bar-threshold {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    background: var(--text-dim);
    opacity: 0.7;
    transform: translateX(-50%);
    border-radius: 1px;
  }

  /* Numbers */
  .numbers {
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
  }

  .num-val {
    font-size: 14px;
    color: var(--text-primary);
  }

  .num-sep {
    font-size: 12px;
    color: var(--text-dim);
  }

  /* ── Result section ──────────────────────────────────── */
  .result-section {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    opacity: 0;
    transform: scale(0.88);
    transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.34, 1.4, 0.64, 1);
  }

  .result-section.visible {
    opacity: 1;
    transform: scale(1);
  }

  .result-icon {
    font-size: 8px;
  }

  .result-text {
    font-size: 15px;
    letter-spacing: 0.22em;
    font-family: var(--font-mono);
    font-weight: 500;
  }

  /* ── Dismiss hint ────────────────────────────────────── */
  .dismiss-hint {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    opacity: 0;
    margin-top: -6px;
    transition: opacity 0.4s ease;
  }

  .dismiss-hint.visible {
    opacity: 0.5;
  }
</style>
