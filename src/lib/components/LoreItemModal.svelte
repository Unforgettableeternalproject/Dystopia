<script lang="ts">
  import { fade } from 'svelte/transition';
  import { loreItemOpen } from '$lib/stores/gameStore';

  $: item = $loreItemOpen;

  function close() {
    loreItemOpen.set(null);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if item}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="backdrop" transition:fade={{ duration: 180 }} on:click={close}>
    <div class="modal" on:click|stopPropagation>
      <div class="header">
        <span class="title">{item.name}</span>
        <button class="close-btn" on:click={close}>&times;</button>
      </div>
      <div class="content">
        {item.content}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    width: 420px;
    max-width: 90vw;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .content {
    padding: 16px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.7;
    overflow-y: auto;
    white-space: pre-wrap;
  }
</style>
