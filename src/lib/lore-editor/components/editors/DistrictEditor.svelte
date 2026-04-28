<script lang="ts">
  /**
   * DistrictEditor — form editor for district entities.
   * Fields: id, name, regionId, description, ambience[], hasCheckpoint, regionCustom, locationIds[]
   */
  import EntityPicker from '../EntityPicker.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.name) data.name = '';
    if (!data.regionId) data.regionId = '';
    if (!data.description) data.description = '';
    if (!Array.isArray(data.ambience)) data.ambience = [];
    if (data.hasCheckpoint === undefined) data.hasCheckpoint = false;
    if (!data.regionCustom || typeof data.regionCustom !== 'object') data.regionCustom = {};
    if (!Array.isArray(data.locationIds)) data.locationIds = [];
  }

  $: if (data) ensureDefaults();

  function getArr(key: string): string[] { return (data[key] || []) as string[]; }
  function getCustom(): Record<string, unknown> { return (data.regionCustom || {}) as Record<string, unknown>; }
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
    <div class="field" style="flex:1">
      <label class="field-label">Region ID</label>
      <input class="field-input" bind:value={data.regionId} on:input={onChange} />
    </div>
  </div>

  <div class="field">
    <label class="field-label">描述</label>
    <textarea class="field-textarea" rows="4" bind:value={data.description} on:input={onChange}></textarea>
  </div>

  <div class="field">
    <label class="field-label">氛圍標籤（逗號分隔）</label>
    <input class="field-input" value={getArr('ambience').join(', ')}
      on:input={(e) => { data.ambience = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
  </div>

  <div class="field">
    <label class="field-label">
      <input type="checkbox" checked={!!data.hasCheckpoint} on:change={() => { data.hasCheckpoint = !data.hasCheckpoint; onChange(); }} />
      有檢查站
    </label>
  </div>

  <!-- Region Custom -->
  <div class="section">
    <div class="section-label">區域特殊數值 (regionCustom)</div>
    <div class="field-row">
      <div class="field" style="flex:1">
        <label class="field-label">管制程度 (controlLevel)</label>
        <input class="field-input" type="number" value={getCustom().controlLevel ?? 0}
          on:input={(e) => { getCustom().controlLevel = parseInt(val(e)) || 0; onChange(); }} />
      </div>
      <div class="field" style="flex:1">
        <label class="field-label">警戒等級 (alertLevel)</label>
        <input class="field-input" type="number" value={getCustom().alertLevel ?? 0}
          on:input={(e) => { getCustom().alertLevel = parseInt(val(e)) || 0; onChange(); }} />
      </div>
    </div>
  </div>

  <!-- Location IDs -->
  <div class="section">
    <div class="section-label">包含地點 · {getArr('locationIds').length}</div>
    {#each getArr('locationIds') as locId, i}
      <div class="ref-item">
        <EntityPicker type="location" value={locId} placeholder="地點 ID..." onSelect={(id) => { getArr('locationIds')[i] = id; data = data; onChange(); }} />
        <button class="rm" on:click={() => { data.locationIds = getArr('locationIds').filter((_l, j) => j !== i); onChange(); }}>✕</button>
      </div>
    {/each}
    <button class="add-btn" on:click={() => { data.locationIds = [...getArr('locationIds'), '']; onChange(); }}>+ 地點</button>
  </div>
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-row { display: flex; gap: 12px; align-items: flex-start; }
  .field-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; display: flex; align-items: center; gap: 4px; }
  .field-label input[type="checkbox"] { accent-color: var(--accent); }
  .field-input { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }
  .field-input:focus { border-color: var(--border-accent); }
  .field-textarea { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 6px 8px; border-radius: 2px; outline: none; resize: vertical; line-height: 1.6; }
  .field-textarea:focus { border-color: var(--border-accent); }

  .section { display: flex; flex-direction: column; gap: 6px; }
  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }

  .ref-item { display: flex; gap: 4px; align-items: center; }
  .rm { background: none; border: none; color: var(--text-dim); font-size: 9px; cursor: pointer; padding: 2px 4px; flex-shrink: 0; }
  .rm:hover { color: var(--accent-red); }

  .add-btn { background: none; border: 1px dashed var(--border); color: var(--text-dim); font-family: var(--font-mono); font-size: 9px; padding: 3px 8px; cursor: pointer; border-radius: 2px; transition: color 0.1s, border-color 0.1s; text-align: center; }
  .add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }
</style>
