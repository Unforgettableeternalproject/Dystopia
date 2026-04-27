<script lang="ts">
  /**
   * KeyValueEditor — for editing Record<string, number> or Record<string, string> fields.
   * Shows each key-value pair as a row with add/remove.
   * Optionally provides an EntityPicker for keys.
   */
  import type { EntityType } from '../entityTypes';
  import EntityPicker from './EntityPicker.svelte';

  /** The data object to edit (Record<string, number|string>). */
  export let data: Record<string, unknown> = {};
  export let onChange: () => void = () => {};
  /** If set, keys are selected via EntityPicker of this type. */
  export let keyEntityType: EntityType | null = null;
  /** Placeholder for the key input. */
  export let keyPlaceholder: string = 'key';
  /** Placeholder for the value input. */
  export let valuePlaceholder: string = 'value';
  /** Type of value input: 'number' or 'text'. */
  export let valueType: 'number' | 'text' = 'number';

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  function entries(): [string, unknown][] {
    return Object.entries(data).filter(([k]) => !k.startsWith('_'));
  }

  function setKey(oldKey: string, newKey: string) {
    if (newKey === oldKey) return;
    const v = data[oldKey];
    delete data[oldKey];
    data[newKey] = v;
    data = data;
    onChange();
  }

  function setValue(key: string, raw: string) {
    data[key] = valueType === 'number' ? (parseFloat(raw) || 0) : raw;
    data = data;
    onChange();
  }

  function addEntry() {
    let key = '';
    let idx = 0;
    while (key === '' || key in data) { key = `key_${idx++}`; }
    data[key] = valueType === 'number' ? 0 : '';
    data = data;
    onChange();
  }

  function removeEntry(key: string) {
    delete data[key];
    data = data;
    onChange();
  }
</script>

<div class="kv-wrap">
  {#each entries() as [key, value], _i (key)}
    <div class="kv-row">
      <div class="kv-key">
        {#if keyEntityType}
          <EntityPicker type={keyEntityType} value={key} placeholder={keyPlaceholder}
            onSelect={(newKey) => setKey(key, newKey)}
          />
        {:else}
          <input class="kv-input" value={key} placeholder={keyPlaceholder}
            on:change={(e) => setKey(key, val(e))} />
        {/if}
      </div>
      <input class="kv-input kv-val" type={valueType} value={value ?? (valueType === 'number' ? 0 : '')}
        placeholder={valuePlaceholder}
        on:input={(e) => setValue(key, val(e))} />
      <button class="kv-rm" on:click={() => removeEntry(key)} title="刪除">✕</button>
    </div>
  {/each}
  <button class="kv-add" on:click={addEntry}>+</button>
</div>

<style>
  .kv-wrap { display: flex; flex-direction: column; gap: 3px; }

  .kv-row { display: flex; align-items: center; gap: 4px; }

  .kv-key { flex: 1; min-width: 0; }

  .kv-input {
    background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 10px; padding: 3px 6px; border-radius: 2px; outline: none;
    width: 100%;
  }
  .kv-input:focus { border-color: var(--border-accent); }

  .kv-val { width: 60px; flex: 0 0 60px; text-align: right; }

  .kv-rm {
    background: none; border: none; color: var(--text-dim); font-size: 8px;
    cursor: pointer; padding: 1px 3px; flex-shrink: 0;
  }
  .kv-rm:hover { color: var(--accent-red); }

  .kv-add {
    background: none; border: 1px dashed var(--border); color: var(--text-dim);
    font-family: var(--font-mono); font-size: 9px; padding: 2px 6px; cursor: pointer;
    border-radius: 2px; align-self: flex-start; transition: color 0.1s, border-color 0.1s;
  }
  .kv-add:hover { border-color: var(--accent-dim); color: var(--accent); }
</style>
