<script lang="ts">
  /**
   * FactionEditor — form editor for faction entities.
   * Fields: id, name, regionId, description, defaultReputation, relations[]
   */
  import EntityPicker from '../EntityPicker.svelte';
  import ArrayEditor from '../ArrayEditor.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.name) data.name = '';
    if (!data.regionId) data.regionId = '';
    if (!data.description) data.description = '';
    if (data.defaultReputation === undefined) data.defaultReputation = 0;
    if (!Array.isArray(data.relations)) data.relations = [];
  }

  $: if (data) ensureDefaults();

  function handleRelationsChange(relations: unknown[]) {
    data.relations = relations;
    onChange();
  }

  function getRelations(): Record<string, unknown>[] { return (data.relations || []) as Record<string, unknown>[]; }
  function relField(item: unknown, field: string): string { return String((item as Record<string, unknown>)?.[field] ?? ''); }
</script>

<div class="form">
  <div class="field-row">
    <div class="field" style="flex:1">
      <label class="field-label">ID</label>
      <input class="field-input" bind:value={data.id} on:input={onChange} />
    </div>
    <div class="field" style="flex:1">
      <label class="field-label">名稱</label>
      <input class="field-input" bind:value={data.name} on:input={onChange} />
    </div>
  </div>

  <div class="field">
    <label class="field-label">描述</label>
    <textarea class="field-textarea" rows="3" bind:value={data.description} on:input={onChange}></textarea>
  </div>

  <div class="field-row">
    <div class="field" style="flex:1">
      <label class="field-label">預設聲望</label>
      <input class="field-input" type="number" bind:value={data.defaultReputation} on:input={onChange} />
    </div>
  </div>

  <div class="field">
    <label class="field-label">關係</label>
    <ArrayEditor
      items={Array.isArray(data.relations) ? data.relations : []}
      addLabel="+ 新增關係"
      newItem={() => ({ targetFactionId: '', weight: 0 })}
      on:change={(e) => handleRelationsChange(e.detail)}
      let:item
      let:index
    >
      <div class="relation-row">
        <div class="relation-picker">
          <EntityPicker
            type="faction"
            value={relField(item, 'targetFactionId')}
            placeholder="目標派系..."
            on:change
          />
        </div>
        <input
          class="field-input weight-input"
          type="number"
          step="0.1"
          value={relField(item, 'weight') || '0'}
          on:input={(e) => {
            const arr = [...getRelations()];
            arr[index] = { ...arr[index], weight: parseFloat(val(e)) || 0 };
            data.relations = arr;
            onChange();
          }}
          placeholder="權重"
        />
      </div>
    </ArrayEditor>
  </div>
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .field-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .field-input {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 2px;
    outline: none;
  }

  .field-input:focus { border-color: var(--border-accent); }

  .field-textarea {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 8px;
    border-radius: 2px;
    outline: none;
    resize: vertical;
    line-height: 1.6;
  }

  .field-textarea:focus { border-color: var(--border-accent); }

  .relation-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .relation-picker { flex: 1; }

  .weight-input {
    width: 60px;
    flex-shrink: 0;
    font-size: 10px;
    padding: 3px 6px;
  }
</style>
