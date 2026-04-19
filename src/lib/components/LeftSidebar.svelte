<script lang="ts">
  import { playerUI } from '$lib/stores/gameStore';
  import MiniMap    from './MiniMap.svelte';
  import RegionMap  from './RegionMap.svelte';

  const PHASE_LABEL: Record<string, string> = {
    grace_period: '寬限期',
    origin:       '起源',
    progression:  '進展',
    escalation:   '加劇',
    endgame:      '終局',
  };

  let regionMapOpen = false;
</script>

<aside class="left-sidebar">
  <!-- Location mini-map -->
  <div class="map-box">
    <span class="section-header">地圖</span>
    <MiniMap data={$playerUI.miniMap} on:openRegionMap={() => (regionMapOpen = true)} />
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

<!-- Region map modal (teleported outside sidebar layout) -->
{#if regionMapOpen}
  <RegionMap data={$playerUI.regionMap} on:close={() => (regionMapOpen = false)} />
{/if}

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
