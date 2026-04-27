<script lang="ts">
  /**
   * EntityPicker — searchable dropdown to select an entity ID by type.
   * Loads the entity list for the given type and lets the user search + pick.
   */
  import { onMount } from 'svelte';
  import { ENTITY_TYPES, type EntityType } from '../entityTypes';
  import { listLoreDir } from '../fileUtils';

  export let type: EntityType;
  export let value: string = '';
  export let placeholder: string = '';
  export let allowClear: boolean = true;

  const val = (e: Event) => (e.target as HTMLInputElement).value;
  let entries: { id: string; name: string }[] = [];
  let filter = '';
  let open = false;
  let inputEl: HTMLInputElement;

  $: meta = ENTITY_TYPES.find(t => t.type === type);
  $: filtered = entries.filter(e =>
    !filter || e.id.toLowerCase().includes(filter.toLowerCase())
  );

  async function load() {
    if (!meta) return;
    const list = await listLoreDir(meta.dir);
    entries = list.map(e => ({ id: e.id, name: e.name }));
  }

  function select(id: string) {
    value = id;
    filter = '';
    open = false;
  }

  function clear() {
    value = '';
    filter = '';
  }

  function handleFocus() {
    open = true;
  }

  function handleBlur() {
    // Delay to allow click on dropdown items
    setTimeout(() => { open = false; }, 150);
  }

  onMount(load);
  // Reload when type changes
  $: type, load();
</script>

<div class="ep-wrap">
  <div class="ep-input-row">
    <input
      bind:this={inputEl}
      class="ep-input"
      value={open ? filter : value}
      on:input={(e) => { filter = val(e); }}
      on:focus={handleFocus}
      on:blur={handleBlur}
      placeholder={placeholder || `選擇 ${meta?.label ?? type}...`}
      autocomplete="off"
      spellcheck="false"
    />
    {#if value && allowClear}
      <button class="ep-clear" on:click={clear} title="清除">✕</button>
    {/if}
  </div>
  {#if open}
    <div class="ep-dropdown">
      {#each filtered.slice(0, 30) as entry (entry.id)}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="ep-option"
          class:selected={entry.id === value}
          on:mousedown|preventDefault={() => select(entry.id)}
        >
          {entry.id}
        </div>
      {/each}
      {#if filtered.length === 0}
        <div class="ep-empty">無結果</div>
      {/if}
      {#if filtered.length > 30}
        <div class="ep-more">還有 {filtered.length - 30} 個...</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ep-wrap {
    position: relative;
    width: 100%;
  }

  .ep-input-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .ep-input {
    flex: 1;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    border-radius: 2px;
    outline: none;
  }

  .ep-input:focus { border-color: var(--border-accent); }
  .ep-input::placeholder { color: var(--text-dim); }

  .ep-clear {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 9px;
    cursor: pointer;
    padding: 2px 4px;
  }

  .ep-clear:hover { color: var(--accent-red); }

  .ep-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 50;
    max-height: 180px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-top: none;
    border-radius: 0 0 2px 2px;
  }

  .ep-option {
    padding: 3px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.06s;
  }

  .ep-option:hover { background: var(--bg-tertiary); }
  .ep-option.selected { color: var(--accent); background: var(--bg-tertiary); }

  .ep-empty, .ep-more {
    padding: 4px 8px;
    font-size: 9px;
    color: var(--text-dim);
    font-style: italic;
  }

  .ep-dropdown::-webkit-scrollbar { width: 4px; }
  .ep-dropdown::-webkit-scrollbar-track { background: var(--scrollbar-track); }
  .ep-dropdown::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }
</style>
