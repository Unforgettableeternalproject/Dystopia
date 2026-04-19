<script lang="ts">
  import { playerUI } from '$lib/stores/gameStore';

  const PHASE_LABEL: Record<string, string> = {
    grace_period: '寬限期',
    origin:       '起源',
    progression:  '進展',
    escalation:   '加劇',
    endgame:      '終局',
  };
</script>

<aside class="left-sidebar">
  <!-- Location map -->
  <div class="map-box">
    <span class="section-header">地點</span>

    {#if $playerUI.mapNodes && $playerUI.mapNodes.length > 0}
      <div class="map-nodes">
        {#each $playerUI.mapNodes as node}
          <div class="map-node" class:current={node.isCurrent} class:undiscovered={!node.isDiscovered && !node.isCurrent}>
            <span class="node-dot">{node.isCurrent ? '◉' : '·'}</span>
            <span class="node-label">{node.label}</span>
          </div>
        {/each}
      </div>
    {:else}
      <!-- Fallback: show current location name only -->
      <div class="map-nodes">
        <div class="map-node current">
          <span class="node-dot">◉</span>
          <span class="node-label">{$playerUI.location}</span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Time & period -->
  <div class="info-section">
    {#if $playerUI.time}
      <div class="info-block">
        <span class="label">時間</span>
        <span class="value">{$playerUI.time.replace('AD ', '')}</span>
      </div>
    {/if}

    {#if $playerUI.timePeriod}
      <div class="info-block">
        <span class="label">時段</span>
        <span class="value">{$playerUI.timePeriod}</span>
      </div>
    {/if}
  </div>

  <!-- Spacer pushes phase to bottom -->
  <div class="flex-spacer"></div>

  <!-- World phase -->
  {#if $playerUI.worldPhase}
    <div class="phase-block">
      <span class="label">階段</span>
      <span class="phase-val">{PHASE_LABEL[$playerUI.worldPhase] ?? $playerUI.worldPhase.replace(/_/g, ' ')}</span>
    </div>
  {/if}
</aside>

<style>
  .left-sidebar {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  /* ── Section header ────────────────────────────── */
  .section-header {
    font-size: 9px;
    letter-spacing: 0.12em;
    color: var(--text-dim);
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  /* ── Map ────────────────────────────────────────── */
  .map-box {
    padding: 12px 10px 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .map-nodes {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .map-node {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }

  .node-dot {
    font-size: 11px;
    color: var(--text-dim);
    flex-shrink: 0;
    width: 12px;
    text-align: center;
    line-height: 1;
  }

  .node-label {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  .map-node.current .node-dot  { color: var(--accent); }
  .map-node.current .node-label {
    color: var(--text-primary);
    font-size: 12px;
  }

  .map-node.undiscovered .node-dot  { opacity: 0.35; }
  .map-node.undiscovered .node-label {
    opacity: 0.35;
    font-style: italic;
  }

  /* ── Info section ────────────────────────────────── */
  .info-section {
    padding: 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
  }

  .info-block {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .value {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Spacer + phase ─────────────────────────────── */
  .flex-spacer { flex: 1; }

  .phase-block {
    padding: 8px 10px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .phase-val {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }
</style>
