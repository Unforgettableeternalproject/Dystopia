<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MiniMapData, MiniMapEdge } from '$lib/stores/gameStore';
  import { bfsLayout, edgesToLayoutNodes } from '$lib/utils/mapLayout';

  export let data: MiniMapData | undefined = undefined;

  const dispatch = createEventDispatcher<{ openRegionMap: void }>();

  const W = 156;
  const H = 136;
  const R_SUBLOC    = 4.5;
  const R_AREA      = 5.5;
  const R_CURRENT   = 6.5;
  const R_ADJACENT  = 5;
  const MIN_RING_STEP = 30;   // minimum pixels between BFS rings
  const MIN_ZOOM    = 0.35;
  const MAX_ZOOM    = 3.0;

  let hoveredId: string | null = null;

  // ── Pan / zoom ─────────────────────────────────────────────────────
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let isDragging = false;
  let dragMoved  = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;

  // Reset view whenever the current location changes
  let prevStartId = '';
  $: if (startId && startId !== prevStartId) {
    prevStartId = startId;
    panX = 0; panY = 0; zoom = 1;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.12 : -0.12;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    isDragging  = true;
    dragMoved   = false;
    dragStartX  = e.clientX;
    dragStartY  = e.clientY;
    dragOriginX = panX;
    dragOriginY = panY;
    e.preventDefault();   // suppress text-selection during drag
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    panX = dragOriginX + dx;
    panY = dragOriginY + dy;
  }

  function onMouseUp() {
    isDragging = false;
  }

  function onClick() {
    if (dragMoved) { dragMoved = false; return; }
    dispatch('openRegionMap');
  }

  // ── Layout ─────────────────────────────────────────────────────────
  $: startId = data?.nodes.find(n => n.isCurrent)?.id ?? data?.nodes[0]?.id ?? '';
  $: layoutNodes = data
    ? edgesToLayoutNodes(data.nodes.map(n => n.id), data.edges)
    : [];
  $: layout = data
    ? bfsLayout(layoutNodes, startId, W, H, MIN_RING_STEP)
    : new Map<string, { x: number; y: number }>();

  // Build positioned edges with metadata
  $: positionedEdges = (() => {
    if (!data) return [] as Array<PositionedEdge>;
    const result: PositionedEdge[] = [];
    for (const edge of data.edges) {
      const from = layout.get(edge.fromId);
      const to   = layout.get(edge.toId);
      if (!from || !to) continue;
      const fromNode = data.nodes.find(n => n.id === edge.fromId);
      const toNode   = data.nodes.find(n => n.id === edge.toId);
      const dim = !(fromNode?.isVisited) || !(toNode?.isVisited);
      result.push({ ...edge, x1: from.x, y1: from.y, x2: to.x, y2: to.y, dim });
    }
    return result;
  })();

  interface PositionedEdge extends MiniMapEdge {
    x1: number; y1: number; x2: number; y2: number; dim: boolean;
  }

  function nodeRadius(kind: string, isCurrent: boolean): number {
    if (isCurrent) return R_CURRENT;
    if (kind === 'area-root') return R_AREA;
    if (kind === 'adjacent-area') return R_ADJACENT;
    return R_SUBLOC;
  }

  // Compute lock/bypass icon position at midpoint of an edge
  function edgeMid(e: PositionedEdge): { x: number; y: number } {
    return { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
  }

  // Compute arrow direction from current side to target side
  function bypassArrowAngle(e: PositionedEdge): number {
    const dx = e.x2 - e.x1;
    const dy = e.y2 - e.y1;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="minimap-wrap">
  {#if data && data.nodes.length > 0}
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <svg
      width={W} height={H}
      viewBox="0 0 {W} {H}"
      class="minimap-svg"
      class:dragging={isDragging}
      role="img"
      aria-label="小地圖（雙擊重置視角）"
      on:wheel|preventDefault={onWheel}
      on:mousedown={onMouseDown}
      on:mousemove={onMouseMove}
      on:mouseup={onMouseUp}
      on:mouseleave={onMouseUp}
      on:click={onClick}
    >
      <!--
        Transform: scale around SVG centre.
        translate(cx+panX, cy+panY) scale(zoom) translate(-cx, -cy)
        makes zoom centred at (W/2, H/2).
      -->
      <g transform="translate({W / 2 + panX} {H / 2 + panY}) scale({zoom}) translate({-W / 2} {-H / 2})">

        <!-- Edges -->
        {#each positionedEdges as e}
          <line
            x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            class="edge"
            class:edge-dim={e.dim}
            class:edge-cross={e.kind === 'cross-area'}
            class:edge-remote={e.kind === 'remote-link'}
            class:edge-locked={e.isLocked}
          />

          <!-- Lock icon for locked edges -->
          {#if e.isLocked}
            {@const mid = edgeMid(e)}
            <text
              x={mid.x} y={mid.y}
              class="edge-lock-icon"
              text-anchor="middle"
              dominant-baseline="central"
            >✕{#if e.lockedMessage}<title>{e.lockedMessage}</title>{/if}</text>

            <!-- Bypass arrow -->
            {#if e.hasBypass}
              {@const angle = bypassArrowAngle(e)}
              <text
                x={mid.x + 7 * Math.cos(angle * Math.PI / 180)}
                y={mid.y + 7 * Math.sin(angle * Math.PI / 180)}
                class="edge-bypass-arrow"
                text-anchor="middle"
                dominant-baseline="central"
                transform="rotate({angle}, {mid.x + 7 * Math.cos(angle * Math.PI / 180)}, {mid.y + 7 * Math.sin(angle * Math.PI / 180)})"
              >→{#if e.bypassMessage}<title>{e.bypassMessage}</title>{/if}</text>
            {/if}
          {/if}
        {/each}

        <!-- Nodes -->
        {#each data.nodes as node}
          {@const pos = layout.get(node.id)}
          {#if pos}
            {@const r = nodeRadius(node.kind, node.isCurrent)}

            <!-- Pulse ring for current location -->
            {#if node.isCurrent}
              <circle cx={pos.x} cy={pos.y} r={r + 6} class="pulse-ring" />
            {/if}

            <!-- Node circle -->
            <circle
              cx={pos.x} cy={pos.y} r={r}
              class="node"
              class:node-current={node.isCurrent}
              class:node-area={node.kind === 'area-root' && !node.isCurrent}
              class:node-adjacent={node.kind === 'adjacent-area'}
              class:node-remote={node.kind === 'remote-sublocation'}
              class:node-known={node.isKnownButUnvisited}
              class:node-fog={!node.isVisited && !node.isKnownButUnvisited}
              on:mouseenter={() => (hoveredId = node.id)}
              on:mouseleave={() => (hoveredId = null)}
            >
              <title>{node.label}</title>
            </circle>

            <!-- Persistent label for current node -->
            {#if node.isCurrent}
              <text
                x={pos.x}
                y={pos.y + r + 9}
                class="label label-current"
                text-anchor="middle"
              >{node.label}</text>
            {/if}

            <!-- Hover label for non-current nodes -->
            {#if hoveredId === node.id && !node.isCurrent}
              <text
                x={pos.x}
                y={pos.y - r - 5}
                class="label"
                text-anchor="middle"
              >{node.label}</text>
            {/if}
          {/if}
        {/each}

      </g>
    </svg>

    <!-- District › Area breadcrumb -->
    <div class="breadcrumb">
      {#if data.districtName}
        <span class="crumb-dim">{data.districtName}</span>
        <span class="crumb-sep">›</span>
      {/if}
      <span class="crumb-area">{data.areaName}</span>
    </div>
  {:else}
    <div class="empty">—</div>
  {/if}
</div>

<style>
  .minimap-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 4px 2px 0;
  }

  .minimap-svg {
    display: block;
    overflow: hidden;   /* clip content that extends past ring min-step */
    cursor: pointer;
    border-radius: 2px;
  }
  .minimap-svg.dragging {
    cursor: grabbing;
  }

  /* ── Edges ─────────────────────────────────── */
  .edge {
    stroke: #1e3545;
    stroke-width: 1.5;
    opacity: 0.75;
  }
  .edge-dim {
    stroke-dasharray: 3 3;
    opacity: 0.3;
  }
  .edge-cross {
    stroke: #8a7a40;
    opacity: 0.6;
  }
  .edge-remote {
    stroke: #5a6a40;
    stroke-dasharray: 4 2;
    opacity: 0.5;
  }
  .edge-locked {
    opacity: 0.35;
  }

  /* ── Edge icons ─────────────────────────────── */
  .edge-lock-icon {
    font-size: 8px;
    fill: #d35f5f;
    opacity: 0.7;
    cursor: default;
  }
  .edge-bypass-arrow {
    font-size: 8px;
    fill: #8a7a40;
    opacity: 0.8;
    cursor: default;
  }

  /* ── Nodes ─────────────────────────────────── */
  .node {
    fill: #0c1e2c;
    stroke: #2a4e68;
    stroke-width: 1;
    transition: fill 0.12s;
  }
  .node-current {
    fill: var(--accent, #00c8e0);
    stroke: var(--accent, #00c8e0);
    filter: drop-shadow(0 0 5px var(--accent, #00c8e0));
  }
  .node-area {
    fill: #0e2233;
    stroke: #3a6878;
    stroke-width: 1.5;
  }
  .node-adjacent {
    fill: #1a2a1a;
    stroke: #8a7a40;
    stroke-width: 1.5;
    opacity: 0.7;
  }
  .node-remote {
    fill: #0e1e28;
    stroke: #5a6a40;
    stroke-width: 1;
    opacity: 0.6;
  }
  .node-known {
    fill: #101c28;
    stroke: #3a5868;
    stroke-dasharray: 2 2;
    opacity: 0.65;
  }
  .node-fog {
    fill: #080f16;
    stroke: #182430;
    stroke-dasharray: 2 2;
    opacity: 0.35;
  }

  /* ── Pulse animation ────────────────────────── */
  .pulse-ring {
    fill: none;
    stroke: var(--accent, #00c8e0);
    stroke-width: 1;
    opacity: 0;
    animation: pulse-fade 2.4s ease-in-out infinite;
  }
  @keyframes pulse-fade {
    0%   { opacity: 0;    }
    30%  { opacity: 0.35; }
    100% { opacity: 0;    }
  }

  /* ── Labels ─────────────────────────────────── */
  .label {
    font-size: 8.5px;
    font-family: var(--font-mono, monospace);
    fill: var(--text-secondary, #8aacbf);
    pointer-events: none;
    paint-order: stroke;
    stroke: var(--bg-secondary, #0a1520);
    stroke-width: 3;
    stroke-linejoin: round;
  }
  .label-current {
    fill: var(--accent, #00c8e0);
    font-size: 9px;
  }

  /* ── Breadcrumb ─────────────────────────────── */
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 8.5px;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.05em;
    max-width: 100%;
    overflow: hidden;
  }
  .crumb-dim  { color: var(--text-dim, #445a68);  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .crumb-sep  { color: var(--text-dim, #445a68); opacity: 0.5; flex-shrink: 0; }
  .crumb-area { color: var(--text-secondary, #8aacbf); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .empty {
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    color: var(--text-dim, #445a68);
    opacity: 0.4;
    padding: 8px 0;
  }
</style>
