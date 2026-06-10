<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { factionGraphOpen, playerUI } from '$lib/stores/gameStore';
  import type { FactionTreeDetail } from '$lib/stores/gameStore';

  function close() { factionGraphOpen.set(false); selectedFactionId = null; }
  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  // ── Faction tree detail selection ─────────────────────────────
  let selectedFactionId: string | null = null;

  $: treeDetails = $playerUI.factionTreeDetails ?? {};
  $: selectedDetail = selectedFactionId ? treeDetails[selectedFactionId] ?? null : null;

  function selectFaction(id: string) {
    selectedFactionId = selectedFactionId === id ? null : id;
  }

  function questStatusIcon(status: string): string {
    switch (status) {
      case 'completed': return '◆';
      case 'active':    return '◈';
      case 'available': return '◇';
      case 'failed':    return '✕';
      case 'ditched':   return '⊘';
      default:          return '·';
    }
  }

  function questStatusColor(status: string): string {
    switch (status) {
      case 'completed': return '#7ec8a0';
      case 'active':    return '#c9a96e';
      case 'available': return '#5fa8d3';
      case 'failed':    return '#d35f5f';
      case 'ditched':   return '#fa9e34';
      default:          return '#555';
    }
  }

  function creditBarPercent(credit: number, limits?: { positive: number; negative: number }): { left: number; width: number } {
    if (!limits) return { left: 50, width: 0 };
    const range = limits.positive - limits.negative;
    const zeroPos = Math.abs(limits.negative) / range * 100;
    const creditPos = (credit - limits.negative) / range * 100;
    if (credit >= 0) {
      return { left: zeroPos, width: creditPos - zeroPos };
    } else {
      return { left: creditPos, width: zeroPos - creditPos };
    }
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

              <!-- Faction nodes (clickable) -->
              {#each graph.nodes as node}
                {@const p = layout.get(node.id)}
                {#if p}
                  {@const col = nodeColor(node.rep, node.revealed)}
                  {@const isSelected = selectedFactionId === node.id}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <!-- svelte-ignore a11y-no-static-element-interactions -->
                  <g class="faction-node-g" style="cursor: pointer;" on:click|stopPropagation={() => selectFaction(node.id)}>
                    {#if isSelected}
                      <circle cx={p.x} cy={p.y} r="12" fill="none" stroke={col} stroke-width="1" opacity="0.4" />
                    {/if}
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
                  </g>
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

        <!-- ── Faction Tree Detail ─────────────────── -->
        {#if selectedDetail}
          <div class="tree-section" transition:fly={{ y: 6, duration: 150 }}>
            <div class="tree-header">
              <span class="tree-faction-name">{selectedDetail.factionName}</span>
              <span class="tree-join-badge" class:joined={selectedDetail.isJoined}>
                {selectedDetail.isJoined ? '已加入' : '未加入'}
              </span>
              <button class="close-detail-btn" on:click={() => selectedFactionId = null}>✕</button>
            </div>

            <!-- Credit bar -->
            {#if selectedDetail.creditLimits}
              {@const bar = creditBarPercent(selectedDetail.credit, selectedDetail.creditLimits)}
              <div class="credit-row">
                <span class="credit-label">信用</span>
                <div class="credit-bar-wrap">
                  <div class="credit-bar-bg">
                    <div
                      class="credit-bar-fill"
                      class:neg={selectedDetail.credit < 0}
                      style="left: {bar.left}%; width: {bar.width}%;"
                    ></div>
                    <div class="credit-bar-zero" style="left: {creditBarPercent(0, selectedDetail.creditLimits).left}%;"></div>
                  </div>
                </div>
                <span class="credit-value" style="color: {selectedDetail.credit >= 0 ? '#5fa8d3' : '#d35f5f'}">
                  {selectedDetail.credit >= 0 ? '+' : ''}{Math.round(selectedDetail.credit)}
                </span>
              </div>
              {#if selectedDetail.breakpointHit}
                <div class="breakpoint-warning">⚠ 信用已達中斷點 — 主線任務已鎖定</div>
              {/if}
            {/if}

            {#if selectedDetail.isJoined}
              <!-- Checkpoints -->
              {#if selectedDetail.checkpoints && selectedDetail.checkpoints.length > 0}
                <div class="tree-sub-section">
                  <span class="tree-sub-label">進度</span>
                  <div class="checkpoint-list">
                    {#each selectedDetail.checkpoints as cp}
                      <div class="checkpoint-row" class:completed={cp.completed}>
                        <span class="cp-icon">{cp.completed ? '◆' : '◇'}</span>
                        <span class="cp-label">{cp.label}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Quest Lines -->
              {#if selectedDetail.questLines && selectedDetail.questLines.length > 0}
                {#each selectedDetail.questLines as ql}
                  <div class="tree-sub-section">
                    <span class="tree-sub-label">{ql.label}</span>
                    <div class="quest-line-list">
                      {#each ql.quests as quest, i}
                        <div class="quest-node-row">
                          {#if i > 0}
                            <div class="quest-connector"></div>
                          {/if}
                          <span class="quest-icon" style="color: {questStatusColor(quest.status)}">{questStatusIcon(quest.status)}</span>
                          <span class="quest-name" style="color: {quest.status === 'locked' ? '#555' : 'var(--text-secondary)'}">
                            {quest.status === 'locked' ? '???' : quest.name}
                          </span>
                          {#if quest.coupling > 0.7}
                            <span class="coupling-badge high">核心</span>
                          {:else if quest.coupling > 0.4}
                            <span class="coupling-badge mid">相關</span>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </div>
                {/each}
              {/if}

            {:else}
              <!-- Not joined: show known quests only -->
              {#if selectedDetail.knownQuests && selectedDetail.knownQuests.length > 0}
                <div class="tree-sub-section">
                  <span class="tree-sub-label">已知任務</span>
                  <div class="quest-line-list">
                    {#each selectedDetail.knownQuests as quest}
                      <div class="quest-node-row">
                        <span class="quest-icon" style="color: {questStatusColor(quest.status)}">{questStatusIcon(quest.status)}</span>
                        <span class="quest-name">{quest.name}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {:else}
                <div class="tree-empty">尚無相關任務記錄</div>
              {/if}
            {/if}
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

  /* ── Faction Tree Detail ──────────── */
  .tree-section {
    border-top: 1px solid var(--border);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tree-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tree-faction-name {
    font-size: 12px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    flex: 1;
  }

  .tree-join-badge {
    font-size: 9px;
    font-family: var(--font-mono);
    padding: 1px 6px;
    border: 1px solid #555;
    color: #888;
    border-radius: 2px;
    letter-spacing: 0.05em;
  }
  .tree-join-badge.joined {
    border-color: #5fa8d3;
    color: #5fa8d3;
  }

  .close-detail-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 10px;
    cursor: pointer;
    padding: 2px 4px;
    opacity: 0.5;
    transition: opacity 0.1s;
  }
  .close-detail-btn:hover { opacity: 1; }

  /* Credit bar */
  .credit-row {
    display: grid;
    grid-template-columns: 32px 1fr 40px;
    align-items: center;
    gap: 6px;
  }

  .credit-label {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .credit-bar-wrap { width: 100%; }

  .credit-bar-bg {
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }

  .credit-bar-fill {
    position: absolute;
    top: 0;
    height: 100%;
    background: #5fa8d3;
    border-radius: 2px;
    transition: left 0.3s, width 0.3s;
  }
  .credit-bar-fill.neg { background: #d35f5f; }

  .credit-bar-zero {
    position: absolute;
    top: -1px;
    width: 1px;
    height: 6px;
    background: var(--border-accent);
    opacity: 0.5;
  }

  .credit-value {
    font-size: 10px;
    font-family: var(--font-mono);
    text-align: right;
  }

  .breakpoint-warning {
    font-size: 9px;
    color: #d35f5f;
    font-family: var(--font-mono);
    opacity: 0.85;
    letter-spacing: 0.03em;
  }

  /* Sub-sections */
  .tree-sub-section {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .tree-sub-label {
    font-size: 8.5px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-family: var(--font-mono);
  }

  /* Checkpoints */
  .checkpoint-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .checkpoint-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-dim);
  }
  .checkpoint-row.completed { color: #7ec8a0; }

  .cp-icon { font-size: 9px; width: 12px; text-align: center; }
  .cp-label { flex: 1; }

  /* Quest line */
  .quest-line-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding-left: 4px;
  }

  .quest-node-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-family: var(--font-mono);
    padding: 3px 0;
    position: relative;
  }

  .quest-connector {
    position: absolute;
    left: 5px;
    top: -6px;
    width: 1px;
    height: 9px;
    background: #444;
  }

  .quest-icon { font-size: 10px; width: 12px; text-align: center; flex-shrink: 0; }
  .quest-name { flex: 1; }

  .coupling-badge {
    font-size: 7.5px;
    padding: 0 4px;
    border-radius: 2px;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .coupling-badge.high {
    background: rgba(201, 169, 110, 0.15);
    color: #c9a96e;
    border: 1px solid rgba(201, 169, 110, 0.3);
  }
  .coupling-badge.mid {
    background: rgba(95, 168, 211, 0.1);
    color: #5fa8d3;
    border: 1px solid rgba(95, 168, 211, 0.2);
  }

  .tree-empty {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    opacity: 0.5;
    padding: 8px 0;
  }
</style>
