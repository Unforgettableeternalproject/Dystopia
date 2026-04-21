<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MiniMapData } from '$lib/stores/gameStore';
  import { bfsLayout } from '$lib/utils/mapLayout';

  export let data: MiniMapData | undefined = undefined;

  const dispatch = createEventDispatcher<{ openRegionMap: void }>();

  const W = 156;
  const H = 136;
  const R_SUBLOC  = 4.5;
  const R_AREA    = 5.5;
  const R_CURRENT = 6.5;

  let hoveredId: string | null = null;

  $: startId = data?.nodes.find(n => n.isCurrent)?.id ?? data?.nodes[0]?.id ?? '';
  $: layout  = data
    ? bfsLayout(data.nodes.map(n => ({ id: n.id, connections: n.connections })), startId, W, H)
    : new Map<string, { x: number; y: number }>();

  // Deduplicate edges: only draw A→B once (not B→A as well)
  $: edges = (() => {
    if (!data) return [] as Array<{ x1: number; y1: number; x2: number; y2: number; dim: boolean }>;
    const seen = new Set<string>();
    const result: Array<{ x1: number; y1: number; x2: number; y2: number; dim: boolean }> = [];
    for (const node of data.nodes) {
      for (const connId of node.connections) {
        const key = [node.id, connId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const from = layout.get(node.id);
        const to   = layout.get(connId);
        if (!from || !to) continue;
        const connNode = data.nodes.find(n => n.id === connId);
        result.push({
          x1: from.x, y1: from.y,
          x2: to.x,   y2: to.y,
          dim: !node.isDiscovered || !connNode?.isDiscovered,
        });
      }
    }
    return result;
  })();
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="minimap-wrap" on:click={() => dispatch('openRegionMap')}>
  {#if data && data.nodes.length > 0}
    <svg width={W} height={H} viewBox="0 0 {W} {H}" class="minimap-svg">
      <!-- Edges -->
      {#each edges as e}
        <line
          x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          class="edge" class:edge-dim={e.dim}
        />
      {/each}

      <!-- Nodes -->
      {#each data.nodes as node}
        {@const pos = layout.get(node.id)}
        {#if pos}
          {@const r = node.isCurrent ? R_CURRENT : node.isArea ? R_AREA : R_SUBLOC}

          <!-- Pulse ring for current location -->
          {#if node.isCurrent}
            <circle cx={pos.x} cy={pos.y} r={r + 6} class="pulse-ring" />
          {/if}

          <!-- Node circle -->
          <circle
            cx={pos.x} cy={pos.y} r={r}
            class="node"
            class:node-current={node.isCurrent}
            class:node-area={node.isArea && !node.isCurrent}
            class:node-fog={!node.isDiscovered}
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
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 4px 2px 0;
  }

  .minimap-svg {
    display: block;
    overflow: visible;
  }

  /* ── Edges ─────────────────────────────────── */
  .edge {
    stroke: #1e3545;
    stroke-width: 1;
    opacity: 0.75;
  }
  .edge-dim {
    stroke-dasharray: 3 3;
    opacity: 0.25;
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
  .node-fog {
    fill: #080f16;
    stroke: #182430;
    stroke-dasharray: 2 2;
    opacity: 0.45;
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
    0%   { opacity: 0;   }
    30%  { opacity: 0.35; }
    100% { opacity: 0;   }
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
