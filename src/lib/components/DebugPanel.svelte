<script lang="ts">
  import type { GameController } from '$lib/engine/GameController';

  export let controller: GameController;
  export let onClose: () => void;

  type Tab = 'encounter' | 'npc' | 'event' | 'quest' | 'location' | 'flag';
  let activeTab: Tab = 'encounter';
  let filter = '';
  let flagInput = '';
  let flagAction: 'set' | 'unset' = 'set';

  const catalog = controller.getDebugCatalog();

  const tabLabels: Record<Tab, string> = {
    encounter: `遭遇 (${catalog.encounters.length})`,
    npc:       `NPC (${catalog.npcs.length})`,
    event:     `事件 (${catalog.events.length})`,
    quest:     `任務 (${catalog.quests.length})`,
    location:  `地點 (${catalog.locations.length})`,
    flag:      '旗標',
  };

  $: q = filter.toLowerCase();

  $: filteredEncounters = catalog.encounters.filter(
    e => !q || e.id.includes(q) || e.name.toLowerCase().includes(q),
  );
  $: filteredNpcs = catalog.npcs.filter(
    n => !q || n.id.includes(q) || n.name.toLowerCase().includes(q),
  );
  $: filteredEvents = catalog.events.filter(
    e => !q || e.id.includes(q) || e.name.toLowerCase().includes(q),
  );
  $: filteredQuests = catalog.quests.filter(
    q2 => !q || q2.id.includes(q) || q2.name.toLowerCase().includes(q),
  );
  $: filteredLocations = catalog.locations.filter(
    l => !q || l.id.includes(q) || l.name.toLowerCase().includes(q),
  );

  const encTypeColors: Record<string, string> = {
    narrative: '#c9a96e',
    event:     '#5fa8d3',
    dialogue:  '#7ec8a0',
    combat:    '#d35f5f',
    shop:      '#7ec87e',
  };

  function setTab(key: string) {
    activeTab = key as Tab;
    filter = '';
  }

  function applyFlag() {
    const f = flagInput.trim();
    if (!f) return;
    if (flagAction === 'set') controller.debugSetFlag(f);
    else controller.debugUnsetFlag(f);
  }

  let resetting = false;
  async function handleReset() {
    resetting = true;
    try {
      await controller.debugResetGame();
    } finally {
      resetting = false;
    }
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="debug-overlay" role="dialog" aria-label="除錯介面">
  <div class="debug-panel">

    <div class="debug-header">
      <span class="debug-title">◇ 除錯介面</span>
      <input
        class="debug-search"
        type="text"
        placeholder="搜尋 ID 或名稱..."
        bind:value={filter}
      />
      <button class="reset-btn" on:click={handleReset} disabled={resetting}>
        {resetting ? '重置中…' : '⟳ 重置遊戲'}
      </button>
      <button class="close-btn" on:click={onClose}>✕</button>
    </div>

    <div class="tab-bar">
      {#each Object.entries(tabLabels) as [key, label]}
        <button
          class="tab-btn"
          class:active={activeTab === key}
          on:click={() => setTab(key)}
        >
          {label}
        </button>
      {/each}
    </div>

    <div class="tab-content">

      {#if activeTab === 'encounter'}
        <div class="item-list">
          {#each filteredEncounters as enc (enc.id)}
            <div class="item-row">
              <span class="item-type-badge" style="color: {encTypeColors[enc.type] ?? '#888'}">
                {enc.type}
              </span>
              <div class="item-info">
                <span class="item-name">{enc.name}</span>
                <span class="item-id">{enc.id}</span>
              </div>
              <button class="trigger-btn" on:click={() => controller.debugTriggerEncounter(enc.id)}>
                觸發
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'npc'}
        <div class="item-list">
          {#each filteredNpcs as npc (npc.id)}
            <div class="item-row">
              <span class="item-type-badge">{npc.type}</span>
              <div class="item-info">
                <span class="item-name">{npc.name}</span>
                <span class="item-id">{npc.id}</span>
              </div>
              <button class="trigger-btn secondary" on:click={() => controller.debugInspectContext(npc.id)}>
                Context
              </button>
              <button class="trigger-btn" on:click={() => controller.debugStartNpcDialogue(npc.id)}>
                對話
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'event'}
        <div class="item-list">
          {#each filteredEvents as evt (evt.id)}
            <div class="item-row">
              <div class="item-info">
                <span class="item-name">{evt.name}</span>
                <span class="item-id">{evt.id}</span>
              </div>
              <button class="trigger-btn" on:click={() => controller.debugForceEvent(evt.id).catch(console.error)}>
                強制觸發
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'quest'}
        <div class="item-list">
          {#each filteredQuests as q2 (q2.id)}
            <div class="item-row">
              <div class="item-info">
                <span class="item-name">{q2.name}</span>
                <span class="item-id">{q2.id}</span>
              </div>
              <button class="trigger-btn" on:click={() => controller.debugGrantQuest(q2.id)}>
                授予
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'location'}
        <div class="item-list">
          {#each filteredLocations as loc (loc.id)}
            <div class="item-row">
              <div class="item-info">
                <span class="item-name">{loc.name}</span>
                <span class="item-id">{loc.id}</span>
              </div>
              <button class="trigger-btn" on:click={() => controller.debugTeleport(loc.id).catch(console.error)}>
                傳送
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'flag'}
        <div class="flag-panel">
          <div class="flag-row">
            <input
              class="flag-input"
              type="text"
              placeholder="輸入旗標 ID..."
              bind:value={flagInput}
              on:keydown={e => e.key === 'Enter' && applyFlag()}
            />
            <label class="radio-label">
              <input type="radio" bind:group={flagAction} value="set" /> 設置
            </label>
            <label class="radio-label">
              <input type="radio" bind:group={flagAction} value="unset" /> 清除
            </label>
            <button class="trigger-btn" on:click={applyFlag}>執行</button>
          </div>
          <p class="flag-hint">也可以直接在遊戲的 debug route (/debug) 查看目前所有 active flags。</p>
          <div class="flag-row" style="margin-top:8px">
            <button class="trigger-btn secondary" style="width:100%" on:click={() => controller.debugInspectContext()}>
              印出當前場景 Context（探索模式）
            </button>
          </div>
        </div>
      {/if}

    </div>
  </div>
</div>

<style>
  .debug-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 500;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 48px;
  }

  .debug-panel {
    width: min(760px, 92vw);
    max-height: 70vh;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-top: 2px solid #5fa8d3;
    display: flex;
    flex-direction: column;
    font-family: var(--font-mono);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  /* Header */
  .debug-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .debug-title {
    font-size: 11px;
    color: #5fa8d3;
    letter-spacing: 0.1em;
    flex-shrink: 0;
  }

  .debug-search {
    flex: 1;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 3px 8px;
    outline: none;
  }

  .debug-search:focus {
    border-color: #5fa8d3;
  }

  .reset-btn {
    background: none;
    border: 1px solid #c9a96e55;
    color: #c9a96e;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    padding: 2px 9px;
    cursor: pointer;
    border-radius: 2px;
    flex-shrink: 0;
    transition: border-color 0.1s, background 0.1s;
  }

  .reset-btn:hover:not(:disabled) {
    border-color: #c9a96e;
    background: rgba(201, 169, 110, 0.1);
  }

  .reset-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 6px;
    flex-shrink: 0;
  }

  .close-btn:hover { color: var(--text-primary); }

  /* Tab bar */
  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--bg-secondary);
  }

  .tab-btn {
    background: none;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 5px 12px;
    cursor: pointer;
    letter-spacing: 0.05em;
    transition: color 0.1s, background 0.1s;
  }

  .tab-btn:hover { color: var(--text-secondary); }

  .tab-btn.active {
    color: #5fa8d3;
    background: color-mix(in srgb, #5fa8d3 6%, var(--bg-secondary));
    border-bottom: 1px solid #5fa8d3;
  }

  /* Content */
  .tab-content {
    overflow-y: auto;
    flex: 1;
    padding: 4px 0;
  }

  /* Item list */
  .item-list {
    display: flex;
    flex-direction: column;
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    transition: background 0.08s;
  }

  .item-row:hover {
    background: var(--bg-secondary);
  }

  .item-type-badge {
    font-size: 9px;
    min-width: 60px;
    letter-spacing: 0.06em;
    flex-shrink: 0;
    opacity: 0.85;
  }

  .item-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .item-name {
    font-size: 12px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-id {
    font-size: 9px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .trigger-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 10px;
    cursor: pointer;
    border-radius: 2px;
    flex-shrink: 0;
    transition: border-color 0.1s, color 0.1s;
  }

  .trigger-btn:hover {
    border-color: #5fa8d3;
    color: #5fa8d3;
  }

  .trigger-btn.secondary {
    opacity: 0.6;
    font-size: 9px;
  }

  .trigger-btn.secondary:hover {
    border-color: #c9a96e;
    color: #c9a96e;
    opacity: 1;
  }

  .note-text {
    font-size: 9px;
    color: var(--text-dim);
    font-style: italic;
    flex-shrink: 0;
  }

  .empty {
    padding: 12px 16px;
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
  }

  /* Flag panel */
  .flag-panel {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .flag-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .flag-input {
    flex: 1;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 8px;
    outline: none;
  }

  .flag-input:focus { border-color: #5fa8d3; }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .flag-hint {
    font-size: 10px;
    color: var(--text-dim);
    margin: 0;
    line-height: 1.5;
  }
</style>
