<script lang="ts">
  import { observeSnapshot, isStreaming, inputDisabled } from '$lib/stores/gameStore';
  import type { ActionTargetKind } from '$lib/types';

  export let onCheck: (targetKind: ActionTargetKind, targetId: string, targetName: string) => void;

  let expanded = false;
  let btnEl: HTMLButtonElement;
  let flyoutStyle = '';

  function toggle() {
    if ($inputDisabled || $isStreaming) return;
    expanded = !expanded;
    if (expanded && btnEl) {
      const rect = btnEl.getBoundingClientRect();
      flyoutStyle = `bottom: ${window.innerHeight - rect.top + 6}px; right: ${window.innerWidth - rect.right}px;`;
    }
  }

  function handleCheck(targetKind: ActionTargetKind, targetId: string, targetName: string) {
    if ($inputDisabled || $isStreaming) return;
    onCheck(targetKind, targetId, targetName);
    expanded = false;
  }

  function handleClickOutside(e: MouseEvent) {
    if (!expanded) return;
    const target = e.target as HTMLElement;
    if (btnEl?.contains(target)) return;
    const flyout = document.querySelector('.observe-flyout');
    if (flyout?.contains(target)) return;
    expanded = false;
  }

  $: disabled = $inputDisabled || $isStreaming;
  $: snap = $observeSnapshot;
  $: hasContent = snap.exits.length > 0 || snap.npcs.length > 0 || snap.props.length > 0;
</script>

<svelte:window on:mousedown={handleClickOutside} />

<div class="observe-root">
  <button
    class="observe-btn"
    class:active={expanded}
    bind:this={btnEl}
    on:click={toggle}
    {disabled}
    title="觀察目前場景"
  >
    觀察
  </button>

  {#if expanded && hasContent}
    <div class="observe-flyout" style={flyoutStyle}>
      {#if snap.exits.length > 0}
        <div class="section">
          <span class="section-label">通道</span>
          {#each snap.exits as exit}
            {#if exit.isLocked}
              <div class="entry locked" title={exit.lockedMessage}>
                <span class="lock-icon">✕</span>
                <span class="entry-text">{exit.description}</span>
              </div>
            {:else}
              <button
                class="entry clickable"
                {disabled}
                on:click={() => handleCheck('location', exit.targetLocationId, exit.description)}
              >
                <span class="entry-text">{exit.description}</span>
              </button>
            {/if}
          {/each}
        </div>
      {/if}

      {#if snap.npcs.length > 0}
        <div class="section">
          <span class="section-label">人物</span>
          {#each snap.npcs as npc}
            <button
              class="entry clickable"
              {disabled}
              on:click={() => handleCheck('npc', npc.id, npc.name)}
            >
              <span class="entry-text">{npc.name}</span>
            </button>
          {/each}
        </div>
      {/if}

      {#if snap.props.length > 0}
        <div class="section">
          <span class="section-label">物件</span>
          {#each snap.props as prop}
            <button
              class="entry clickable"
              {disabled}
              on:click={() => handleCheck('prop', prop.id, prop.name)}
            >
              {#if prop.isRestPoint}
                <span class="rest-icon" title="休息點">◆</span>
              {/if}
              <span class="entry-text">{prop.name}</span>
            </button>
          {/each}
        </div>
      {/if}

      {#if snap.canFullRest}
        <div class="rest-hint">可在此處完整休息</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .observe-root {
    position: relative;
    flex-shrink: 0;
  }

  .observe-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-thought);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 6px 14px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    white-space: nowrap;
    border-radius: 2px;
  }

  .observe-btn:hover:not(:disabled) {
    background: var(--bg-secondary);
    border-color: var(--accent-blue);
    color: var(--text-primary);
  }

  .observe-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .observe-btn.active {
    border-color: var(--accent-blue);
    color: var(--text-primary);
  }

  .observe-flyout {
    position: fixed;
    min-width: 200px;
    max-width: 280px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 0;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.4);
    z-index: 150;
  }

  .observe-flyout::-webkit-scrollbar {
    width: 3px;
  }

  .section {
    padding: 0 10px;
  }

  .section + .section {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  .section-label {
    display: block;
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 4px;
    user-select: none;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    padding: 3px 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    background: none;
    border: none;
    border-radius: 2px;
    text-align: left;
    color: var(--text-secondary);
  }

  .entry.clickable {
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .entry.clickable:hover:not(:disabled) {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .entry.clickable:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .entry.locked {
    opacity: 0.4;
    cursor: default;
  }

  .lock-icon {
    color: var(--accent-red);
    font-size: 10px;
    flex-shrink: 0;
  }

  .rest-icon {
    color: var(--accent-green, #6a9955);
    font-size: 10px;
    flex-shrink: 0;
  }

  .entry-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rest-hint {
    padding: 6px 10px 2px;
    font-size: 10px;
    color: var(--accent-green, #6a9955);
    font-style: italic;
  }
</style>
