<script lang="ts">
  import { selfCheckOpen, detailedPlayer, playerUI } from '$lib/stores/gameStore';

  const INTEL_CATEGORY_LABELS: Record<string, string> = {
    political: '政', personal: '人', threat: '威', location: '地', rumor: '謠',
  };

  let expandedIntelId: string | null = null;
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { getRequiredExpForLevel, STAT_MAX_LEVEL } from '$lib/engine/ExperienceEngine';

  const STAT_LABEL: Record<string, string> = {
    strength: '力量', knowledge: '知識', talent: '才能', spirit: '精神', luck: '幸運',
    consciousness: '意識', mysticism: '奧秘', technology: '科技',
    stamina: '體力', staminaMax: '體力上限',
    stress: '壓力', stressMax: '壓力上限',
    endo: '魔力', endoMax: '魔力上限',
    experience: '經驗值',
  };

  function close() { selfCheckOpen.set(false); }

  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click={handleBg}>
  <aside class="modal-panel" transition:fly={{ x: -280, duration: 220, easing: cubicOut }} role="dialog" aria-label="自我視察">
    <div class="modal-header">
      <span class="modal-title">自我視察</span>
      <button class="close-btn" on:click={close} aria-label="關閉">✕</button>
    </div>

    {#if $detailedPlayer}
      {@const dp = $detailedPlayer}

      <!-- Primary stats -->
      <section class="section">
        <div class="section-label">基礎能力</div>
        <div class="primary-stat-list">
          {#each Object.entries(dp.primaryStats) as [k, v]}
            {@const xp = dp.primaryStatsExp?.[k] ?? 0}
            {@const isMax = v >= STAT_MAX_LEVEL}
            {@const req = isMax ? 1 : getRequiredExpForLevel(v)}
            {@const pct = isMax ? 100 : Math.min(100, Math.floor(xp / req * 100))}
            <div class="primary-stat-item">
              <div class="stat-row">
                <span class="sk">{STAT_LABEL[k] ?? k}</span>
                <span class="sv">{v}</span>
              </div>
              {#if isMax}
                <div class="xp-row">
                  <div class="xp-bar"><div class="xp-fill" style="width:100%"></div></div>
                  <span class="xp-text xp-max">MAX</span>
                </div>
              {:else}
                <div class="xp-row">
                  <div class="xp-bar"><div class="xp-fill" style="width:{pct}%"></div></div>
                  <span class="xp-text">{xp} / {req}</span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </section>

      <!-- Secondary stats -->
      <section class="section">
        <div class="section-label">次要能力</div>
        <div class="stat-grid">
          {#each Object.entries(dp.secondaryStats) as [k, v]}
            <div class="stat-item">
              <span class="sk">{STAT_LABEL[k] ?? k}</span>
              <span class="sv">{v}</span>
            </div>
          {/each}
        </div>
      </section>

      <!-- Status -->
      <section class="section">
        <div class="section-label">狀態值</div>
        <div class="stat-grid">
          {#each Object.entries(dp.statusStats).filter(([k]) => !k.endsWith('Max')) as [k, v]}
            {@const maxKey = k + 'Max'}
            {@const maxVal = dp.statusStats[maxKey]}
            <div class="stat-item">
              <span class="sk">{STAT_LABEL[k] ?? k}</span>
              <span class="sv">
                {v}{maxVal !== undefined ? '/' + maxVal : ''}
              </span>
            </div>
          {/each}
        </div>
      </section>

      <!-- Conditions -->
      {#if dp.conditions.length > 0}
        <section class="section">
          <div class="section-label">當前狀態</div>
          <div class="tag-list">
            {#each dp.conditions as c}
              <span class="tag cond-tag">{c.label}</span>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Titles -->
      {#if dp.titles.length > 0}
        <section class="section">
          <div class="section-label">稱號</div>
          <div class="tag-list">
            {#each dp.titles as t}
              <span class="tag">{t}</span>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Knowledge -->
      <section class="section">
        <div class="section-label">情報</div>
        {#if $playerUI.knownIntels && $playerUI.knownIntels.length > 0}
          <div class="intel-list">
            {#each $playerUI.knownIntels as intel}
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div
                class="intel-card"
                class:expanded={expandedIntelId === intel.id}
                on:click={() => { expandedIntelId = expandedIntelId === intel.id ? null : intel.id; }}
              >
                <div class="intel-header">
                  <span class="intel-cat intel-cat-{intel.category}">{INTEL_CATEGORY_LABELS[intel.category] ?? '?'}</span>
                  <span class="intel-lbl">{intel.label}</span>
                </div>
                {#if expandedIntelId === intel.id}
                  <div class="intel-desc">{intel.description}</div>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty-inline">尚無已知情報</div>
        {/if}
      </section>

    {:else}
      <div class="empty">載入中...</div>
    {/if}
  </aside>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0,0,0,0.35);
    display: flex;
    align-items: stretch;
  }

  .modal-panel {
    width: 280px;
    max-width: 80vw;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-accent);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--bg-tertiary);
  }

  .modal-title {
    font-size: 12px;
    color: var(--text-primary);
    letter-spacing: 0.05em;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 2px;
  }

  .close-btn:hover { color: var(--text-primary); }

  .section {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .section-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 7px;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px 12px;
  }

  .stat-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* Primary stats with XP */
  .primary-stat-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .primary-stat-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .xp-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .xp-bar {
    flex: 1;
    height: 3px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
  }

  .xp-fill {
    height: 100%;
    background: var(--accent-blue, #4a7aaa);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .xp-text {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    white-space: nowrap;
    min-width: 52px;
    text-align: right;
  }

  .xp-max {
    color: var(--accent-gold, #aa8844);
  }

  .sk {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .sv {
    font-size: 11px;
    color: var(--text-primary);
    font-family: var(--font-mono);
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag {
    font-size: 10px;
    padding: 2px 7px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 2px;
  }

  .cond-tag {
    border-color: var(--accent-red);
    color: var(--accent-red);
  }

  .intel-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .intel-card {
    padding: 3px 5px;
    border-radius: 2px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: background 0.12s;
  }

  .intel-card:hover,
  .intel-card.expanded {
    background: var(--bg-tertiary);
    border-color: var(--border);
  }

  .intel-header {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .intel-cat {
    font-size: 8px;
    padding: 0px 4px;
    border-radius: 2px;
    letter-spacing: 0.05em;
    flex-shrink: 0;
    border: 1px solid;
  }

  .intel-cat-political { color: var(--accent);      border-color: var(--accent);      opacity: 0.85; }
  .intel-cat-personal  { color: #c8a84b;            border-color: #c8a84b;            opacity: 0.85; }
  .intel-cat-threat    { color: var(--accent-red);  border-color: var(--accent-red);  opacity: 0.85; }
  .intel-cat-location  { color: var(--accent-blue); border-color: var(--accent-blue); opacity: 0.85; }
  .intel-cat-rumor     { color: var(--text-dim);    border-color: var(--border);      opacity: 0.75; }

  .intel-lbl {
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .intel-desc {
    margin-top: 4px;
    font-size: 10px;
    color: var(--text-dim);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .empty-inline {
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
  }

  .empty {
    padding: 24px 14px;
    font-size: 12px;
    color: var(--text-dim);
    font-style: italic;
  }
</style>
