<script lang="ts">
  import { inventoryOpen, detailedPlayer } from '$lib/stores/gameStore';
  import type { ResolvedInventoryItem } from '$lib/stores/gameStore';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  let selected: ResolvedInventoryItem | null = null;

  function close() {
    inventoryOpen.set(false);
    selected = null;
  }

  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function select(item: ResolvedInventoryItem) {
    selected = selected?.instanceId === item.instanceId ? null : item;
  }

  const TYPE_LABEL: Record<string, string> = {
    key:        'KEY',
    equipment:  'EQP',
    consumable: 'USE',
  };

  const TYPE_COLOR: Record<string, string> = {
    key:        'var(--accent)',
    equipment:  'var(--accent-blue)',
    consumable: '#6a9a6a',
  };
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click={handleBg}>
  <div class="backdrop-fill" on:click={handleBg}></div>
  <aside class="modal-panel" transition:fly={{ x: 260, duration: 220, easing: cubicOut }} role="dialog" aria-label="物品欄">

    <div class="modal-header">
      <button class="close-btn" on:click={close} aria-label="關閉">✕</button>
      <span class="modal-title">物品欄</span>
    </div>

    {#if $detailedPlayer && $detailedPlayer.resolvedInventory.length > 0}

      <div class="inv-grid">
        {#each $detailedPlayer.resolvedInventory as item (item.instanceId)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="inv-card"
            class:expired={item.isExpired}
            class:active={selected?.instanceId === item.instanceId}
            on:click={() => select(item)}
            style="--type-color:{TYPE_COLOR[item.type] ?? 'var(--text-dim)'}"
          >
            <span class="card-type">{TYPE_LABEL[item.type] ?? item.type}</span>
            <span class="card-name">{item.name}{item.variantLabel ? ` · ${item.variantLabel}` : ''}</span>
            {#if item.quantity > 1}
              <span class="card-qty">×{item.quantity}</span>
            {/if}
            {#if item.isExpired}
              <span class="card-expired">失效</span>
            {/if}
          </div>
        {/each}
      </div>

      {#if selected}
        <div class="detail-pane">
          <div class="detail-name">
            {selected.name}
            {#if selected.variantLabel}
              <span class="detail-variant"> · {selected.variantLabel}</span>
            {/if}
          </div>
          <div class="detail-type" style="color:{TYPE_COLOR[selected.type] ?? 'var(--text-dim)'}">
            {TYPE_LABEL[selected.type] ?? selected.type}
            {#if selected.isExpired}<span class="detail-expired"> · 已失效</span>{/if}
          </div>
          {#if selected.description}
            <div class="detail-desc">{selected.description}</div>
          {/if}
        </div>
      {/if}

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

  .backdrop-fill { flex: 1; }

  .modal-panel {
    width: 260px;
    max-width: 80vw;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border-accent);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  /* ── Header ────────────────────────────────────────── */
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

  /* ── Card grid ─────────────────────────────────────── */
  .inv-grid {
    padding: 10px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .inv-card {
    aspect-ratio: 1;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 4px;
    position: relative;
    transition: border-color 0.1s, background 0.1s;
    overflow: hidden;
  }

  .inv-card:hover {
    border-color: var(--type-color);
  }

  .inv-card.active {
    border-color: var(--type-color);
    background: color-mix(in srgb, var(--type-color) 8%, var(--bg-tertiary));
  }

  .inv-card.expired {
    opacity: 0.45;
    filter: grayscale(0.6);
  }

  .card-type {
    font-size: 8px;
    letter-spacing: 0.12em;
    color: var(--type-color);
    font-family: var(--font-mono);
  }

  .card-name {
    font-size: 9px;
    color: var(--text-secondary);
    text-align: center;
    line-height: 1.35;
    word-break: break-all;
    max-width: 100%;
  }

  .card-qty {
    position: absolute;
    bottom: 3px;
    right: 4px;
    font-size: 8px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .card-expired {
    position: absolute;
    top: 2px;
    right: 3px;
    font-size: 7px;
    color: var(--accent-red);
    letter-spacing: 0.05em;
  }

  /* ── Detail pane ───────────────────────────────────── */
  .detail-pane {
    margin: 0 10px 10px;
    padding: 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-accent);
    border-radius: 3px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .detail-name {
    font-size: 12px;
    color: var(--text-primary);
    letter-spacing: 0.02em;
    line-height: 1.4;
  }

  .detail-variant {
    color: var(--text-dim);
    font-size: 11px;
  }

  .detail-type {
    font-size: 9px;
    font-family: var(--font-mono);
    letter-spacing: 0.1em;
  }

  .detail-expired {
    color: var(--accent-red);
  }

  .detail-desc {
    font-size: 10px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-top: 2px;
    border-top: 1px solid var(--border);
    padding-top: 6px;
  }

  /* ── Empty ─────────────────────────────────────────── */
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
