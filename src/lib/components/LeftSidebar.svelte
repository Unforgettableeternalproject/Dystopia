<script lang="ts">
  import { playerUI, statDeltaNotifs } from '$lib/stores/gameStore';
  import MiniMap    from './MiniMap.svelte';
  import RegionMap  from './RegionMap.svelte';
  import { fly }    from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

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

  <!-- Faction reputation (appears on first reputation change) -->
  {#if $playerUI.topFactions && $playerUI.topFactions.length > 0}
    <div class="faction-section" in:fly={{ y: -10, duration: 350, easing: cubicOut }}>
      <span class="section-header">派系</span>
      {#each $playerUI.topFactions as f}
        <div class="faction-row">
          <span class="faction-name">{f.name}</span>
          <span class="faction-rep" class:pos={f.rep > 0} class:neg={f.rep < 0}>
            {f.rep > 0 ? '+' : ''}{f.rep}
          </span>
          {#each $statDeltaNotifs.filter(n => n.target === `rep:${f.id}`) as notif, i (notif.id)}
            <span class="faction-delta delta-{notif.valence}" style="--delta-stack:{i}">
              {notif.delta > 0 ? '+' : ''}{notif.delta}
            </span>
          {/each}
        </div>
      {/each}
    </div>
  {/if}

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

  /* ── Faction ─────────────────────────────────────── */
  @keyframes faction-reveal {
    0%   {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent), 0 0 10px 2px color-mix(in srgb, var(--accent) 35%, transparent);
    }
    65%  {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent), 0 0 10px 2px color-mix(in srgb, var(--accent) 35%, transparent);
    }
    100% {
      border-color: var(--border);
      box-shadow: none;
    }
  }

  .faction-section {
    padding: 10px 10px;
    border-bottom: 1px solid var(--border);
    border-top: 1px solid var(--border);
    animation: faction-reveal 2.2s ease-out 1 forwards;
  }

  .faction-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 5px;
    position: relative;
  }

  .faction-name {
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .faction-rep {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .faction-rep.pos { color: #4a7a4a; }
  .faction-rep.neg { color: var(--accent-red); }

  /* ── Faction delta float ──────────────────────────── */
  .faction-delta {
    position: absolute;
    right: 0;
    top: calc(50% - var(--delta-stack, 0) * 14px - 14px);
    font-size: 10px;
    font-family: var(--font-mono);
    font-weight: 600;
    pointer-events: none;
    white-space: nowrap;
    z-index: 5;
    animation: factionDeltaFloat 1.5s ease-out forwards;
  }

  .delta-good { color: #5fd38a; text-shadow: 0 0 4px #5fd38a44; }
  .delta-bad  { color: #d35f5f; text-shadow: 0 0 4px #d35f5f44; }

  @keyframes factionDeltaFloat {
    0%   { opacity: 0; transform: translateY(-30%); }
    12%  { opacity: 1; transform: translateY(-50%); }
    65%  { opacity: 1; transform: translateY(-70%); }
    100% { opacity: 0; transform: translateY(-120%); }
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
