<script lang="ts">
  /**
   * ItemEditor — form editor for item entities.
   * Type-dependent sub-forms: consumable, equipment, key, info.
   */
  import ArrayEditor from '../ArrayEditor.svelte';
  import KeyValueEditor from '../KeyValueEditor.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;
  const chk = (e: Event) => (e.target as HTMLInputElement).checked;

  const ITEM_TYPES = ['consumable', 'equipment', 'key', 'info'];
  const OBTAINED_FROM_OPTIONS = ['event', 'npc', 'prop', 'shop', 'story', 'combat'];

  // Template-safe accessors (avoid TS `as` in template expressions)
  function getObtainedFrom(): string[] { return (data.obtainedFrom || []) as string[]; }
  function getEffect(): Record<string, unknown> { return (data.effect || {}) as Record<string, unknown>; }
  function getVariants(): Record<string, string>[] { return (data.variants || []) as Record<string, string>[]; }
  function effectJson(): string { return JSON.stringify(getEffect()?.statusChanges ?? {}, null, 2); }
  function bonusJson(): string { return JSON.stringify(data.statBonus ?? {}, null, 2); }
  function variantField(item: unknown, field: string): string { return ((item as Record<string, string>)?.[field]) ?? ''; }

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.name) data.name = '';
    if (!data.description) data.description = '';
    if (!data.type) data.type = 'key';
    if (!Array.isArray(data.obtainedFrom)) data.obtainedFrom = [];
    if (data.stackable === undefined) data.stackable = false as boolean;
    if (data.isTemplate === undefined) data.isTemplate = false as boolean;
  }

  $: if (data) ensureDefaults();

  function toggleObtainedFrom(src: string) {
    const arr = (data.obtainedFrom as string[]) || [];
    if (arr.includes(src)) {
      data.obtainedFrom = arr.filter(s => s !== src);
    } else {
      data.obtainedFrom = [...arr, src];
    }
    onChange();
  }

  // Consumable effect helpers
  function ensureEffect() {
    if (!data.effect || typeof data.effect !== 'object') {
      data.effect = {};
    }
  }
  function getStatusChanges(): Record<string, unknown> {
    ensureEffect();
    const eff = getEffect();
    if (!eff.statusChanges || typeof eff.statusChanges !== 'object') eff.statusChanges = {};
    return eff.statusChanges as Record<string, unknown>;
  }
  function getStatBonus(): Record<string, unknown> {
    if (!data.statBonus || typeof data.statBonus !== 'object') data.statBonus = {};
    return data.statBonus as Record<string, unknown>;
  }

  function handleVariantChange(variants: unknown[]) {
    data.variants = variants;
    onChange();
  }
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
    <textarea class="field-textarea" rows="2" bind:value={data.description} on:input={onChange}></textarea>
  </div>

  <div class="field-row">
    <div class="field">
      <label class="field-label">類型</label>
      <select class="field-select" bind:value={data.type} on:change={onChange}>
        {#each ITEM_TYPES as t}
          <option value={t}>{t}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label class="field-label">
        <input type="checkbox" checked={!!data.stackable} on:change={(e) => { data.stackable = chk(e); onChange(); }} />
        可堆疊
      </label>
    </div>
    <div class="field">
      <label class="field-label">
        <input type="checkbox" checked={!!data.isTemplate} on:change={(e) => { data.isTemplate = chk(e); onChange(); }} />
        模板
      </label>
    </div>
  </div>

  <div class="field">
    <label class="field-label">獲取來源</label>
    <div class="chip-row">
      {#each OBTAINED_FROM_OPTIONS as src}
        <button
          class="chip"
          class:active={getObtainedFrom().includes(src)}
          on:click={() => toggleObtainedFrom(src)}
        >{src}</button>
      {/each}
    </div>
  </div>

  <!-- Type-specific sub-forms -->
  {#if data.type === 'consumable'}
    <div class="sub-section">
      <div class="sub-label">消耗品設定</div>
      <div class="field">
        <label class="field-label">使用敘述</label>
        <textarea class="field-textarea" rows="2" bind:value={data.useNarrative} on:input={onChange}></textarea>
      </div>
      <div class="field">
        <label class="field-label">效果 — statusChanges</label>
        <KeyValueEditor
          data={getStatusChanges()}
          keyPlaceholder="statusStats.stamina"
          valuePlaceholder="delta"
          onChange={() => { onChange(); }}
        />
      </div>
    </div>
  {:else if data.type === 'equipment'}
    <div class="sub-section">
      <div class="sub-label">裝備設定</div>
      <div class="field">
        <label class="field-label">加成 — statBonus</label>
        <KeyValueEditor
          data={getStatBonus()}
          keyPlaceholder="strength / knowledge / ..."
          valuePlaceholder="加成值"
          onChange={() => { onChange(); }}
        />
      </div>
    </div>
  {:else if data.type === 'key'}
    <div class="sub-section">
      <div class="sub-label">鑰匙道具設定</div>
      <div class="field">
        <label class="field-label">過期時間（遊戲內分鐘，0=不過期）</label>
        <input class="field-input" type="number" bind:value={data.expiresAfterMinutes} on:input={onChange} />
      </div>
      <div class="field">
        <label class="field-label">變體</label>
        <ArrayEditor
          items={Array.isArray(data.variants) ? data.variants : []}
          addLabel="+ 新增變體"
          newItem={() => ({ id: '', label: '', description: '' })}
          on:change={(e) => handleVariantChange(e.detail)}
          let:item
          let:index
        >
          <div class="variant-row">
            <input class="field-input sm" placeholder="id" value={variantField(item, 'id')}
              on:input={(e) => {
                const arr = [...getVariants()];
                arr[index] = { ...arr[index], id: val(e) };
                data.variants = arr; onChange();
              }} />
            <input class="field-input sm" placeholder="label" value={variantField(item, 'label')}
              on:input={(e) => {
                const arr = [...getVariants()];
                arr[index] = { ...arr[index], label: val(e) };
                data.variants = arr; onChange();
              }} />
            <input class="field-input sm" placeholder="description" value={variantField(item, 'description')}
              on:input={(e) => {
                const arr = [...getVariants()];
                arr[index] = { ...arr[index], description: val(e) };
                data.variants = arr; onChange();
              }} />
          </div>
        </ArrayEditor>
      </div>
    </div>
  {:else if data.type === 'info'}
    <div class="sub-section">
      <div class="sub-label">資訊道具設定</div>
      <div class="field">
        <label class="field-label">內容</label>
        <textarea class="field-textarea" rows="6" bind:value={data.content} on:input={onChange}></textarea>
      </div>
    </div>
  {/if}
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
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .field-label input[type="checkbox"] {
    accent-color: var(--accent);
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

  .field-input.sm {
    font-size: 10px;
    padding: 2px 6px;
  }

  .field-select {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 2px;
    outline: none;
  }

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
  .field-textarea.mono { font-size: 10px; }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    font-size: 9px;
    font-family: var(--font-mono);
    padding: 2px 8px;
    border: 1px solid var(--border);
    color: var(--text-dim);
    background: transparent;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.1s;
  }

  .chip.active {
    border-color: var(--accent-dim);
    color: var(--accent);
    background: var(--bg-tertiary);
  }

  .chip:hover { border-color: var(--border-accent); color: var(--text-secondary); }

  .sub-section {
    border: 1px solid var(--border);
    border-radius: 2px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sub-label {
    font-size: 10px;
    color: var(--text-secondary);
    letter-spacing: 0.06em;
    font-weight: 500;
  }

  .variant-row {
    display: flex;
    gap: 6px;
  }

  .variant-row .field-input { flex: 1; }
</style>
