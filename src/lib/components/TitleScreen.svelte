<script lang="ts">
  import { gamePhase } from '$lib/stores/gameStore';

  // mode: 'menu' | 'naming' | 'continue'
  let mode: 'menu' | 'naming' | 'continue' = 'menu';
  let playerName = '';
  let nameError = '';

  export let onNewGame: (name: string) => void;
  export let onLoadSlot: (slotId: number) => void;
  export let saveSlots: Array<{ slotId: number; label?: string; ts: number; locationName: string; worldTime: string } | null> = [];

  function confirmName() {
    const trimmed = playerName.trim();
    if (!trimmed) { nameError = '請輸入名字'; return; }
    if (trimmed.length > 20) { nameError = '名字不可超過20字'; return; }
    onNewGame(trimmed);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') confirmName();
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="title-screen">
  {#if mode === 'menu'}
    <div class="content">
      <div class="game-title">DYSTOPIA</div>
      <div class="game-subtitle">末日紀錄</div>
      <div class="menu-buttons">
        <button class="menu-btn primary" on:click={() => mode = 'naming'}>新遊戲</button>
        <button class="menu-btn" on:click={() => mode = 'continue'}>繼續遊戲</button>
        <button class="menu-btn dim" disabled>設定</button>
      </div>
    </div>

  {:else if mode === 'naming'}
    <div class="content">
      <div class="section-title">你的名字</div>
      <div class="section-hint">這個名字之後將無法更改</div>
      <div class="name-input-wrap">
        <!-- svelte-ignore a11y-autofocus -->
        <input
          class="name-input"
          type="text"
          bind:value={playerName}
          on:keydown={handleKeydown}
          placeholder="輸入名字..."
          maxlength={20}
          autofocus
        />
        {#if nameError}
          <div class="name-error">{nameError}</div>
        {/if}
      </div>
      <div class="naming-buttons">
        <button class="menu-btn" on:click={() => { mode = 'menu'; nameError = ''; }}>返回</button>
        <button class="menu-btn primary" on:click={confirmName}>確認</button>
      </div>
    </div>

  {:else if mode === 'continue'}
    <div class="content wide">
      <div class="section-title">選擇存檔</div>
      <div class="slot-list">
        {#each saveSlots as slot, i}
          {#if slot}
            <button class="slot-row" on:click={() => onLoadSlot(i)}>
              <div class="slot-left">
                <span class="slot-label">{i === 0 ? '自動存檔' : slot.label ?? '存檔 ' + i}</span>
                <span class="slot-location">{slot.locationName}</span>
              </div>
              <div class="slot-right">
                <span class="slot-time">{slot.worldTime}</span>
                <span class="slot-date">{formatDate(slot.ts)}</span>
              </div>
            </button>
          {:else}
            <div class="slot-row empty">
              <span class="slot-empty-label">{i === 0 ? '自動存檔' : '存檔 ' + i} — 空</span>
            </div>
          {/if}
        {/each}
      </div>
      <div class="naming-buttons">
        <button class="menu-btn" on:click={() => mode = 'menu'}>返回</button>
      </div>
    </div>
  {/if}

  <div class="version-tag">v0.1-dev</div>
</div>

<style>
  .title-screen {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
  }

  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    min-width: 260px;
  }

  .content.wide {
    min-width: 400px;
    max-width: 520px;
    width: 100%;
    align-items: stretch;
  }

  .game-title {
    font-size: 48px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--text-primary);
    font-family: var(--font-mono);
    text-align: center;
  }

  .game-subtitle {
    font-size: 13px;
    color: var(--text-dim);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    margin-top: -10px;
    text-align: center;
  }

  .section-title {
    font-size: 14px;
    color: var(--text-primary);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-family: var(--font-mono);
  }

  .section-hint {
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
    margin-top: -8px;
  }

  .menu-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
    min-width: 180px;
  }

  .menu-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.08em;
    padding: 10px 24px;
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.1s, color 0.1s, background 0.1s;
    text-align: center;
  }

  .menu-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-tertiary);
  }

  .menu-btn.primary {
    border-color: var(--accent);
    color: var(--accent);
  }

  .menu-btn.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
  }

  .menu-btn.dim {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* Name input */
  .name-input-wrap {
    width: 260px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .name-input {
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 16px;
    padding: 10px 14px;
    border-radius: 2px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    letter-spacing: 0.06em;
  }

  .name-input:focus { border-color: var(--accent); }

  .name-error {
    font-size: 11px;
    color: var(--accent-red);
    text-align: center;
  }

  .naming-buttons {
    display: flex;
    gap: 10px;
    justify-content: center;
  }

  .naming-buttons .menu-btn {
    min-width: 90px;
  }

  /* Save slots */
  .slot-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 340px;
    overflow-y: auto;
  }

  .slot-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 2px;
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: border-color 0.1s;
  }

  .slot-row:hover:not(.empty) { border-color: var(--accent); }

  .slot-row.empty {
    cursor: default;
    opacity: 0.35;
  }

  .slot-left {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .slot-label {
    font-size: 12px;
    color: var(--text-primary);
    font-family: var(--font-mono);
  }

  .slot-location {
    font-size: 10px;
    color: var(--text-dim);
  }

  .slot-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }

  .slot-time {
    font-size: 10px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .slot-date {
    font-size: 9px;
    color: var(--text-dim);
  }

  .slot-empty-label {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .version-tag {
    position: absolute;
    bottom: 16px;
    right: 20px;
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    opacity: 0.4;
  }
</style>
