<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { RegionMapData } from '$lib/stores/gameStore';
  import { bfsLayout } from '$lib/utils/mapLayout';

  export let data: RegionMapData | undefined = undefined;

  const dispatch = createEventDispatcher<{ close: void }>();

  const SVG_W = 460;
  const SVG_H = 270;
  const R_CURRENT = 30;
  const R_OTHER   = 20;

  $: districtNodes = data?.districts.map(d => ({
    id:          d.id,
    connections: d.adjacentIds,
  })) ?? [];

  $: layout = data
    ? bfsLayout(districtNodes, data.currentDistrictId, SVG_W, SVG_H)
    : new Map<string, { x: number; y: number }>();

  $: currentDistrict = data?.districts.find(d => d.isCurrent);

  // Deduplicated edges between districts
  $: districtEdges = (() => {
    if (!data) return [] as Array<{ x1:number; y1:number; x2:number; y2:number }>;
    const seen = new Set<string>();
    const result: Array<{ x1:number; y1:number; x2:number; y2:number }> = [];
    for (const d of data.districts) {
      for (const adjId of d.adjacentIds) {
        const key = [d.id, adjId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const from = layout.get(d.id);
        const to   = layout.get(adjId);
        if (from && to) result.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
      }
    }
    return result;
  })();

  function close() { dispatch('close'); }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="backdrop" on:click|self={close}>
  <div class="modal">

    <!-- Header -->
    <div class="modal-header">
      <span class="modal-title">
        {data?.regionName ?? '地圖'}
      </span>
      <button class="close-btn" on:click={close}>✕</button>
    </div>

    <!-- District graph -->
    {#if data}
      <div class="svg-wrap">
        <svg width={SVG_W} height={SVG_H} viewBox="0 0 {SVG_W} {SVG_H}" class="region-svg">
          <!-- Edges between adjacent districts -->
          {#each districtEdges as e}
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} class="d-edge" />
          {/each}

          <!-- District nodes -->
          {#each data.districts as district}
            {@const pos = layout.get(district.id)}
            {#if pos}
              {@const r = district.isCurrent ? R_CURRENT : R_OTHER}

              <!-- Outer pulse for current -->
              {#if district.isCurrent}
                <circle cx={pos.x} cy={pos.y} r={r + 10} class="d-pulse" />
              {/if}

              <!-- District circle -->
              <circle
                cx={pos.x} cy={pos.y} r={r}
                class="d-node"
                class:d-current={district.isCurrent}
                class:d-locked={!district.isCurrent}
              />

              <!-- District label -->
              <text
                x={pos.x}
                y={pos.y + (district.isCurrent ? 3 : 2)}
                class="d-label"
                class:d-label-current={district.isCurrent}
                text-anchor="middle"
                dominant-baseline="middle"
              >{district.label}</text>

              <!-- Lock icon for other districts -->
              {#if !district.isCurrent}
                <text
                  x={pos.x}
                  y={pos.y - r - 7}
                  class="d-lock"
                  text-anchor="middle"
                >⬡</text>
              {/if}
            {/if}
          {/each}
        </svg>
      </div>

      <!-- Current district area list -->
      {#if currentDistrict?.areas && currentDistrict.areas.length > 0}
        <div class="area-panel">
          <div class="area-panel-header">
            <span class="area-panel-district">{currentDistrict.label}</span>
            <span class="area-count">{currentDistrict.areas.length} 個地區</span>
          </div>
          <div class="area-list">
            {#each currentDistrict.areas as area}
              <div class="area-row" class:area-current={area.isCurrent} class:area-fog={!area.isDiscovered}>
                <span class="area-dot">
                  {#if area.isCurrent}◉{:else if area.isDiscovered}·{:else}?{/if}
                </span>
                <span class="area-name">{(area.isDiscovered || area.isCurrent) ? area.name : '???'}</span>
                {#if area.isCurrent}
                  <span class="here-tag">你在這裡</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {:else}
      <div class="no-data">載入中…</div>
    {/if}

  </div>
</div>

<style>
  /* ── Backdrop & modal ───────────────────────────── */
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    backdrop-filter: blur(2px);
  }

  .modal {
    background: var(--bg-secondary, #0c1a24);
    border: 1px solid var(--border, #1e3040);
    border-radius: 2px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-width: 92vw;
    max-height: 90vh;
  }

  /* ── Header ─────────────────────────────────────── */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--border, #1e3040);
  }
  .modal-title {
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-dim, #445a68);
    font-family: var(--font-mono, monospace);
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim, #445a68);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    line-height: 1;
    transition: color 0.1s;
  }
  .close-btn:hover { color: var(--text-primary, #cce0ec); }

  /* ── SVG wrap ───────────────────────────────────── */
  .svg-wrap {
    padding: 8px 12px 4px;
    overflow: auto;
  }
  .region-svg { display: block; }

  /* ── District edges ─────────────────────────────── */
  .d-edge {
    stroke: #162535;
    stroke-width: 1.5;
    opacity: 0.6;
  }

  /* ── District nodes ─────────────────────────────── */
  .d-node {
    stroke-width: 1.5;
    transition: fill 0.15s;
  }
  .d-current {
    fill: #0e2535;
    stroke: var(--accent, #00c8e0);
    filter: drop-shadow(0 0 8px var(--accent, #00c8e0));
  }
  .d-locked {
    fill: #080f18;
    stroke: #1a2e40;
    opacity: 0.65;
  }

  /* ── District labels ────────────────────────────── */
  .d-label {
    font-size: 9px;
    font-family: var(--font-mono, monospace);
    fill: #3a5a70;
    pointer-events: none;
    paint-order: stroke;
    stroke: var(--bg-secondary, #0c1a24);
    stroke-width: 2.5;
    stroke-linejoin: round;
  }
  .d-label-current {
    fill: var(--accent, #00c8e0);
    font-size: 10px;
  }
  .d-lock {
    font-size: 8px;
    fill: #1a3040;
    pointer-events: none;
  }

  /* ── Pulse ──────────────────────────────────────── */
  .d-pulse {
    fill: none;
    stroke: var(--accent, #00c8e0);
    stroke-width: 1;
    opacity: 0;
    animation: d-pulse 3s ease-in-out infinite;
  }
  @keyframes d-pulse {
    0%   { opacity: 0;    }
    40%  { opacity: 0.28; }
    100% { opacity: 0;    }
  }

  /* ── Area panel ─────────────────────────────────── */
  .area-panel {
    border-top: 1px solid var(--border, #1e3040);
    padding: 10px 16px 12px;
    min-width: 260px;
  }
  .area-panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .area-panel-district {
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim, #445a68);
    font-family: var(--font-mono, monospace);
  }
  .area-count {
    font-size: 9px;
    color: var(--text-dim, #445a68);
    font-family: var(--font-mono, monospace);
    opacity: 0.55;
  }

  .area-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .area-row {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .area-dot {
    font-size: 11px;
    color: var(--text-dim, #445a68);
    width: 12px;
    text-align: center;
    flex-shrink: 0;
  }
  .area-name {
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    color: var(--text-secondary, #8aacbf);
    flex: 1;
  }
  .here-tag {
    font-size: 8px;
    letter-spacing: 0.1em;
    color: var(--accent, #00c8e0);
    font-family: var(--font-mono, monospace);
    opacity: 0.85;
    white-space: nowrap;
  }

  .area-row.area-current .area-dot  { color: var(--accent, #00c8e0); }
  .area-row.area-current .area-name { color: var(--text-primary, #cce0ec); }

  .area-row.area-fog .area-name {
    opacity: 0.35;
    font-style: italic;
  }

  .no-data {
    padding: 20px;
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    color: var(--text-dim, #445a68);
  }
</style>
