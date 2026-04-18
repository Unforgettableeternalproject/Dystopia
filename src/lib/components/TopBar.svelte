<script lang="ts">
  import { playerUI } from '$lib/stores/gameStore';
</script>

<header class="top-bar">
  <div class="region">{$playerUI.regionName}</div>
  <div class="center-info">
    {#if $playerUI.time}
      <span class="time">{$playerUI.time}</span>
      {#if $playerUI.timePeriod}
        <span class="sep">·</span>
        <span class="period">{$playerUI.timePeriod}</span>
      {/if}
    {/if}
  </div>
  <div class="turn">T{$playerUI.turn}</div>
</header>

<style>
  .top-bar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    height: var(--top-bar-h);
    padding: 0 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
    gap: 12px;
    flex-shrink: 0;
  }

  .region {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .center-info {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .time {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .sep {
    color: var(--text-dim);
    font-size: 10px;
  }

  .period {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
  }

  .turn {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    min-width: 32px;
    text-align: right;
    flex-shrink: 0;
  }
</style>
