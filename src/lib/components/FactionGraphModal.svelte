<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { factionGraphOpen, playerUI } from '$lib/stores/gameStore';

  function close() { factionGraphOpen.set(false); }
  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  // ── SVG dimensions ────────────────────────────────────────────
  const SVG_W = 340;
  const SVG_H = 200;

  // ── Spring layout ─────────────────────────────────────────────

  interface Pos { x: number; y: number; }
  interface Edge { a: string; b: string; weight: number; }

  function springLayout(nodeIds: string[], edges: Edge[]): Map<string, Pos> {
    const n = nodeIds.length;
    if (n === 0) return new Map();
    if (n === 1) return new Map([[nodeIds[0], { x: SVG_W / 2, y: SVG_H / 2 }]]);

    // Circular init, starting at top
    const pos: Record<string, Pos> = {};
    const r = Math.min(SVG_W, SVG_H) * 0.32;
    nodeIds.forEach((id, i) => {
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      pos[id] = {
        x: SVG_W / 2 + r * Math.cos(angle),
        y: SVG_H / 2 + r * Math.sin(angle),
      };
    });

    // Edge weight lookup (bidirectional)
    const ew: Record<string, number> = {};
    for (const e of edges) {
      ew[`${e.a}|${e.b}`] = e.weight;
      ew[`${e.b}|${e.a}`] = e.weight;
    }

    // Spring simulation (Fruchterman–Reingold style)
    const ITERS   = 80;
    const PAD     = 18;   // pixel padding from SVG edge
    const REP     = 250;  // base repulsion constant

    for (let iter = 0; iter < ITERS; iter++) {
      const cool = 1 - iter / ITERS;
      const delta: Record<string, Pos> = {};
      for (const id of nodeIds) delta[id] = { x: 0, y: 0 };

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = nodeIds[i], b = nodeIds[j];
          const dx = pos[b].x - pos[a].x;
          const dy = pos[b].y - pos[a].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.5);
          const ux = dx / dist, uy = dy / dist;

          const w = ew[`${a}|${b}`];
          let fx: number, fy: number;

          if (w !== undefined) {
            // Spring: positive weight → shorter rest length (attract together)
            //         negative weight → longer rest length (push apart)
            // Tuned so weight=3 ≈ 14px apart, weight=0 ≈ 50px, weight=-3 ≈ 86px
            const restLen = 50 - w * 12;
            const springF  = (dist - restLen) * 0.22 * cool;
            fx = springF * ux;
            fy = springF * uy;
          } else {
            // Pure repulsion for unconnected nodes
            const repF = (REP / (dist * dist)) * cool;
            fx = -repF * ux;
            fy = -repF * uy;
          }

          delta[a].x += fx; delta[a].y += fy;
          delta[b].x -= fx; delta[b].y -= fy;
        }
      }

      // Apply forces with boundary clamping
      for (const id of nodeIds) {
        pos[id].x = Math.max(PAD, Math.min(SVG_W - PAD, pos[id].x + delta[id].x));
        pos[id].y = Math.max(PAD, Math.min(SVG_H - PAD, pos[id].y + delta[id].y));
      }
    }

    return new Map(nodeIds.map(id => [id, pos[id]]));
  }

  // ── Player projection ─────────────────────────────────────────

  function playerProjection(
    nodes: Array<{ id: string; rep: number }>,
    layout: Map<string, Pos>,
  ): Pos {
    const placed = nodes.map(n => ({ ...layout.get(n.id)!, rep: n.rep })).filter(n => n.x !== undefined);
    if (placed.length === 0) return { x: SVG_W / 2, y: SVG_H / 2 };
    if (placed.length === 1) return { x: placed[0].x, y: placed[0].y };

    const cx = placed.reduce((s, p) => s + p.x, 0) / placed.length;
    const cy = placed.reduce((s, p) => s + p.y, 0) / placed.length;
    const totalAbsRep = placed.reduce((s, p) => s + Math.abs(p.rep), 0);
    if (totalAbsRep === 0) return { x: cx, y: cy };

    const wx = placed.reduce((s, p) => s + p.rep * (p.x - cx), 0) / totalAbsRep;
    const wy = placed.reduce((s, p) => s + p.rep * (p.y - cy), 0) / totalAbsRep;
    return {
      x: Math.max(12, Math.min(SVG_W - 12, cx + wx)),
      y: Math.max(12, Math.min(SVG_H - 12, cy + wy)),
    };
  }

  // ── Visual helpers ────────────────────────────────────────────

  function edgeColor(weight: number): string {
    if (weight >= 2)  return '#7ec8a0';   // allies
    if (weight > 0)   return '#5fa8d3';   // friendly
    if (weight <= -2) return '#d35f5f';   // hostile
    if (weight < 0)   return '#c9a96e';   // unfriendly
    return '#4a4a4a';                      // neutral
  }

  function edgeDash(weight: number): string {
    return weight === 0 ? '4 3' : 'none';
  }

  function nodeColor(rep: number, revealed: boolean): string {
    if (!revealed) return '#555';
    if (rep > 20)  return '#7ec8a0';
    if (rep > 0)   return '#5fa8d3';
    if (rep < -20) return '#d35f5f';
    if (rep < 0)   return '#c9a96e';
    return '#888';
  }

  function repSign(rep: number): string {
    return rep > 0 ? `+${rep}` : `${rep}`;
  }

  function repColor(rep: number): string {
    if (rep > 30)  return '#7ec8a0';
    if (rep > 0)   return '#5fa8d3';
    if (rep < -30) return '#d35f5f';
    if (rep < 0)   return '#c9a96e';
    return 'var(--text-dim)';
  }

  // ── Reactive graph data ───────────────────────────────────────

  $: graph   = $playerUI.factionGraphUI;
  $: bars    = $playerUI.allFactionRep ?? [];
  $: maxAbs  = Math.max(...bars.map(f => Math.abs(f.rep)), 1);

  $: nodeIds = graph ? [...graph.nodes].map(n => n.id).sort() : [];
  $: layout  = springLayout(nodeIds, graph?.edges ?? []);
  $: playerPos = graph ? playerProjection(graph.nodes, layout) : null;

  function barPct(rep: number): number {
    return Math.min(Math.abs(rep) / maxAbs, 1) * 100;
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click={handleBg}>
  <aside class="modal-panel" transition:fly={{ y: -8, duration: 200, easing: cubicOut }} role="dialog" aria-label="陣營關係">

    <div class="modal-header">
      <span class="modal-title">陣 營 關 係</span>
      <button class="close-btn" on:click={close} aria-label="關閉">✕</button>
    </div>

    <div class="modal-body">

      {#if !graph}
        <!-- No discovered factions yet -->
        <div class="empty-state">
          <span class="empty-icon">◇</span>
          <p class="empty-text">尚無與任何派系的互動記錄。</p>
        </div>

      {:else}

        <!-- ── Faction Graph SVG ─────────────────────── -->
        <div class="graph-section">
          <div class="section-label">派系關係圖</div>
          <div class="svg-wrap">
            <svg width={SVG_W} height={SVG_H} viewBox="0 0 {SVG_W} {SVG_H}">

              <!-- Edges (draw first, under nodes) -->
              {#each graph.edges as edge}
                {@const pa = layout.get(edge.a)}
                {@const pb = layout.get(edge.b)}
                {#if pa && pb}
                  <line
                    x1={pa.x} y1={pa.y}
                    x2={pb.x} y2={pb.y}
                    stroke={edgeColor(edge.weight)}
                    stroke-width="1.5"
                    stroke-dasharray={edgeDash(edge.weight)}
                    opacity="0.55"
                  />
                {/if}
              {/each}

              <!-- Player projection -->
              {#if playerPos && graph.nodes.length > 0}
                <circle cx={playerPos.x} cy={playerPos.y} r="8" fill="none" stroke="#c9a96e" stroke-width="1" opacity="0.35" />
                <circle cx={playerPos.x} cy={playerPos.y} r="4" fill="#c9a96e" opacity="0.9" />
                <text
                  x={playerPos.x + 7} y={playerPos.y - 5}
                  font-size="8" fill="#c9a96e" font-family="var(--font-mono)"
                  opacity="0.85"
                >你</text>
              {/if}

              <!-- Faction nodes (draw last, on top) -->
              {#each graph.nodes as node}
                {@const p = layout.get(node.id)}
                {#if p}
                  {@const col = nodeColor(node.rep, node.revealed)}
                  <circle cx={p.x} cy={p.y} r="6" fill={col} opacity="0.9" />
                  <!-- Name label -->
                  <text
                    x={p.x} y={p.y - 10}
                    text-anchor="middle"
                    font-size="9"
                    fill={node.revealed ? 'var(--text-secondary)' : '#666'}
                    font-family="var(--font-mono)"
                  >{node.displayName}</text>
                  <!-- Rep label -->
                  {#if node.rep !== 0}
                    <text
                      x={p.x} y={p.y + 19}
                      text-anchor="middle"
                      font-size="8"
                      fill={col}
                      opacity="0.75"
                      font-family="var(--font-mono)"
                    >{repSign(node.rep)}</text>
                  {/if}
                {/if}
              {/each}

            </svg>
          </div>

          <!-- Legend -->
          <div class="legend">
            <span class="legend-item ally">─ 合作</span>
            <span class="legend-item neutral">╌ 中立</span>
            <span class="legend-item hostile">─ 敵對</span>
            <span class="legend-item player">◉ 你</span>
          </div>
        </div>

        <!-- ── Rep bar list ─────────────────────────── -->
        {#if bars.length > 0}
          <div class="rep-section">
            <div class="section-label">聲望明細</div>
            <div class="faction-list">
              {#each bars as f}
                {@const color = repColor(f.rep)}
                <div class="faction-row">
                  <span class="faction-name">{f.name}</span>
                  <div class="bar-wrap">
                    {#if f.rep < 0}
                      <div class="bar-fill neg" style="width: {barPct(f.rep)}%; background: {color}"></div>
                    {:else}
                      <div class="bar-fill-placeholder neg"></div>
                    {/if}
                    <div class="bar-center"></div>
                    {#if f.rep > 0}
                      <div class="bar-fill pos" style="width: {barPct(f.rep)}%; background: {color}"></div>
                    {:else}
                      <div class="bar-fill-placeholder pos"></div>
                    {/if}
                  </div>
                  <span class="rep-value" style="color:{color}">{f.rep > 0 ? '+' : ''}{f.rep}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

      {/if}
    </div>

  </aside>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-panel {
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 2px;
    width: 400px;
    max-height: 580px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ──────────────────────────────── */
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

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
    transition: color 0.1s;
  }
  .close-btn:hover { color: var(--text-primary); }

  /* ── Body ─────────────────────────────────── */
  .modal-body {
    padding: 14px 16px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* ── Empty state ────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 32px 0;
    flex: 1;
  }
  .empty-icon { font-size: 24px; color: var(--text-dim); opacity: 0.3; }
  .empty-text { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); margin: 0; letter-spacing: 0.04em; }

  /* ── Section label ──────────────────────── */
  .section-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  /* ── Graph section ──────────────────────── */
  .graph-section { display: flex; flex-direction: column; gap: 0; }

  .svg-wrap {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 2px;
    overflow: hidden;
    line-height: 0;
  }

  .legend {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    padding: 5px 2px 0;
  }

  .legend-item {
    font-size: 9px;
    font-family: var(--font-mono);
    color: var(--text-dim);
    opacity: 0.7;
  }
  .legend-item.ally    { color: #7ec8a0; }
  .legend-item.hostile { color: #d35f5f; }
  .legend-item.player  { color: #c9a96e; }

  /* ── Rep bar list ───────────────────────── */
  .rep-section { display: flex; flex-direction: column; }

  .faction-list { display: flex; flex-direction: column; gap: 7px; }

  .faction-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    align-items: center;
    gap: 8px;
  }

  .faction-name {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bar-wrap {
    display: flex;
    height: 3px;
    border-radius: 2px;
    overflow: hidden;
    background: var(--bg-tertiary);
  }

  .bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .bar-fill.neg { margin-left: auto; }
  .bar-fill-placeholder { flex: 1; }

  .bar-center {
    width: 2px;
    background: var(--border-accent);
    flex-shrink: 0;
    opacity: 0.4;
  }

  .rep-value {
    font-size: 10px;
    font-family: var(--font-mono);
    width: 36px;
    text-align: right;
    flex-shrink: 0;
  }
</style>
