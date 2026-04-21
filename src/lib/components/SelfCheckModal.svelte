<script lang="ts">
  import { selfCheckOpen, detailedPlayer, playerUI } from '$lib/stores/gameStore';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

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
        <div class="stat-grid">
          {#each Object.entries(dp.primaryStats) as [k, v]}
            <div class="stat-item">
              <span class="sk">{STAT_LABEL[k] ?? k}</span>
              <span class="sv">{v}</span>
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

      <!-- Reputation -->
      {#if Object.keys(dp.reputation).some(k => dp.reputation[k] !== 0)}
        <section class="section">
          <div class="section-label">派系聲望</div>
          <div class="rep-list">
            {#each Object.entries(dp.reputation).filter(([, v]) => v !== 0) as [fid, v]}
              <div class="rep-row">
                <span class="rep-name">{fid}</span>
                <span class="rep-val" class:pos={v > 0} class:neg={v < 0}>
                  {v > 0 ? '+' : ''}{v}
                </span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Knowledge -->
      <section class="section">
        <div class="section-label">知識</div>
        {#if dp.knownIntelIds && dp.knownIntelIds.length > 0}
          <div class="tag-list">
            {#each dp.knownIntelIds as id}
              <span class="tag intel-tag" title={id}>{id.replace(/_/g, ' ')}</span>
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

  .rep-list { display: flex; flex-direction: column; gap: 4px; }

  .rep-row {
    display: flex;
    justify-content: space-between;
  }

  .rep-name { font-size: 11px; color: var(--text-secondary); }
  .rep-val  { font-size: 11px; font-family: var(--font-mono); color: var(--text-dim); }
  .rep-val.pos { color: #4a7a4a; }
  .rep-val.neg { color: var(--accent-red); }

  .intel-tag {
    border-color: var(--accent-blue);
    color: #5a8aaa;
    text-transform: lowercase;
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
