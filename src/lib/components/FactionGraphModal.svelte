<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { factionGraphOpen, playerUI } from '$lib/stores/gameStore';

  function close() { factionGraphOpen.set(false); }
  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  // ── SVG virtual canvas dimensions ─────────────────────────────
  const SVG_W = 500;
  const SVG_H = 300;

  // ── Pan / Zoom state ──────────────────────────────────────────
  let vbX = 0, vbY = 0, vbW = SVG_W, vbH = SVG_H;
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let svgEl: SVGSVGElement;

  const ZOOM_MIN = SVG_W * 0.25;   // max zoom-in  (viewBox 25% of canvas)
  const ZOOM_MAX = SVG_W * 2.5;    // max zoom-out (viewBox 250% of canvas)

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
    const rect = svgEl.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width  * vbW + vbX;
    const my = (e.clientY - rect.top)  / rect.height * vbH + vbY;
    const nw = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, vbW * factor));
    const nh = nw * (SVG_H / SVG_W);
    vbX = mx - (mx - vbX) * (nw / vbW);
    vbY = my - (my - vbY) * (nh / vbH);
    vbW = nw; vbH = nh;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    svgEl.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!isPanning) return;
    const rect = svgEl.getBoundingClientRect();
    vbX -= (e.clientX - panStartX) / rect.width  * vbW;
    vbY -= (e.clientY - panStartY) / rect.height * vbH;
    panStartX = e.clientX; panStartY = e.clientY;
  }

  function onPointerUp() { isPanning = false; }

  function resetView() { vbX = 0; vbY = 0; vbW = SVG_W; vbH = SVG_H; }

  // ── Spring layout ─────────────────────────────────────────────

  interface Pos  { x: number; y: number; }
  interface Edge { a: string; b: string; weight: number; }

  function springLayout(nodeIds: string[], edges: Edge[]): Map<string, Pos> {
    const n = nodeIds.length;
    if (n === 0) return new Map();
    if (n === 1) return new Map([[nodeIds[0], { x: SVG_W / 2, y: SVG_H / 2 }]]);

    // Circular init, slightly wider radius
    const pos: Record<string, Pos> = {};
    const r = Math.min(SVG_W, SVG_H) * 0.38;
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

    const ITERS    = 150;
    const PAD      = 36;    // padding from SVG edge
    const REP      = 800;   // base repulsion constant (was 250)
    // weight=3 → restLen≈36px,  weight=0 → restLen≈90px,  weight=-3 → restLen≈144px
    const REST_BASE = 90;
    const REST_PER  = 18;
    const MIN_DIST  = 85;   // hard minimum distance between node centres

    for (let iter = 0; iter < ITERS; iter++) {
      const cool = 1 - iter / ITERS;
      const delta: Record<string, Pos> = {};
      for (const id of nodeIds) delta[id] = { x: 0, y: 0 };

      // Spring / repulsion forces
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
            const restLen = REST_BASE - w * REST_PER;
            const springF = (dist - restLen) * 0.16 * cool;
            fx = springF * ux;
            fy = springF * uy;
          } else {
            const repF = (REP / (dist * dist)) * cool;
            fx = -repF * ux;
            fy = -repF * uy;
          }

          delta[a].x += fx; delta[a].y += fy;
          delta[b].x -= fx; delta[b].y -= fy;
        }
      }

      // Apply forces
      for (const id of nodeIds) {
        pos[id].x = Math.max(PAD, Math.min(SVG_W - PAD, pos[id].x + delta[id].x));
        pos[id].y = Math.max(PAD, Math.min(SVG_H - PAD, pos[id].y + delta[id].y));
      }

      // Hard minimum-distance enforcement (post-correction)
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = nodeIds[i], b = nodeIds[j];
          const dx = pos[b].x - pos[a].x;
          const dy = pos[b].y - pos[a].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MIN_DIST && dist > 0) {
            const push = (MIN_DIST - dist) / 2 / dist;
            pos[a].x = Math.max(PAD, Math.min(SVG_W - PAD, pos[a].x - dx * push));
            pos[a].y = Math.max(PAD, Math.min(SVG_H - PAD, pos[a].y - dy * push));
            pos[b].x = Math.max(PAD, Math.min(SVG_W - PAD, pos[b].x + dx * push));
            pos[b].y = Math.max(PAD, Math.min(SVG_H - PAD, pos[b].y + dy * push));
          }
        }
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
    if (weight >= 2)  return '#7ec8a0';
    if (weight > 0)   return '#5fa8d3';
    if (weight <= -2) return '#d35f5f';
    if (weight < 0)   return '#fa9e34';
    return '#4a4a4a';
  }

  function edgeDash(weight: number): string {
    return weight === 0 ? '4 3' : 'none';
  }

  /** 邊上的文字標籤：正=友好，負=敵對，0=不顯示（虛線已暗示中立） */
  function edgeLabel(weight: number): string {
    if (weight >= 2) return '同盟';
    if (weight > 0) return '友好';
    if (weight <= -2) return '敵對';
    if (weight < 0) return '不合';
    return '';
  }

  function nodeColor(rep: number, revealed: boolean): string {
    if (!revealed) return '#555';
    if (rep > 20)  return '#7ec8a0';
    if (rep > 0)   return '#5fa8d3';
    if (rep < -20) return '#d35f5f';
    if (rep < 0)   return '#fa9e34';
    return '#888';
  }

  function repSign(rep: number): string {
    return rep > 0 ? `+${rep}` : `${rep}`;
  }

  function repColor(rep: number): string {
    if (rep > 30)  return '#7ec8a0';
    if (rep > 0)   return '#5fa8d3';
    if (rep < -30) return '#d35f5f';
    if (rep < 0)   return '#fa9e34';
    return 'var(--text-dim)';
  }

  // ── Reactive graph data ───────────────────────────────────────

  $: graph     = $playerUI.factionGraphUI;
  $: bars      = $playerUI.allFactionRep ?? [];
  $: maxAbs    = Math.max(...bars.map(f => Math.abs(f.rep)), 1);
  $: nodeIds   = graph ? [...graph.nodes].map(n => n.id).sort() : [];
  $: layout    = springLayout(nodeIds, graph?.edges ?? []);
  $: playerPos = graph ? playerProjection(graph.nodes, layout) : null;

  // Reset viewBox whenever graph data changes (new nodes discovered)
  $: if (graph) resetView();

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
        <div class="empty-state">
          <span class="empty-icon">◇</span>
          <p class="empty-text">尚無與任何派系的互動記錄。</p>
        </div>

      {:else}

        <!-- ── Faction Graph SVG ─────────────────────── -->
        <div class="graph-section">
          <div class="graph-header">
            <span class="section-label">派系關係圖</span>
            <button class="reset-view-btn" on:click={resetView} title="重置視角">⊙</button>
          </div>
          <div class="svg-wrap">
            <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
            <svg
              bind:this={svgEl}
              width="100%"
              height="260"
              viewBox="{vbX} {vbY} {vbW} {vbH}"
              style="cursor: {isPanning ? 'grabbing' : 'grab'}; display: block; user-select: none;"
              on:wheel|preventDefault={onWheel}
              on:pointerdown={onPointerDown}
              on:pointermove={onPointerMove}
              on:pointerup={onPointerUp}
              on:pointerleave={onPointerUp}
              on:dblclick={resetView}
              role="img"
              aria-label="陣營關係圖"
            >

              <!-- Edges -->
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
                    opacity="0.5"
                  />
                  <!-- Edge label at midpoint -->
                  {#if edgeLabel(edge.weight)}
                    {@const mx = (pa.x + pb.x) / 2}
                    {@const my = (pa.y + pb.y) / 2}
                    <text
                      x={mx} y={my - 4}
                      text-anchor="middle"
                      font-size="8"
                      fill={edgeColor(edge.weight)}
                      font-family="var(--font-mono)"
                      opacity="0.6"
                      pointer-events="none"
                    >{edgeLabel(edge.weight)}</text>
                  {/if}
                {/if}
              {/each}

              <!-- Player projection -->
              {#if playerPos && graph.nodes.length > 0}
                <circle cx={playerPos.x} cy={playerPos.y} r="9" fill="none" stroke="#c9a96e" stroke-width="1" opacity="0.3" />
                <circle cx={playerPos.x} cy={playerPos.y} r="4" fill="#c9a96e" opacity="0.9" />
                <text
                  x={playerPos.x + 8} y={playerPos.y - 5}
                  font-size="8" fill="#c9a96e" font-family="var(--font-mono)"
                  opacity="0.85" pointer-events="none"
                >你</text>
              {/if}

              <!-- Faction nodes -->
              {#each graph.nodes as node}
                {@const p = layout.get(node.id)}
                {#if p}
                  {@const col = nodeColor(node.rep, node.revealed)}
                  <circle cx={p.x} cy={p.y} r="7" fill={col} opacity="0.9" />
                  <text
                    x={p.x} y={p.y - 12}
                    text-anchor="middle"
                    font-size="9.5"
                    fill={node.revealed ? 'var(--text-secondary)' : '#666'}
                    font-family="var(--font-mono)"
                    pointer-events="none"
                  >{node.displayName}</text>
                  {#if node.rep !== 0}
                    <text
                      x={p.x} y={p.y + 21}
                      text-anchor="middle"
                      font-size="8"
                      fill={col}
                      opacity="0.75"
                      font-family="var(--font-mono)"
                      pointer-events="none"
                    >{repSign(node.rep)}</text>
                  {/if}
                {/if}
              {/each}

            </svg>
          </div>

          <div class="graph-footer">
            <div class="legend">
              <span class="legend-item ally">─ 同盟</span>
              <span class="legend-item friendly">─ 友好</span>
              <span class="legend-item neutral">╌ 中立</span>
              <span class="legend-item unfriendly">─ 不合</span>
              <span class="legend-item hostile">─ 敵對</span>
              <span class="legend-item player">◉ 你</span>
            </div>
            <span class="zoom-hint">滾輪縮放 · 拖曳平移 · 雙擊重置</span>
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
    width: 460px;
    max-height: 620px;
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

  /* ── Graph section ──────────────────────── */
  .graph-section { display: flex; flex-direction: column; gap: 0; }

  .graph-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .section-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .reset-view-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 14px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    opacity: 0.5;
    transition: opacity 0.1s;
  }
  .reset-view-btn:hover { opacity: 1; color: var(--text-secondary); }

  .svg-wrap {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 2px;
    overflow: hidden;
    line-height: 0;
  }

  .graph-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 2px 0;
  }

  .legend {
    display: flex;
    gap: 10px;
  }

  .legend-item {
    font-size: 9px;
    font-family: var(--font-mono);
    color: var(--text-dim);
    opacity: 0.7;
  }
  .legend-item.ally    { color: #7ec8a0; }
  .legend-item.friendly { color: #5fa8d3; }
  .legend-item.neutral  { color: #4a4a4a; }
  .legend-item.unfriendly { color: #fa9e34; }
  .legend-item.hostile { color: #d35f5f; }
  .legend-item.player  { color: #c9a96e; }

  .zoom-hint {
    font-size: 8.5px;
    color: var(--text-dim);
    opacity: 0.4;
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }

  /* ── Rep bar list ───────────────────────── */
  .rep-section { display: flex; flex-direction: column; gap: 8px; }

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
