<script lang="ts">
  /** IntelEditor — form editor for intel entries. */
  import type { IntelCategory } from '$lib/types/intel';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const CATEGORIES: { value: IntelCategory; label: string }[] = [
    { value: 'political', label: '政治' },
    { value: 'personal',  label: '人物' },
    { value: 'threat',    label: '威脅' },
    { value: 'location',  label: '地點' },
    { value: 'rumor',     label: '謠言' },
  ];

  function ensureDefaults() {
    if (!data.id)          data.id          = '';
    if (!data.label)       data.label       = '';
    if (!data.description) data.description = '';
    if (!data.category)    data.category    = 'rumor';
  }

  $: if (data) ensureDefaults();
</script>

<div class="form">
  <div class="field-row">
    <div class="field" style="flex:2">
      <label class="field-label">ID</label>
      <input class="field-input" bind:value={data.id} on:input={onChange} />
    </div>
    <div class="field" style="flex:1">
      <label class="field-label">分類</label>
      <select class="field-input" bind:value={data.category} on:change={onChange}>
        {#each CATEGORIES as c}
          <option value={c.value}>{c.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="field">
    <label class="field-label">標題（顯示名稱）</label>
    <input class="field-input" bind:value={data.label} on:input={onChange} placeholder="例：礦坑的秘密" />
  </div>

  <div class="field">
    <label class="field-label">描述（玩家看到的情報內容）</label>
    <textarea class="field-textarea" rows="5" bind:value={data.description} on:input={onChange}
      placeholder="描述玩家知道的事情..."></textarea>
  </div>
</div>
