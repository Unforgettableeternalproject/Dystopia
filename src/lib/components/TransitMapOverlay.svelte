<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { activeEncounterUI } from '$lib/stores/gameStore';
  import type { EncounterChoice } from '$lib/types/encounter';

  export let onSelect: (choiceId: string) => void;

  // Per-region visual config keyed by choice ID
  const regionConfig: Record<string, { name: string; icon: string; color: string; desc: string }> = {
    transit_famein:    { name: '費敏',       icon: '◈', color: '#5fa8d3', desc: '工業重心象限' },
    transit_pestilens: { name: '帕絲蒂蘭斯',  icon: '◆', color: '#d3a85f', desc: '農業供給象限' },
    transit_wyar:      { name: '瓦爾',       icon: '◇', color: '#7ec8a0', desc: '資訊管控象限' },
    transit_konquer:   { name: '康庫爾',     icon: '⬡', color: '#c85f7e', desc: '政治核心象限 · 特殊授權' },
  };

  const DEFAULT_COLOR = '#9b8abf';

  $: enc = $activeEncounterUI;
  $: destinations = (enc?.choices ?? []).filter(c => c.id !== 'leave');
  $: leaveChoice   = (enc?.choices ?? []).find(c => c.id === 'leave');

  function cfgOf(c: EncounterChoice) {
    return regionConfig[c.id] ?? { name: c.text.replace(/^前往/, ''), icon: '◉', color: DEFAULT_COLOR, desc: '' };
  }
</script>

{#if enc?.type === 'transit'}
  <!-- Backdrop -->
  <div class="transit-backdrop" transition:fade={{ duration: 200 }}>

    <!-- Panel -->
    <div class="transit-panel" transition:fly={{ y: 30, duration: 280, easing: cubicOut }}>

      <!-- Header -->
      <div class="transit-header">
        <span class="transit-icon">⬡</span>
        <div class="transit-titles">
          <span class="transit-label">象限傳送門</span>
          <span class="transit-sub">選擇目的地象限</span>
        </div>
      </div>

      <!-- Departure tag -->
      <div class="departure-tag">
        <span class="dep-dot"></span>
        <span class="dep-text">出發地 · 坎貝爾三象限</span>
      </div>

      <!-- Region grid -->
      <div class="region-grid" class:single={destinations.length === 1}>
        {#each destinations as choice (choice.id)}
          {@const cfg = cfgOf(choice)}
          <button
            class="region-card"
            style="--region-color: {cfg.color}"
            on:click={() => onSelect(choice.id)}
          >
            <span class="region-icon">{cfg.icon}</span>
            <span class="region-name">{cfg.name}</span>
            {#if cfg.desc}
              <span class="region-desc">{cfg.desc}</span>
            {/if}
            <span class="region-arrow">→</span>
          </button>
        {/each}
      </div>

      {#if destinations.length === 0}
        <div class="no-destinations">目前沒有有效的通行證，無法啟動傳送。</div>
      {/if}

      <!-- Cancel -->
      {#if leaveChoice}
        {@const lc = leaveChoice}
        <button class="leave-btn" on:click={() => onSelect(lc.id)}>
          ← 離開傳送門
        </button>
      {/if}

    </div>
  </div>
{/if}

<style>
  /* ── Backdrop ─────────────────────────────────────────── */
  .transit-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(6, 8, 12, 0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 120;
  }

  /* ── Panel ────────────────────────────────────────────── */
  .transit-panel {
    background: var(--bg-secondary);
    border: 1px solid color-mix(in srgb, #9b8abf 35%, var(--border));
    border-top: 2px solid #9b8abf;
    display: flex;
    flex-direction: column;
    gap: 0;
    width: min(520px, 92vw);
    max-height: 90vh;
    overflow-y: auto;
  }

  /* ── Header ───────────────────────────────────────────── */
  .transit-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px 12px;
    background: color-mix(in srgb, #9b8abf 8%, var(--bg-tertiary));
    border-bottom: 1px solid color-mix(in srgb, #9b8abf 20%, var(--border));
  }

  .transit-icon {
    font-size: 22px;
    color: #9b8abf;
    opacity: 0.9;
    flex-shrink: 0;
  }

  .transit-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .transit-label {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-primary);
    letter-spacing: 0.12em;
  }

  .transit-sub {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.06em;
  }

  /* ── Departure tag ────────────────────────────────────── */
  .departure-tag {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 20px;
    border-bottom: 1px solid var(--border);
  }

  .dep-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #7ec8a0;
    flex-shrink: 0;
    box-shadow: 0 0 4px #7ec8a0;
  }

  .dep-text {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
  }

  /* ── Region grid ──────────────────────────────────────── */
  .region-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 16px 20px;
  }

  .region-grid.single {
    grid-template-columns: 1fr;
  }

  /* ── Region card ──────────────────────────────────────── */
  .region-card {
    background: var(--bg-tertiary);
    border: 1px solid color-mix(in srgb, var(--region-color) 20%, var(--border));
    border-left: 3px solid var(--region-color);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 14px 16px 12px;
    cursor: pointer;
    position: relative;
    transition: background 0.15s, border-color 0.15s;
    text-align: left;
  }

  .region-card:hover {
    background: color-mix(in srgb, var(--region-color) 10%, var(--bg-tertiary));
    border-color: color-mix(in srgb, var(--region-color) 60%, var(--border));
  }

  .region-icon {
    font-size: 16px;
    color: var(--region-color);
    opacity: 0.85;
  }

  .region-name {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.04em;
  }

  .region-desc {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
    font-style: italic;
  }

  .region-arrow {
    position: absolute;
    right: 14px;
    bottom: 12px;
    font-size: 11px;
    color: var(--region-color);
    opacity: 0;
    transition: opacity 0.15s, right 0.15s;
  }

  .region-card:hover .region-arrow {
    opacity: 0.8;
    right: 10px;
  }

  /* ── No destinations ──────────────────────────────────── */
  .no-destinations {
    padding: 20px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim);
    font-style: italic;
  }

  /* ── Leave button ─────────────────────────────────────── */
  .leave-btn {
    margin: 0 20px 18px;
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 14px;
    cursor: pointer;
    letter-spacing: 0.06em;
    transition: color 0.1s, border-color 0.1s;
  }

  .leave-btn:hover {
    color: var(--text-secondary);
    border-color: var(--text-dim);
  }
</style>
