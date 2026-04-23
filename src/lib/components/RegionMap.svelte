<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { RegionMapData, RegionMapAreaNode, DistrictMapNode } from '$lib/stores/gameStore';
  import { playerUI } from '$lib/stores/gameStore';
  import { bfsLayout, edgesToLayoutNodes } from '$lib/utils/mapLayout';

  export let data: RegionMapData | undefined = undefined;

  const dispatch = createEventDispatcher<{ close: void }>();

  // ── Layout constants ──────────────────────────────────
  const SVG_W = 520;
  const SVG_H = 340;
  const BLOCK_W = 80;
  const BLOCK_H = 36;
  const BLOCK_W_CURRENT = 90;
  const BLOCK_H_CURRENT = 42;

  // ── View state ────────────────────────────────────────
  type ViewMode = 'districts' | 'dashboard' | 'areas';
  let viewMode: ViewMode = 'districts';
  let focusedDistrictId: string | null = null;
  let expandedDistrictId: string | null = null;
  let selectedArea: RegionMapAreaNode | null = null;

  $: focusedDistrict = focusedDistrictId
    ? data?.districts.find(d => d.id === focusedDistrictId) ?? null
    : null;

  // ── Time display ──────────────────────────────────────
  $: displayTime = (() => {
    const raw = $playerUI.time;
    if (!raw) return '';
    const match = raw.match(/(\d{1,2}:\d{2})$/);
    return match ? match[1] : raw;
  })();

  // ── Control/alert labels ──────────────────────────────
  const CONTROL_LABELS: Record<number, string> = {
    0: '自由', 1: '寬鬆', 2: '標準', 3: '嚴格', 4: '戒嚴',
  };
  const ALERT_LABELS: Record<number, string> = {
    0: '平靜', 1: '警覺', 2: '緊張', 3: '高度', 4: '危機',
  };

  // ── District overview layout ──────────────────────────
  $: districtNodes = data?.districts.map(d => ({
    id:          d.id,
    connections: d.adjacentIds,
  })) ?? [];

  $: districtLayout = data
    ? bfsLayout(districtNodes, data.currentDistrictId, SVG_W, SVG_H)
    : new Map<string, { x: number; y: number }>();

  $: districtEdges = (() => {
    if (!data) return [] as Array<{ x1:number; y1:number; x2:number; y2:number }>;
    const seen = new Set<string>();
    const result: Array<{ x1:number; y1:number; x2:number; y2:number }> = [];
    for (const d of data.districts) {
      for (const adjId of d.adjacentIds) {
        const key = [d.id, adjId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const from = districtLayout.get(d.id);
        const to   = districtLayout.get(adjId);
        if (from && to) result.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
      }
    }
    return result;
  })();

  // ── Expanded area graph ───────────────────────────────
  $: expandedGraph = expandedDistrictId && data?.districtAreaGraphs[expandedDistrictId]
    ? data.districtAreaGraphs[expandedDistrictId]
    : null;

  $: expandedLayoutNodes = expandedGraph
    ? edgesToLayoutNodes(expandedGraph.nodes.map(n => n.id), expandedGraph.edges)
    : [];

  $: expandedStartId = expandedGraph?.nodes.find(n => n.isCurrent)?.id
    ?? expandedGraph?.nodes.find(n => n.isDiscovered)?.id
    ?? expandedGraph?.nodes[0]?.id ?? '';

  $: expandedLayout = expandedGraph
    ? bfsLayout(expandedLayoutNodes, expandedStartId, SVG_W, SVG_H)
    : new Map<string, { x: number; y: number }>();

  $: expandedEdges = (() => {
    if (!expandedGraph) return [] as Array<{ x1:number; y1:number; x2:number; y2:number }>;
    const result: Array<{ x1:number; y1:number; x2:number; y2:number }> = [];
    for (const e of expandedGraph.edges) {
      const from = expandedLayout.get(e.fromId);
      const to   = expandedLayout.get(e.toId);
      if (from && to) result.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    }
    return result;
  })();

  $: expandedDistrictLabel = expandedDistrictId
    ? data?.districts.find(d => d.id === expandedDistrictId)?.label ?? ''
    : '';

  // ── Pan & Zoom ────────────────────────────────────────
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let pointerDown = false;
  let didDrag = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  const DRAG_THRESHOLD = 4;

  function resetPanZoom() { panX = 0; panY = 0; zoom = 1; }

  function zoomToDistrict(districtId: string) {
    const pos = districtLayout.get(districtId);
    if (!pos) return;
    const targetZoom = 2.2;
    // Offset to the left to make room for the right panel
    const cx = SVG_W * 0.41;
    const cy = SVG_H / 2;
    panX = (cx - pos.x) * targetZoom;
    panY = (cy - pos.y) * targetZoom;
    zoom = targetZoom;
  }

  function onWheel(e: WheelEvent) {
    if (viewMode === 'dashboard') return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    zoom = Math.min(2.5, Math.max(0.5, zoom + delta));
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || viewMode === 'dashboard') return;
    pointerDown = true;
    didDrag = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointerDown) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (!didDrag && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    didDrag = true;
    panX = panOriginX + dx;
    panY = panOriginY + dy;
  }

  function onPointerUp() { pointerDown = false; }

  // ── District click → dashboard ────────────────────────
  let shakeDistrictId: string | null = null;

  function onDistrictClick(districtId: string, isDiscovered: boolean) {
    if (didDrag) return;
    if (viewMode === 'dashboard') return;
    if (!isDiscovered) {
      shakeDistrictId = districtId;
      setTimeout(() => { shakeDistrictId = null; }, 500);
      return;
    }
    focusedDistrictId = districtId;
    viewMode = 'dashboard';
    requestAnimationFrame(() => zoomToDistrict(districtId));
  }

  function onViewportClick() {
    if (viewMode === 'dashboard') backToDistricts();
  }

  function openAreaMap() {
    expandedDistrictId = focusedDistrictId;
    selectedArea = null;
    viewMode = 'areas';
    resetPanZoom();
  }

  function backToDashboard() {
    expandedDistrictId = null;
    selectedArea = null;
    viewMode = 'dashboard';
    if (focusedDistrictId) {
      requestAnimationFrame(() => zoomToDistrict(focusedDistrictId!));
    }
  }

  function backToDistricts() {
    focusedDistrictId = null;
    expandedDistrictId = null;
    selectedArea = null;
    viewMode = 'districts';
    resetPanZoom();
  }

  // ── Area node click ───────────────────────────────────
  function onAreaClick(area: RegionMapAreaNode) {
    if (didDrag) return;
    if (!area.isDiscovered) return;
    selectedArea = selectedArea?.id === area.id ? null : area;
  }

  // ── Close ─────────────────────────────────────────────
  function close() { dispatch('close'); }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (selectedArea) { selectedArea = null; }
      else if (viewMode === 'areas') { backToDashboard(); }
      else if (viewMode === 'dashboard') { backToDistricts(); }
      else { close(); }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="backdrop" on:click|self={close} transition:fade={{ duration: 180 }}>
  <div class="modal">

    <!-- Header -->
    <div class="modal-header">
      {#if viewMode === 'areas'}
        <button class="back-btn" on:click={backToDashboard}>◂ 返回</button>
        <span class="modal-title">{expandedDistrictLabel}</span>
      {:else if viewMode === 'dashboard'}
        <button class="back-btn" on:click={backToDistricts}>◂ 返回</button>
        <span class="modal-title">{focusedDistrict?.label ?? ''}</span>
      {:else}
        <span class="modal-title">{data?.regionName ?? '地圖'}</span>
      {/if}
      <button class="close-btn" on:click={close}>✕</button>
    </div>

    <div class="modal-body">
      {#if data}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="map-viewport"
          class:vp-locked={viewMode === 'dashboard'}
          on:wheel|preventDefault={onWheel}
          on:pointerdown={onPointerDown}
          on:pointermove={onPointerMove}
          on:pointerup={onPointerUp}
          on:pointercancel={onPointerUp}
          on:click|self={onViewportClick}
        >
          <!-- Time display -->
          <div class="time-display">{displayTime}</div>

          <svg
            width={SVG_W} height={SVG_H}
            viewBox="0 0 {SVG_W} {SVG_H}"
            class="region-svg"
            class:svg-smooth={viewMode === 'dashboard'}
            style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: center;"
            on:click|self={onViewportClick}
          >
            <!-- District layer -->
            <g class="view-layer" class:view-active={viewMode === 'districts' || viewMode === 'dashboard'} class:view-hidden={viewMode === 'areas'}>
              {#each districtEdges as e}
                <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} class="d-edge" />
              {/each}

              {#each data.districts as district}
                {@const pos = districtLayout.get(district.id)}
                {#if pos}
                  {@const bw = district.isCurrent ? BLOCK_W_CURRENT : BLOCK_W}
                  {@const bh = district.isCurrent ? BLOCK_H_CURRENT : BLOCK_H}
                  {@const isShaking = shakeDistrictId === district.id}
                  {@const isFocused = focusedDistrictId === district.id && viewMode === 'dashboard'}

                  {#if district.isCurrent}
                    <rect x={pos.x - bw/2 - 5} y={pos.y - bh/2 - 5} width={bw + 10} height={bh + 10} rx="3" class="d-pulse" />
                  {/if}

                  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                  <rect
                    x={pos.x - bw/2} y={pos.y - bh/2} width={bw} height={bh} rx="2"
                    class="d-block"
                    class:d-current={district.isCurrent}
                    class:d-discovered={district.isDiscovered && !district.isCurrent}
                    class:d-undiscovered={!district.isDiscovered}
                    class:d-shake={isShaking}
                    class:d-focused={isFocused}
                    on:click|stopPropagation={() => onDistrictClick(district.id, district.isDiscovered)}
                    style="cursor: {viewMode === 'dashboard' ? 'default' : 'pointer'}"
                  />
                  <text
                    x={pos.x} y={pos.y + 1}
                    class="d-label" class:d-label-current={district.isCurrent} class:d-label-undiscovered={!district.isDiscovered}
                    text-anchor="middle" dominant-baseline="middle"
                    on:click|stopPropagation={() => onDistrictClick(district.id, district.isDiscovered)}
                    style="cursor: {viewMode === 'dashboard' ? 'default' : 'pointer'}"
                  >{district.isDiscovered ? district.label : '???'}</text>
                {/if}
              {/each}
            </g>

            <!-- Area map layer -->
            <g class="view-layer" class:view-active={viewMode === 'areas'} class:view-hidden={viewMode !== 'areas'}>
              {#if expandedGraph}
                {#each expandedEdges as e}
                  <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} class="a-edge" />
                {/each}
                {#each expandedGraph.nodes as area}
                  {@const pos = expandedLayout.get(area.id)}
                  {#if pos}
                    {#if area.isCurrent}
                      <circle cx={pos.x} cy={pos.y} r={13} class="a-pulse" />
                    {/if}
                    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                    <circle
                      cx={pos.x} cy={pos.y} r={area.isCurrent ? 7 : 5}
                      class="a-node" class:a-current={area.isCurrent} class:a-undiscovered={!area.isDiscovered} class:a-selected={selectedArea?.id === area.id}
                      on:click|stopPropagation={() => onAreaClick(area)}
                      style="cursor: {area.isDiscovered ? 'pointer' : 'default'}"
                    />
                    <text
                      x={pos.x} y={pos.y + (area.isCurrent ? 13 : 11)}
                      class="a-label" class:a-label-current={area.isCurrent} class:a-label-undiscovered={!area.isDiscovered}
                      text-anchor="middle"
                      on:click|stopPropagation={() => onAreaClick(area)}
                      style="cursor: {area.isDiscovered ? 'pointer' : 'default'}"
                    >{area.isDiscovered ? area.name : '???'}</text>
                  {/if}
                {/each}
              {/if}
            </g>
          </svg>

          <!-- ── Dashboard overlay cards ───────────────── -->
          {#if viewMode === 'dashboard' && focusedDistrict}
            <!-- Top cards: control & alert -->
            <div class="dash-cards-top" transition:fade={{ duration: 200 }}>
              <div class="dash-card">
                <span class="dash-card-label">管制程度</span>
                <span class="dash-card-value" class:dash-placeholder={focusedDistrict.controlLevel == null}>
                  {focusedDistrict.controlLevel != null
                    ? `${CONTROL_LABELS[focusedDistrict.controlLevel] ?? focusedDistrict.controlLevel} (${focusedDistrict.controlLevel})`
                    : '---'}
                </span>
              </div>
              <div class="dash-card">
                <span class="dash-card-label">警戒</span>
                <span class="dash-card-value" class:dash-placeholder={focusedDistrict.alertLevel == null}>
                  {focusedDistrict.alertLevel != null
                    ? `${ALERT_LABELS[focusedDistrict.alertLevel] ?? focusedDistrict.alertLevel} (${focusedDistrict.alertLevel})`
                    : '---'}
                </span>
              </div>
            </div>

            <!-- Right card: description & NPCs -->
            <div class="dash-card-right" transition:fade={{ duration: 200 }}>
              <div class="dash-card-right-inner">
                {#if focusedDistrict.description}
                  <div class="dash-desc">{focusedDistrict.description}</div>
                {/if}

                {#if focusedDistrict.ambience && focusedDistrict.ambience.length > 0}
                  <div class="dash-ambience">
                    {#each focusedDistrict.ambience as tag}
                      <span class="dash-tag">{tag}</span>
                    {/each}
                  </div>
                {/if}

                {#if focusedDistrict.notableNpcs && focusedDistrict.notableNpcs.length > 0}
                  <div class="dash-section">
                    <span class="dash-section-label">重要人物</span>
                    {#each focusedDistrict.notableNpcs as name}
                      <div class="dash-npc">{name}</div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>

            <!-- Bottom: view map button -->
            <div class="dash-bottom" transition:fade={{ duration: 200 }}>
              <button class="dash-view-btn" on:click|stopPropagation={openAreaMap}>查看地區地圖 ▸</button>
            </div>
          {/if}

          <!-- Legend -->
          {#if viewMode !== 'dashboard'}
            <div class="legend">
              {#if viewMode === 'districts'}
                <div class="legend-row"><span class="legend-swatch lg-current"></span> 目前所在</div>
                <div class="legend-row"><span class="legend-swatch lg-discovered"></span> 已發現</div>
                <div class="legend-row"><span class="legend-swatch lg-undiscovered"></span> 未發現</div>
                <div class="legend-hint">點擊象限查看資訊</div>
              {:else}
                <div class="legend-row"><span class="legend-swatch lg-current"></span> 目前所在</div>
                <div class="legend-row"><span class="legend-swatch lg-discovered"></span> 已發現</div>
                <div class="legend-row"><span class="legend-swatch lg-undiscovered-dot"></span> 未發現</div>
                <div class="legend-divider"></div>
                <div class="legend-row"><span class="legend-icon lg-lock">✕</span> 路徑限制</div>
                <div class="legend-row"><span class="legend-icon lg-bypass">→</span> 可繞行</div>
                <div class="legend-row"><span class="legend-line lg-cross-area"></span> 跨地點路徑</div>
                <div class="legend-hint">點擊地點查看詳情</div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Area detail panel (areas mode) -->
        <div class="detail-panel" class:detail-panel-open={viewMode === 'areas' && !!selectedArea}>
          <div class="detail-inner">
            {#if selectedArea}
              <div class="detail-header">
                <span class="detail-title">{selectedArea.name}</span>
                <button class="detail-close" on:click={() => selectedArea = null}>✕</button>
              </div>
              {#if selectedArea.description}
                <div class="detail-desc">{selectedArea.description}</div>
              {/if}
              <div class="detail-section">
                <span class="detail-section-label">探索進度</span>
                <div class="detail-progress">
                  <span class="detail-progress-num">{selectedArea.discoveredSubCount}</span>
                  <span class="detail-progress-sep">/</span>
                  <span class="detail-progress-den">{selectedArea.totalSubCount}</span>
                  <span class="detail-progress-label">個子區域已發現</span>
                </div>
                {#if selectedArea.totalSubCount > 0}
                  <div class="detail-bar-wrap">
                    <div class="detail-bar" style="width:{Math.round((selectedArea.discoveredSubCount / selectedArea.totalSubCount) * 100)}%"></div>
                  </div>
                {/if}
              </div>
              {#if selectedArea.isCurrent}
                <div class="detail-here">◉ 你在這裡</div>
              {/if}
            {/if}
          </div>
        </div>
      {:else}
        <div class="no-data">載入中…</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex; align-items: center; justify-content: center;
    z-index: 100; backdrop-filter: blur(2px);
  }
  .modal {
    background: var(--bg-secondary, #0c1a24);
    border: 1px solid var(--border, #1e3040);
    border-radius: 2px;
    display: flex; flex-direction: column;
    overflow: hidden; max-width: 92vw; max-height: 90vh;
  }
  .modal-body { display: flex; flex: 1; overflow: hidden; }

  /* ── Header ──────────────────────────── */
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px 8px; border-bottom: 1px solid var(--border, #1e3040); gap: 8px;
  }
  .modal-title {
    font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
    color: var(--text-dim, #445a68); font-family: var(--font-mono, monospace); flex: 1;
  }
  .close-btn, .back-btn {
    background: none; border: none; color: var(--text-dim, #445a68);
    cursor: pointer; font-size: 11px; font-family: var(--font-mono, monospace);
    padding: 2px 6px; line-height: 1; transition: color 0.1s; flex-shrink: 0;
  }
  .close-btn:hover, .back-btn:hover { color: var(--text-primary, #cce0ec); }

  /* ── Viewport ────────────────────────── */
  .map-viewport {
    position: relative; overflow: hidden; padding: 8px 12px;
    cursor: grab; touch-action: none; user-select: none; flex: 1; min-width: 0;
  }
  .map-viewport:active { cursor: grabbing; }
  .vp-locked { cursor: default; }
  .vp-locked:active { cursor: default; }

  .region-svg { display: block; transition: transform 0.08s ease-out; }
  .svg-smooth { transition: transform 0.5s ease-out; }

  /* ── Time ─────────────────────────────── */
  .time-display {
    position: absolute; top: 10px; left: 14px;
    font-size: 16px; font-family: var(--font-mono, monospace); font-weight: 700;
    letter-spacing: 0.18em; color: var(--text-dim, #445a68); opacity: 0.5;
    pointer-events: none; z-index: 2;
    text-shadow: 0 0 8px rgba(0, 200, 224, 0.12);
  }

  /* ── View layer crossfade ────────────── */
  .view-layer { transition: opacity 0.3s ease-out, transform 0.3s ease-out; }
  .view-active { opacity: 1; transform: scale(1); pointer-events: all; }
  .view-hidden { opacity: 0; pointer-events: none; }
  g.view-layer:first-of-type.view-hidden { transform: scale(0.85); }
  g.view-layer:last-of-type.view-hidden { transform: scale(1.15); }

  /* ── District elements ───────────────── */
  .d-edge { stroke: #162535; stroke-width: 1.5; opacity: 0.5; }
  .d-block { stroke-width: 1.5; transition: fill 0.15s, stroke 0.15s, opacity 0.15s; }
  .d-current { fill: #0e2535; stroke: var(--accent, #00c8e0); filter: drop-shadow(0 0 8px var(--accent, #00c8e0)); }
  .d-discovered { fill: #0c1820; stroke: #2a4e60; }
  .d-discovered:hover { stroke: #4a7a90; fill: #0e2030; }
  .d-undiscovered { fill: #080e14; stroke: #141e28; opacity: 0.55; }
  .d-undiscovered:hover { opacity: 0.7; }
  .d-focused { stroke: var(--accent, #00c8e0); stroke-width: 2; filter: drop-shadow(0 0 6px var(--accent, #00c8e0)); }
  .d-shake { animation: districtShake 0.5s ease-out; stroke: #d35f5f !important; filter: drop-shadow(0 0 6px #d35f5f88); }
  @keyframes districtShake {
    0% { transform: translateX(0); } 15% { transform: translateX(-3px); }
    30% { transform: translateX(3px); } 45% { transform: translateX(-2px); }
    60% { transform: translateX(1px); } 100% { transform: translateX(0); }
  }
  .d-label { font-size: 9px; font-family: var(--font-mono, monospace); fill: #5a7a90; pointer-events: all; paint-order: stroke; stroke: var(--bg-secondary, #0c1a24); stroke-width: 2.5; stroke-linejoin: round; }
  .d-label-current { fill: var(--accent, #00c8e0); font-size: 10px; }
  .d-label-undiscovered { fill: #2a3a48; font-size: 8px; font-style: italic; }
  .d-pulse { fill: none; stroke: var(--accent, #00c8e0); stroke-width: 1; opacity: 0; animation: d-pulse 3s ease-in-out infinite; }
  @keyframes d-pulse { 0% { opacity: 0; } 40% { opacity: 0.25; } 100% { opacity: 0; } }

  /* ── Dashboard cards ─────────────────── */
  .dash-cards-top {
    position: absolute; top: 60px; left: 34.3%; transform: translateX(-60%);
    display: flex; gap: 8px; z-index: 3; pointer-events: none;
  }
  .dash-card {
    background: rgba(8, 16, 24, 0.78); backdrop-filter: blur(6px);
    border: 1px solid rgba(30, 48, 64, 0.5); border-radius: 3px;
    padding: 6px 14px; display: flex; flex-direction: column; align-items: center; gap: 2px;
  }
  .dash-card-label {
    font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--text-dim, #445a68); font-family: var(--font-mono, monospace);
  }
  .dash-card-value {
    font-size: 11px; font-family: var(--font-mono, monospace); font-weight: 600;
    letter-spacing: 0.08em; color: var(--text-secondary, #8aacbf);
  }
  .dash-placeholder { color: var(--text-dim, #445a68); opacity: 0.4; }

  .dash-card-right {
    position: absolute; top: 0; right: 0; bottom: 0; width: 210px;
    background: rgba(8, 16, 24, 0.78); backdrop-filter: blur(6px);
    border-left: 1px solid rgba(30, 48, 64, 0.5);
    z-index: 3; overflow: hidden;
  }
  .dash-card-right-inner {
    width: 210px; height: 100%; box-sizing: border-box;
    padding: 10px 12px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 10px;
  }
  .dash-desc {
    font-size: 10px; color: var(--text-secondary, #8aacbf); line-height: 1.6;
    border-bottom: 1px solid rgba(30, 48, 64, 0.4); padding-bottom: 8px;
  }
  .dash-ambience {
    display: flex; flex-wrap: wrap; gap: 4px;
    padding-bottom: 6px; border-bottom: 1px solid rgba(30, 48, 64, 0.4);
  }
  .dash-tag {
    font-size: 8px; font-family: var(--font-mono, monospace); color: var(--text-dim, #445a68);
    background: rgba(30, 48, 64, 0.3); padding: 1px 5px; border-radius: 2px; letter-spacing: 0.04em;
  }
  .dash-section { display: flex; flex-direction: column; gap: 4px; }
  .dash-section-label {
    font-size: 9px; letter-spacing: 0.1em; color: var(--text-dim, #445a68);
    text-transform: uppercase; font-family: var(--font-mono, monospace); margin-bottom: 2px;
  }
  .dash-npc { font-size: 10px; color: var(--text-secondary, #8aacbf); font-family: var(--font-mono, monospace); padding-left: 6px; }

  .dash-bottom {
    position: absolute; bottom: 25px; left: 34%; transform: translateX(-60%);
    z-index: 3;
  }
  .dash-view-btn {
    background: rgba(8, 16, 24, 0.78); backdrop-filter: blur(6px);
    border: 1px solid var(--accent, #00c8e0); color: var(--accent, #00c8e0);
    font-family: var(--font-mono, monospace); font-size: 10px; letter-spacing: 0.1em;
    padding: 6px 20px; cursor: pointer; border-radius: 2px;
    transition: background 0.12s, color 0.12s;
  }
  .dash-view-btn:hover { background: rgba(0, 200, 224, 0.15); color: var(--text-primary, #cce0ec); }

  /* ── Area elements ───────────────────── */
  .a-edge { stroke: #1e3545; stroke-width: 1.5; opacity: 0.5; }
  .a-node { fill: #0e2233; stroke: #3a6878; stroke-width: 1.2; transition: stroke 0.12s, fill 0.12s; }
  .a-node:hover { stroke: #5a8a98; }
  .a-current { fill: var(--accent, #00c8e0); stroke: var(--accent, #00c8e0); filter: drop-shadow(0 0 4px var(--accent, #00c8e0)); }
  .a-undiscovered { fill: #080f16; stroke: #182430; opacity: 0.4; stroke-dasharray: 2 2; }
  .a-selected { stroke: var(--accent, #00c8e0); stroke-width: 2; filter: drop-shadow(0 0 4px var(--accent, #00c8e0)); }
  .a-pulse { fill: none; stroke: var(--accent, #00c8e0); stroke-width: 1; opacity: 0; animation: d-pulse 2.4s ease-in-out infinite; }
  .a-label { font-size: 8.5px; font-family: var(--font-mono, monospace); fill: var(--text-secondary, #8aacbf); pointer-events: all; paint-order: stroke; stroke: var(--bg-secondary, #0c1a24); stroke-width: 2.5; stroke-linejoin: round; }
  .a-label-current { fill: var(--accent, #00c8e0); font-size: 9px; }
  .a-label-undiscovered { fill: #2a3a48; font-style: italic; opacity: 0.6; }

  /* ── Legend ───────────────────────────── */
  .legend {
    position: absolute; bottom: 10px; left: 14px;
    background: rgba(10, 20, 30, 0.82); border: 1px solid var(--border, #1e3040);
    border-radius: 2px; padding: 6px 10px;
    display: flex; flex-direction: column; gap: 4px; pointer-events: none; z-index: 2;
  }
  .legend-row { display: flex; align-items: center; gap: 6px; font-size: 8px; font-family: var(--font-mono, monospace); color: var(--text-dim, #445a68); }
  .legend-swatch { width: 10px; height: 10px; border-radius: 1px; flex-shrink: 0; }
  .lg-current { background: var(--accent, #00c8e0); box-shadow: 0 0 4px var(--accent, #00c8e0); }
  .lg-discovered { background: #0c1820; border: 1px solid #2a4e60; }
  .lg-undiscovered { background: #080e14; border: 1px solid #141e28; opacity: 0.6; }
  .lg-undiscovered-dot { width: 8px; height: 8px; border-radius: 50%; background: #080f16; border: 1px dashed #182430; opacity: 0.5; margin: 0 1px; }
  .legend-divider { height: 1px; background: var(--border, #1e3040); opacity: 0.5; margin: 1px 0; }
  .legend-icon { width: 10px; flex-shrink: 0; text-align: center; font-size: 8px; line-height: 1; }
  .lg-lock { color: #d35f5f; }
  .lg-bypass { color: #8a7a40; }
  .legend-line { width: 14px; height: 2px; flex-shrink: 0; border-radius: 1px; }
  .lg-cross-area { background: #8a7a40; opacity: 0.7; }
  .legend-hint { font-size: 7.5px; font-family: var(--font-mono, monospace); color: var(--text-dim, #445a68); opacity: 0.6; margin-top: 2px; font-style: italic; }

  /* ── Detail panel (areas mode) ────────── */
  .detail-panel {
    width: 0; flex-shrink: 0; border-left: 0 solid var(--border, #1e3040);
    background: var(--bg-secondary, #0c1a24); overflow: hidden;
    transition: width 0.25s ease-out, border-left-width 0.25s ease-out;
  }
  .detail-panel-open { width: 200px; border-left-width: 1px; }
  .detail-inner {
    width: 200px; padding: 10px 12px;
    display: flex; flex-direction: column; gap: 10px;
    overflow-y: auto; height: 100%; box-sizing: border-box;
  }
  .detail-header { display: flex; justify-content: space-between; align-items: center; }
  .detail-title { font-size: 11px; color: var(--text-primary, #cce0ec); font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail-close { background: none; border: none; color: var(--text-dim, #445a68); cursor: pointer; font-size: 10px; padding: 0 2px; flex-shrink: 0; }
  .detail-close:hover { color: var(--text-primary, #cce0ec); }
  .detail-desc { font-size: 10px; color: var(--text-secondary, #8aacbf); line-height: 1.55; border-bottom: 1px solid var(--border, #1e3040); padding-bottom: 8px; }
  .detail-section { display: flex; flex-direction: column; gap: 4px; }
  .detail-section-label { font-size: 9px; letter-spacing: 0.1em; color: var(--text-dim, #445a68); text-transform: uppercase; font-family: var(--font-mono, monospace); }
  .detail-progress { font-size: 10px; font-family: var(--font-mono, monospace); color: var(--text-secondary, #8aacbf); display: flex; align-items: baseline; gap: 2px; }
  .detail-progress-num { color: var(--accent, #00c8e0); font-weight: 600; }
  .detail-progress-sep { color: var(--text-dim, #445a68); }
  .detail-progress-den { color: var(--text-dim, #445a68); }
  .detail-progress-label { font-size: 9px; color: var(--text-dim, #445a68); margin-left: 4px; }
  .detail-bar-wrap { height: 3px; background: var(--bg-tertiary, #101c28); border-radius: 2px; overflow: hidden; margin-top: 2px; }
  .detail-bar { height: 100%; background: var(--accent, #00c8e0); border-radius: 2px; transition: width 0.3s ease; min-width: 1px; }
  .detail-here { font-size: 9px; color: var(--accent, #00c8e0); font-family: var(--font-mono, monospace); opacity: 0.85; margin-top: 4px; }

  .no-data { padding: 20px; font-size: 11px; font-family: var(--font-mono, monospace); color: var(--text-dim, #445a68); }
</style>
