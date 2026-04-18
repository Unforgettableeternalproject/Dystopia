<script lang="ts">
  import { playerUI } from '$lib/stores/gameStore';
</script>

<aside class="left-sidebar">
  <!-- Map placeholder -->
  <div class="map-box">
    <span class="map-label">MAP</span>
    <div class="map-grid">
      {#each Array(25) as _, i}
        <span class="map-dot" class:active={i === 12}>·</span>
      {/each}
    </div>
  </div>

  <!-- Location info -->
  <div class="info-section">
    <div class="info-block">
      <span class="label">位置</span>
      <span class="value location-val">{$playerUI.location}</span>
    </div>

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

    {#if $playerUI.activeQuestCount}
      <div class="info-block quest-block">
        <span class="label">任務</span>
        <span class="value quest-count">{$playerUI.activeQuestCount}</span>
      </div>
    {/if}

    {#if $playerUI.conditionCount}
      <div class="info-block">
        <span class="label">狀態</span>
        <span class="value cond-count">{$playerUI.conditionCount}</span>
      </div>
    {/if}
  </div>
</aside>

<style>
  .left-sidebar {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  /* Map */
  .map-box {
    padding: 12px 10px 8px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .map-label {
    font-size: 9px;
    letter-spacing: 0.12em;
    color: var(--text-dim);
    text-transform: uppercase;
  }

  .map-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
    padding: 4px 0;
  }

  .map-dot {
    font-size: 10px;
    color: var(--text-dim);
    text-align: center;
    opacity: 0.4;
    line-height: 1;
  }

  .map-dot.active {
    color: var(--accent);
    opacity: 1;
    font-size: 13px;
    font-weight: bold;
  }

  /* Info section */
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

  .location-val {
    color: var(--text-primary);
    font-size: 12px;
  }

  .quest-block { margin-top: 2px; }

  .quest-count {
    color: var(--accent);
  }

  .cond-count {
    color: var(--accent-red);
  }
</style>
