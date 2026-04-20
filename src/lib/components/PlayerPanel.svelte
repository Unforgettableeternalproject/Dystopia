<script lang="ts">
  import { playerUI, staminaPercent, stressPercent, endoPercent } from '$lib/stores/gameStore';

  $: avatarChar = ($playerUI.name && $playerUI.name !== '???')
    ? $playerUI.name[0].toUpperCase()
    : '?';
</script>

<aside class="player-panel">

  <!-- Identity -->
  <div class="player-identity">
    <div class="avatar">{avatarChar}</div>
    <div class="identity-text">
      <div class="player-name">{$playerUI.name}</div>
      {#if $playerUI.titles && $playerUI.titles.length > 0}
        <div class="player-title">{$playerUI.titles[0]}</div>
      {:else}
        <div class="player-title placeholder">—</div>
      {/if}
    </div>
  </div>

  <!-- Stat bars -->
  <div class="section">
    <div class="section-label">狀態</div>
    <div class="stats">
      <div class="stat-row">
        <span class="stat-label">STA</span>
        <div class="bar-wrap">
          <div class="bar stamina" style="width:{$staminaPercent}%"></div>
        </div>
        <span class="stat-val">{$playerUI.stamina}<span class="stat-max">/{$playerUI.staminaMax}</span></span>
      </div>

      <div class="stat-row">
        <span class="stat-label">STR</span>
        <div class="bar-wrap">
          <div class="bar stress" style="width:{$stressPercent}%"></div>
        </div>
        <span class="stat-val">{$playerUI.stress}<span class="stat-max">/{$playerUI.stressMax}</span></span>
      </div>

      <div class="stat-row">
        <span class="stat-label">END</span>
        <div class="bar-wrap">
          <div class="bar endo" style="width:{$endoPercent}%"></div>
        </div>
        <span class="stat-val">{$playerUI.endo}<span class="stat-max">/{$playerUI.endoMax}</span></span>
      </div>
    </div>
  </div>

  <!-- Melphin (貨幣) -->
  <div class="section melphin-section">
    <div class="melphin-row">
      <span class="melphin-label">MEL</span>
      <span class="melphin-val">{$playerUI.melphin ?? 0}<span class="melphin-unit"> ₘ</span></span>
    </div>
  </div>

  <!-- Conditions (感受狀態) -->
  <div class="section">
    <div class="section-label">感受</div>
    {#if $playerUI.conditions && $playerUI.conditions.length > 0}
      <div class="cond-list">
        {#each $playerUI.conditions as c}
          <span class="cond-tag">{c.label}</span>
        {/each}
      </div>
    {:else}
      <div class="cond-normal">感覺良好</div>
    {/if}
  </div>

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

</aside>

<style>
  .player-panel {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    border-left: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  /* ── Identity ─────────────────────────────────────── */
  .player-identity {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 10px 10px;
    border-bottom: 1px solid var(--border);
  }

  .avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-accent);
    color: var(--text-secondary);
    font-size: 13px;
    font-family: var(--font-mono);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    letter-spacing: 0;
  }

  .identity-text {
    min-width: 0;
    flex: 1;
  }

  .player-name {
    font-size: 12px;
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
    letter-spacing: 0.04em;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
  }

  .player-title.placeholder {
    color: var(--text-dim);
    opacity: 0.5;
  }

  /* ── Sections ─────────────────────────────────────── */
  .section {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }

  .section-label {
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  /* ── Stats ────────────────────────────────────────── */
  .stats {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
  .endo    { background: var(--accent-blue); }

  .stat-val {
    font-size: 10px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    width: 32px;
    text-align: right;
    flex-shrink: 0;
  }

  .stat-max {
    color: var(--text-dim);
    font-size: 9px;
  }

  /* ── Melphin ──────────────────────────────────────── */
  .melphin-section {
    padding: 6px 10px;
  }

  .melphin-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .melphin-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
  }

  .melphin-val {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .melphin-unit {
    font-size: 9px;
    color: var(--text-dim);
  }

  /* ── Conditions ───────────────────────────────────── */
  .cond-list {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .cond-tag {
    font-size: 9px;
    padding: 1px 6px;
    background: transparent;
    border: 1px solid var(--accent-red);
    color: var(--accent-red);
    border-radius: 2px;
    opacity: 0.85;
  }

  .cond-normal {
    font-size: 10px;
    color: var(--text-dim);
    font-style: italic;
    letter-spacing: 0.02em;
  }

  /* ── Faction ──────────────────────────────────────── */
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

  /* ── Quests ───────────────────────────────────────── */
  .quest-row {
    margin-bottom: 6px;
  }

  .quest-row:last-child { margin-bottom: 0; }

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
