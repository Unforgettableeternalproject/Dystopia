<script lang="ts">
  import { playerUI, staminaPercent, stressPercent } from '$lib/stores/gameStore';

  $: manaPercent = $playerUI.manaMax > 0
    ? Math.round(($playerUI.mana / $playerUI.manaMax) * 100)
    : 0;

  const ATTITUDE_LABEL: Record<string, string> = {
    friendly: '友好',
    neutral:  '中立',
    cautious: '警惕',
    hostile:  '敵對',
  };
</script>

<aside class="player-panel">
  <div class="player-identity">
    <div class="player-name">{$playerUI.name}</div>
    {#if $playerUI.titles && $playerUI.titles.length > 0}
      <div class="player-title">{$playerUI.titles[0]}</div>
    {/if}
  </div>

  <!-- Stat bars -->
  <div class="stats">
    <div class="stat-row">
      <span class="stat-label">STA</span>
      <div class="bar-wrap">
        <div class="bar stamina" style="width:{$staminaPercent}%"></div>
      </div>
      <span class="stat-val">{$playerUI.stamina}</span>
    </div>

    <div class="stat-row">
      <span class="stat-label">STR</span>
      <div class="bar-wrap">
        <div class="bar stress" style="width:{$stressPercent}%"></div>
      </div>
      <span class="stat-val">{$playerUI.stress}</span>
    </div>

    {#if $playerUI.manaMax > 0}
      <div class="stat-row">
        <span class="stat-label">MP</span>
        <div class="bar-wrap">
          <div class="bar mana" style="width:{manaPercent}%"></div>
        </div>
        <span class="stat-val">{$playerUI.mana}</span>
      </div>
    {/if}
  </div>

  <!-- Faction reputation -->
  {#if $playerUI.topFactions && $playerUI.topFactions.length > 0}
    <div class="section">
      <div class="section-label">派系</div>
      {#each $playerUI.topFactions as f}
        <div class="faction-row">
          <span class="faction-name">{f.name}</span>
          <span class="faction-rep" class:pos={f.rep > 0} class:neg={f.rep < 0}>
            {f.rep > 0 ? '+' : ''}{f.rep}
          </span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- World phase -->
  {#if $playerUI.worldPhase}
    <div class="section phase-section">
      <div class="section-label">PHASE</div>
      <div class="phase-val">{$playerUI.worldPhase.replace(/_/g, ' ')}</div>
    </div>
  {/if}

  <!-- Active quests -->
  {#if $playerUI.activeQuestSummaries && $playerUI.activeQuestSummaries.length > 0}
    <div class="section">
      <div class="section-label">任務</div>
      {#each $playerUI.activeQuestSummaries as q}
        <div class="quest-row">
          <div class="quest-name">{q.name}</div>
          <div class="quest-stage">{q.stageSummary}</div>
        </div>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .player-panel {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    border-left: 1px solid var(--border);
    background: var(--bg-secondary);
    padding: 12px 10px;
  }

  .player-identity {
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 10px;
  }

  .player-name {
    font-size: 13px;
    color: var(--text-primary);
    font-weight: 500;
    letter-spacing: 0.03em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .player-title {
    font-size: 10px;
    color: var(--accent);
    letter-spacing: 0.05em;
    margin-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
  }

  /* Stats */
  .stats {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 12px;
  }

  .stat-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .stat-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    width: 24px;
    flex-shrink: 0;
    text-align: right;
  }

  .bar-wrap {
    flex: 1;
    height: 3px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
  }

  .bar {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .stamina { background: var(--accent); }
  .stress  { background: var(--accent-red); }
  .mana    { background: var(--accent-blue); }

  .stat-val {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    width: 20px;
    text-align: right;
    flex-shrink: 0;
  }

  /* Sections */
  .section {
    border-top: 1px solid var(--border);
    padding-top: 8px;
    margin-top: 4px;
    margin-bottom: 4px;
  }

  .section-label {
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    text-transform: uppercase;
    margin-bottom: 5px;
  }

  /* Faction */
  .faction-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 3px;
  }

  .faction-name {
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 90px;
  }

  .faction-rep {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-dim);
  }

  .faction-rep.pos { color: #4a7a4a; }
  .faction-rep.neg { color: var(--accent-red); }

  /* Phase */
  .phase-val {
    font-size: 10px;
    color: var(--text-dim);
    font-style: italic;
    letter-spacing: 0.03em;
  }

  /* Quests */
  .quest-row {
    margin-bottom: 7px;
  }

  .quest-name {
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .quest-stage {
    font-size: 9px;
    color: var(--text-dim);
    margin-top: 2px;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
