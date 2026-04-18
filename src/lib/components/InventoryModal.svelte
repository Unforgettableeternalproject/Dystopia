<script lang="ts">
  import { inventoryOpen, detailedPlayer } from '$lib/stores/gameStore';

  function close() { inventoryOpen.set(false); }

  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" on:click={handleBg}>
  <div class="backdrop-fill" on:click={handleBg}></div>
  <aside class="modal-panel" role="dialog" aria-label="物品欄">
    <div class="modal-header">
      <button class="close-btn" on:click={close} aria-label="關閉">✕</button>
      <span class="modal-title">物品欄</span>
    </div>

    {#if $detailedPlayer && $detailedPlayer.inventory.length > 0}
      <div class="inv-list">
        {#each $detailedPlayer.inventory as itemId}
          <div class="inv-item">
            <span class="item-id">{itemId}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">
        <div class="empty-icon">∅</div>
        <div class="empty-text">物品欄空空如也</div>
      </div>
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
    justify-content: flex-end;
  }

  .backdrop-fill {
    flex: 1;
  }

  .modal-panel {
    width: 260px;
    max-width: 80vw;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border-accent);
    overflow-y: auto;
    animation: slideFromRight 0.15s ease-out;
    display: flex;
    flex-direction: column;
  }

  @keyframes slideFromRight {
    from { transform: translateX(100%); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 10px;
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

  .inv-list {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .inv-item {
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 2px;
    cursor: pointer;
    transition: border-color 0.1s;
  }

  .inv-item:hover {
    border-color: var(--accent);
  }

  .item-id {
    font-size: 12px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px 20px;
  }

  .empty-icon {
    font-size: 28px;
    color: var(--text-dim);
    opacity: 0.4;
  }

  .empty-text {
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
  }
</style>
