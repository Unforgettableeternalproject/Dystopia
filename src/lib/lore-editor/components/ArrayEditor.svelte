<script lang="ts">
  /**
   * ArrayEditor — generic array editor with add/remove/reorder.
   * Renders a slot for each item plus controls.
   */
  import { createEventDispatcher } from 'svelte';

  export let items: unknown[] = [];
  export let label: string = '';
  export let addLabel: string = '+ 新增';
  export let newItem: () => unknown = () => '';

  const dispatch = createEventDispatcher();

  function add() {
    items = [...items, newItem()];
    dispatch('change', items);
  }

  function remove(index: number) {
    items = items.filter((_, i) => i !== index);
    dispatch('change', items);
  }

  function moveUp(index: number) {
    if (index <= 0) return;
    const arr = [...items];
    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
    items = arr;
    dispatch('change', items);
  }

  function moveDown(index: number) {
    if (index >= items.length - 1) return;
    const arr = [...items];
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    items = arr;
    dispatch('change', items);
  }
</script>

<div class="ae-wrap">
  {#if label}
    <div class="ae-label">{label}</div>
  {/if}
  {#each items as item, i (i)}
    <div class="ae-item">
      <div class="ae-controls">
        <span class="ae-index">{i}</span>
        <button class="ae-btn" on:click={() => moveUp(i)} disabled={i === 0} title="上移">▲</button>
        <button class="ae-btn" on:click={() => moveDown(i)} disabled={i === items.length - 1} title="下移">▼</button>
        <button class="ae-btn ae-remove" on:click={() => remove(i)} title="刪除">✕</button>
      </div>
      <div class="ae-content">
        <slot {item} index={i} />
      </div>
    </div>
  {/each}
  <button class="ae-add" on:click={add}>{addLabel}</button>
</div>

<style>
  .ae-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ae-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 2px;
  }

  .ae-item {
    display: flex;
    gap: 6px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }

  .ae-item:last-of-type { border-bottom: none; }

  .ae-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .ae-index {
    font-size: 8px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    width: 14px;
    text-align: center;
  }

  .ae-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 7px;
    cursor: pointer;
    padding: 1px 3px;
    border-radius: 2px;
    transition: color 0.1s;
    line-height: 1;
  }

  .ae-btn:hover:not(:disabled) { color: var(--text-secondary); }
  .ae-btn:disabled { opacity: 0.2; cursor: default; }
  .ae-remove:hover:not(:disabled) { color: var(--accent-red); }

  .ae-content {
    flex: 1;
    min-width: 0;
  }

  .ae-add {
    background: none;
    border: 1px dashed var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 9px;
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.1s, color 0.1s;
    text-align: center;
    margin-top: 4px;
  }

  .ae-add:hover { border-color: var(--accent-dim); color: var(--accent); }
</style>
