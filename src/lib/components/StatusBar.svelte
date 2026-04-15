<script lang="ts">
  import { playerUI, staminaPercent, stressPercent } from '$lib/stores/gameStore';
</script>

<header class="status-bar">
  <!-- Left: Name + Location -->
  <div class="status-left">
    <span class="player-name">{$playerUI.name}</span>
    <span class="separator" aria-hidden="true">/</span>
    <span class="location">{$playerUI.location}</span>
  </div>

  <!-- Center: Stats -->
  <div class="status-center">
    <!-- Stamina -->
    <div class="stat" title="體力">
      <span class="stat-label">STA</span>
      <div class="stat-bar">
        <div
          class="stat-fill stat-fill--stamina"
          style="width: {$staminaPercent}%"
        ></div>
      </div>
      <span class="stat-value">{$playerUI.stamina}/{$playerUI.staminaMax}</span>
    </div>

    <!-- Stress -->
    <div class="stat" title="壓力">
      <span class="stat-label">STR</span>
      <div class="stat-bar">
        <div
          class="stat-fill stat-fill--stress"
          style="width: {$stressPercent}%"
        ></div>
      </div>
      <span class="stat-value">{$playerUI.stress}/{$playerUI.stressMax}</span>
    </div>
  </div>

  <!-- Right: Turn counter -->
  <div class="status-right">
    <span class="turn-label">T</span>
    <span class="turn-value">{$playerUI.turn}</span>
  </div>
</header>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    height: var(--status-height);
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
    gap: 24px;
    flex-shrink: 0;
  }

  /* Left */
  .status-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .player-name {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .separator {
    color: var(--text-dim);
    font-size: 11px;
  }

  .location {
    color: var(--text-secondary);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Center — stat bars */
  .status-center {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-shrink: 0;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .stat-label {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.05em;
    width: 26px;
    text-align: right;
  }

  .stat-bar {
    width: 64px;
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
  }

  .stat-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .stat-fill--stamina {
    background: var(--accent);
  }

  .stat-fill--stress {
    background: var(--accent-red);
  }

  .stat-value {
    font-size: 10px;
    color: var(--text-dim);
    width: 28px;
  }

  /* Right */
  .status-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .turn-label {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  .turn-value {
    font-size: 11px;
    color: var(--text-secondary);
    min-width: 24px;
    text-align: right;
  }
</style>
