<script lang="ts">
  import { playerUI, staminaPercent, stressPercent, endoPercent, questDetailOpen, questListOpen, barFlash } from '$lib/stores/gameStore';

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
      <div class="stat-row" class:flash-good={$barFlash.stamina === 'good'} class:flash-bad={$barFlash.stamina === 'bad'}>
        <span class="stat-label has-tooltip" data-tooltip="體力 Stamina&#10;代表你能持續行動的能耐。&#10;降至 0 將無法繼續行動。">STA</span>
        <div class="bar-wrap">
          <div class="bar stamina" style="width:{$staminaPercent}%"></div>
        </div>
        <span class="stat-val">{$playerUI.stamina}<span class="stat-max">/{$playerUI.staminaMax}</span></span>
      </div>

      <div class="stat-row" class:flash-good={$barFlash.stress === 'good'} class:flash-bad={$barFlash.stress === 'bad'}>
        <span class="stat-label has-tooltip" data-tooltip="壓力 Stress&#10;心理承受的負擔。&#10;過高會影響判斷，崩潰時觸發危機狀態。">STR</span>
        <div class="bar-wrap">
          <div class="bar stress" style="width:{$stressPercent}%"></div>
        </div>
        <span class="stat-val">{$playerUI.stress}<span class="stat-max">/{$playerUI.stressMax}</span></span>
      </div>

      <div class="stat-row" class:flash-good={$barFlash.endo === 'good'} class:flash-bad={$barFlash.endo === 'bad'}>
        <span class="stat-label has-tooltip" data-tooltip="靈能 Endo&#10;特殊能力的驅動燃料。&#10;耗盡時無法使用靈能技能。">END</span>
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
      <span class="melphin-label">所持金額</span>
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
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="quest-row" on:click={() => questDetailOpen.set(q)}>
          <div class="quest-name">
            <span class="quest-type-badge quest-type-{q.type}">{q.type === 'main' ? '主' : q.type === 'side' ? '支' : '隱'}</span>
            {q.name}
          </div>
          <div class="quest-stage">{q.stageSummary}</div>
        </div>
      {/each}
      {#if ($playerUI.totalActiveQuestCount ?? 0) > 3}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="quest-more" on:click={() => questListOpen.set(true)}>
          查看全部 {$playerUI.totalActiveQuestCount} 個任務 ▸
        </div>
      {/if}
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
    position: relative;
    z-index: 20;
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
    position: relative;
  }

  .stat-label.has-tooltip {
    cursor: help;
  }

  .stat-label.has-tooltip::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 5px);
    left: 0;
    white-space: pre;
    background: var(--bg-primary, #111);
    border: 1px solid var(--border-accent, #444);
    color: var(--text-secondary, #ccc);
    font-size: 9px;
    line-height: 1.6;
    letter-spacing: 0.02em;
    padding: 5px 8px;
    border-radius: 3px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 9999;
    width: max-content;
    max-width: 180px;
  }

  .stat-label.has-tooltip:hover::after {
    opacity: 1;
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

  /* ── Bar flash animations ─────────────────────────────── */
  .stat-row.flash-good {
    animation: barFlashGood 0.6s ease-out forwards;
    border-radius: 2px;
  }

  .stat-row.flash-bad {
    animation: barFlashBad 0.6s ease-out forwards;
    border-radius: 2px;
  }

  @keyframes barFlashGood {
    0%   { box-shadow: 0 0 0 1px #5fd38a99; }
    40%  { box-shadow: 0 0 0 1px #5fd38a; }
    100% { box-shadow: 0 0 0 1px transparent; }
  }

  @keyframes barFlashBad {
    0%   { box-shadow: 0 0 0 1px #d35f5f99; transform: translateX(0); }
    15%  { transform: translateX(-3px); box-shadow: 0 0 0 1px #d35f5f; }
    30%  { transform: translateX(3px); }
    45%  { transform: translateX(-2px); }
    60%  { transform: translateX(0); box-shadow: 0 0 0 1px #d35f5f99; }
    100% { box-shadow: 0 0 0 1px transparent; }
  }

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

  /* ── Quests ───────────────────────────────────────── */
  .quest-row {
    margin-bottom: 6px;
    padding: 4px 5px;
    border-radius: 2px;
    cursor: pointer;
    transition: background 0.12s;
    border: 1px solid transparent;
  }

  .quest-row:last-child { margin-bottom: 0; }

  .quest-row:hover {
    background: var(--bg-tertiary);
    border-color: var(--border);
  }

  .quest-name {
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .quest-type-badge {
    font-size: 8px;
    padding: 0px 4px;
    border-radius: 2px;
    letter-spacing: 0.05em;
    flex-shrink: 0;
    border: 1px solid;
  }

  .quest-type-main  { color: var(--accent);     border-color: var(--accent);     opacity: 0.85; }
  .quest-type-side  { color: var(--text-dim);   border-color: var(--border);     opacity: 0.75; }
  .quest-type-hidden { color: #8b6a9a;           border-color: #8b6a9a;           opacity: 0.75; }

  .quest-stage {
    font-size: 9px;
    color: var(--text-dim);
    margin-top: 2px;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .quest-more {
    margin-top: 5px;
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.05em;
    cursor: pointer;
    padding: 2px 5px;
    border-radius: 2px;
    transition: color 0.12s;
    text-align: right;
  }

  .quest-more:hover {
    color: var(--text-secondary);
  }
</style>
