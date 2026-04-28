<script lang="ts">
  /**
   * PropEditor — form editor for prop entities.
   * Fields: id, name, description, tags[], checkPrompt
   */
  import ArrayEditor from '../ArrayEditor.svelte';

  /** The prop data object (parsed JSON, bound two-way). */
  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;
  function getTags(): string[] { return (data.tags || []) as string[]; }

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.name) data.name = '';
    if (!data.description) data.description = '';
    if (!Array.isArray(data.tags)) data.tags = [];
    if (!data.checkPrompt) data.checkPrompt = '';
  }

  $: if (data) ensureDefaults();

  function handleTagChange(tags: unknown[]) {
    data.tags = tags;
    onChange();
  }
</script>

<div class="form">
  <div class="field">
    <label class="field-label">ID</label>
    <input class="field-input" bind:value={data.id} on:input={onChange} />
  </div>

  <div class="field">
    <label class="field-label">名稱</label>
    <input class="field-input" bind:value={data.name} on:input={onChange} />
  </div>

  <div class="field">
    <label class="field-label">描述</label>
    <textarea class="field-textarea" rows="3" bind:value={data.description} on:input={onChange}></textarea>
  </div>

  <div class="field">
    <label class="field-label">標籤</label>
    <ArrayEditor
      items={Array.isArray(data.tags) ? data.tags : []}
      addLabel="+ 新增標籤"
      newItem={() => ''}
      on:change={(e) => handleTagChange(e.detail)}
      let:item
      let:index
    >
      <input
        class="field-input tag-input"
        value={item}
        on:input={(e) => {
          const tags = [...getTags()];
          tags[index] = val(e);
          data.tags = tags;
          onChange();
        }}
      />
    </ArrayEditor>
  </div>

  <div class="field">
    <label class="field-label">檢查提示（DM 敘述用）</label>
    <textarea class="field-textarea" rows="5" bind:value={data.checkPrompt} on:input={onChange}></textarea>
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

  .tag-input {
    font-size: 10px;
    padding: 2px 6px;
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
</style>
