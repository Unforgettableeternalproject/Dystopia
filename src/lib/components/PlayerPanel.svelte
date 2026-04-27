<script lang="ts">
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { playerUI, staminaPercent, stressPercent, endoPercent, questDetailOpen, questListOpen, barFlash, questOutcomeFlash, statDeltaNotifs, melphinFlash } from '$lib/stores/gameStore';

  const displayMelphin = tweened(0, { duration: 400, easing: cubicOut });
  $: displayMelphin.set($playerUI.melphin ?? 0);

  $: avatarChar = ($playerUI.name && $playerUI.name !== '???')
    ? $playerUI.name[0].toUpperCase()
    : '?';

  const statDefs: Record<string, { name: string; desc: string }> = {
    sta: { name: '體力　Stamina', desc: '代表你能持續行動的能耐。\n降至 0 將無法繼續行動。' },
    str: { name: '壓力　Stress',  desc: '心理承受的負擔。\n過高會影響判斷，崩潰時觸發危機狀態。' },
    end: { name: '靈能　Endo',    desc: '特殊能力的驅動燃料。\n耗盡時無法使用靈能技能。' },
  };

  let activeStatPopup: { key: string; name: string; desc: string; px: number; py: number } | null = null;

  function toggleStatPopup(e: MouseEvent, key: string) {
    e.stopPropagation();
    if (activeStatPopup?.key === key) { activeStatPopup = null; return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    activeStatPopup = {
      key,
      ...statDefs[key],
      px: rect.left,
      py: rect.top,
    };
  }

  let activeCondPopup: { label: string; effectSummary?: string; removeCondition?: string; px: number; py: number } | null = null;

  function toggleCondPopup(e: MouseEvent, cond: { label: string; effectSummary?: string; removeCondition?: string }) {
    e.stopPropagation();
    if (activeCondPopup?.label === cond.label) { activeCondPopup = null; return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    activeCondPopup = { ...cond, px: rect.left, py: rect.top };
  }

  const melphinDesc = '由理想國發行，世界的通行貨幣\n可用於購買物品或支付各種費用。\n有絕對的信用存在。';

  let melphinPopupOpen = false;
  let melphinPopupPos = { px: 0, py: 0 };

  function toggleMelphinPopup(e: MouseEvent) {
    e.stopPropagation();
    if (melphinPopupOpen) { melphinPopupOpen = false; return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    melphinPopupPos = { px: rect.left, py: rect.top };
    melphinPopupOpen = true;
  }

  function closeStatPopup() { activeStatPopup = null; activeCondPopup = null; melphinPopupOpen = false; activeIntelPopup = null; }
</script>

<svelte:window on:click={closeStatPopup} />

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
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <span class="stat-label clickable" class:active={activeStatPopup?.key === 'sta'} on:click={(e) => toggleStatPopup(e, 'sta')}>STA</span>
        <div class="bar-wrap">
          <div class="bar stamina" style="width:{$staminaPercent}%"></div>
        </div>
        <span class="stat-val">{$playerUI.stamina}<span class="stat-max">/{$playerUI.staminaMax}</span></span>
        {#each $statDeltaNotifs.filter(n => n.target === 'stamina') as notif, i (notif.id)}
          <span class="stat-delta delta-{notif.valence}" style="--delta-stack:{i}">
            {notif.delta > 0 ? '+' : ''}{notif.delta}
          </span>
        {/each}
      </div>

      <div class="stat-row" class:flash-good={$barFlash.stress === 'good'} class:flash-bad={$barFlash.stress === 'bad'}>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <span class="stat-label clickable" class:active={activeStatPopup?.key === 'str'} on:click={(e) => toggleStatPopup(e, 'str')}>STR</span>
        <div class="bar-wrap">
          <div class="bar stress" style="width:{$stressPercent}%"></div>
        </div>
        <span class="stat-val">{$playerUI.stress}<span class="stat-max">/{$playerUI.stressMax}</span></span>
        {#each $statDeltaNotifs.filter(n => n.target === 'stress') as notif, i (notif.id)}
          <span class="stat-delta delta-{notif.valence}" style="--delta-stack:{i}">
            {notif.delta > 0 ? '+' : ''}{notif.delta}
          </span>
        {/each}
      </div>

      <div class="stat-row" class:flash-good={$barFlash.endo === 'good'} class:flash-bad={$barFlash.endo === 'bad'}>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <span class="stat-label clickable" class:active={activeStatPopup?.key === 'end'} on:click={(e) => toggleStatPopup(e, 'end')}>END</span>
        <div class="bar-wrap">
          <div class="bar endo" style="width:{$endoPercent}%"></div>
        </div>
        <span class="stat-val">{$playerUI.endo}<span class="stat-max">/{$playerUI.endoMax}</span></span>
        {#each $statDeltaNotifs.filter(n => n.target === 'endo') as notif, i (notif.id)}
          <span class="stat-delta delta-{notif.valence}" style="--delta-stack:{i}">
            {notif.delta > 0 ? '+' : ''}{notif.delta}
          </span>
        {/each}
      </div>
    </div>
  </div>

  <!-- Melphin (貨幣) -->
  <div class="section melphin-section">
    <div class="melphin-row">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <span class="melphin-label clickable" class:active={melphinPopupOpen} on:click={toggleMelphinPopup}>梅分</span>
      <div class="melphin-val-wrap">
        <span class="melphin-val" class:flash-good={$melphinFlash === 'good'} class:flash-bad={$melphinFlash === 'bad'}>
          {Math.round($displayMelphin)}<span class="melphin-unit"> ₘ</span>
        </span>
        {#each $statDeltaNotifs.filter(n => n.target === 'melphin') as notif, i (notif.id)}
          <span class="melphin-delta delta-{notif.valence}" style="--delta-stack:{i}">
            {notif.delta > 0 ? '+' : ''}{notif.delta}
          </span>
        {/each}
      </div>
    </div>
  </div>

  <!-- Conditions (感受狀態) -->
  <div class="section">
    <div class="section-label">感受</div>
    {#if $playerUI.conditions && $playerUI.conditions.length > 0}
      <div class="cond-list">
        {#each $playerUI.conditions as c}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <span
            class="cond-tag"
            class:active={activeCondPopup?.label === c.label}
            on:click={(e) => toggleCondPopup(e, c)}
            title={c.label}
          >{c.label}</span>
        {/each}
      </div>
    {:else}
      <div class="cond-normal">感覺良好</div>
    {/if}
  </div>

  <!-- Active quests -->
  {#if ($playerUI.activeQuestSummaries && $playerUI.activeQuestSummaries.length > 0) || $questOutcomeFlash.length > 0}
    <div class="section">
      <div class="section-label">任務</div>
      {#if $playerUI.activeQuestSummaries}
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
      {/if}
      {#if ($playerUI.totalActiveQuestCount ?? 0) > 3}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="quest-more" on:click={() => questListOpen.set(true)}>
          查看全部 {$playerUI.totalActiveQuestCount} 個任務 ▸
        </div>
      {/if}
      {#each $questOutcomeFlash as flash (flash.questId + flash.outcome)}
        <div class="quest-row quest-outcome-flash quest-outcome-{flash.outcome}">
          <div class="quest-name">
            <span class="quest-type-badge quest-type-{flash.type}">{flash.type === 'main' ? '主' : flash.type === 'side' ? '支' : '隱'}</span>
            {flash.name}
          </div>
          <div class="quest-stage">{flash.outcome === 'completed' ? '已完成' : '已失敗'}</div>
        </div>
      {/each}
    </div>
  {/if}

</aside>

{#if activeStatPopup}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="stat-popup"
    style="top:{Math.max(4, activeStatPopup.py - 10)}px; right:{Math.max(4, window.innerWidth - activeStatPopup.px + 8)}px;"
    on:click|stopPropagation
  >
    <div class="stat-popup-name">{activeStatPopup.name}</div>
    <div class="stat-popup-desc">{activeStatPopup.desc}</div>
  </div>
{/if}

{#if melphinPopupOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="stat-popup"
    style="top:{Math.max(4, melphinPopupPos.py - 10)}px; right:{Math.max(4, window.innerWidth - melphinPopupPos.px + 8)}px;"
    on:click|stopPropagation
  >
    <div class="stat-popup-name">梅分　Melphin</div>
    <div class="stat-popup-desc">{melphinDesc}</div>
  </div>
{/if}

{#if activeCondPopup}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="stat-popup cond-popup"
    style="top:{Math.max(4, activeCondPopup.py - 10)}px; right:{Math.max(4, window.innerWidth - activeCondPopup.px + 8)}px;"
    on:click|stopPropagation
  >
    <div class="stat-popup-name cond-popup-name">{activeCondPopup.label}</div>
    {#if activeCondPopup.effectSummary}
      <div class="cond-popup-cure-label">效果</div>
      <div class="stat-popup-desc">{activeCondPopup.effectSummary}</div>
    {/if}
    {#if activeCondPopup.removeCondition}
      <div class="cond-popup-cure-label">解除方式</div>
      <div class="stat-popup-desc">{activeCondPopup.removeCondition}</div>
    {:else}
      <div class="stat-popup-desc" style="margin-top:4px">無已知解除方式。</div>
    {/if}
  </div>
{/if}

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
    position: relative;
  }

  .stat-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    width: 24px;
    flex-shrink: 0;
    text-align: right;
  }

  .stat-label.clickable {
    cursor: pointer;
    transition: color 0.12s;
  }

  .stat-label.clickable:hover,
  .stat-label.clickable.active {
    color: var(--text-secondary);
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
    animation: barFlashGood 0.9s ease-out forwards;
    border-radius: 2px;
  }

  .stat-row.flash-bad {
    animation: barFlashBad 0.9s ease-out forwards;
    border-radius: 2px;
  }

  @keyframes barFlashGood {
    0%   { box-shadow: 0 0 6px 2px #5fd38a55; }
    25%  { box-shadow: 0 0 8px 2px #5fd38acc; }
    60%  { box-shadow: 0 0 4px 1px #5fd38a66; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  @keyframes barFlashBad {
    0%   { box-shadow: 0 0 6px 2px #d35f5f55; transform: translateX(0); }
    10%  { transform: translateX(-3px); box-shadow: 0 0 8px 2px #d35f5fcc; }
    20%  { transform: translateX(3px); }
    30%  { transform: translateX(-2px); }
    40%  { transform: translateX(2px); }
    50%  { transform: translateX(0); box-shadow: 0 0 5px 1px #d35f5f88; }
    100% { box-shadow: 0 0 0 0 transparent; transform: translateX(0); }
  }

  /* ── Stat delta float ─────────────────────────────────── */
  .stat-delta {
    position: absolute;
    right: 36px;
    top: calc(50% - var(--delta-stack, 0) * 14px);
    font-size: 10px;
    font-family: var(--font-mono);
    font-weight: 600;
    pointer-events: none;
    white-space: nowrap;
    z-index: 5;
    animation: deltaFloat 1.5s ease-out forwards;
  }

  .delta-good { color: #5fd38a; text-shadow: 0 0 4px #5fd38a44; }
  .delta-bad  { color: #d35f5f; text-shadow: 0 0 4px #d35f5f44; }

  @keyframes deltaFloat {
    0%   { opacity: 0; transform: translateY(-30%); }
    12%  { opacity: 1; transform: translateY(-50%); }
    65%  { opacity: 1; transform: translateY(-70%); }
    100% { opacity: 0; transform: translateY(-120%); }
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

  .melphin-label.clickable {
    cursor: pointer;
    transition: color 0.12s;
  }

  .melphin-label.clickable:hover,
  .melphin-label.clickable.active {
    color: var(--text-secondary);
  }

  .melphin-val-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .melphin-val {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    transition: color 0.1s;
  }

  .melphin-val.flash-good {
    animation: melphinFlashGood 0.9s ease-out forwards;
  }

  .melphin-val.flash-bad {
    animation: melphinFlashBad 0.9s ease-out forwards;
  }

  @keyframes melphinFlashGood {
    0%   { color: #5fd38a; text-shadow: 0 0 6px #5fd38a88; }
    40%  { color: #5fd38a; text-shadow: 0 0 8px #5fd38acc; }
    100% { color: var(--text-secondary); text-shadow: none; }
  }

  @keyframes melphinFlashBad {
    0%   { color: #d35f5f; text-shadow: 0 0 6px #d35f5f88; }
    40%  { color: #d35f5f; text-shadow: 0 0 8px #d35f5fcc; }
    100% { color: var(--text-secondary); text-shadow: none; }
  }

  .melphin-delta {
    position: absolute;
    right: calc(100% + 4px);
    top: calc(50% - var(--delta-stack, 0) * 14px);
    font-size: 10px;
    font-family: var(--font-mono);
    font-weight: 600;
    pointer-events: none;
    white-space: nowrap;
    z-index: 5;
    animation: deltaFloat 1.5s ease-out forwards;
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
    cursor: pointer;
    transition: background 0.12s, opacity 0.12s;
  }

  .cond-tag:hover,
  .cond-tag.active {
    background: color-mix(in srgb, var(--accent-red) 12%, transparent);
    opacity: 1;
  }

  .cond-popup-name {
    color: var(--accent-red) !important;
  }

  .cond-popup-cure-label {
    font-size: 8px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-top: 6px;
    margin-bottom: 2px;
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

  /* ── Quest outcome flash ───────────────────────────── */
  @keyframes questOutcomeFade {
    0%   { opacity: 0.7; }
    60%  { opacity: 0.5; }
    100% { opacity: 0; }
  }

  .quest-outcome-flash {
    cursor: default;
    pointer-events: none;
    animation: questOutcomeFade 3s ease-out forwards;
  }

  .quest-outcome-flash .quest-name {
    text-decoration: line-through;
    color: var(--text-dim);
  }

  .quest-outcome-flash .quest-stage {
    color: var(--text-dim);
    opacity: 0.7;
  }

  .quest-outcome-flash .quest-type-badge {
    opacity: 0.5;
  }

  .quest-outcome-completed .quest-stage {
    color: #4a7a4a;
    opacity: 0.85;
  }

  .quest-outcome-failed .quest-stage {
    color: var(--accent-red);
    opacity: 0.85;
  }

  /* ── Stat info popup ──────────────────────────────── */
  .stat-popup {
    position: fixed;
    background: var(--bg-primary, #111);
    border: 1px solid var(--border-accent, #444);
    border-radius: 4px;
    padding: 8px 10px;
    z-index: 9999;
    pointer-events: auto;
    animation: popupIn 0.1s ease-out;
    max-width: 200px;
  }

  @keyframes popupIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .stat-popup-name {
    font-size: 10px;
    color: var(--text-primary, #eee);
    letter-spacing: 0.05em;
    margin-bottom: 5px;
    font-weight: 500;
  }

  .stat-popup-desc {
    font-size: 9px;
    color: var(--text-secondary, #aaa);
    line-height: 1.7;
    white-space: pre-line;
    letter-spacing: 0.02em;
  }
</style>
