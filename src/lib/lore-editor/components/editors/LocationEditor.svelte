<script lang="ts">
  /**
   * LocationEditor — form editor for location entities.
   * Structure: id, name, regionId, districtId, tags[], base { ... }, sublocations[]
   */
  import EntityPicker from '../EntityPicker.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.name) data.name = '';
    if (!data.base || typeof data.base !== 'object') data.base = {};
    const base = data.base as Record<string, unknown>;
    if (!base.name) base.name = '';
    if (!base.description) base.description = '';
    if (!Array.isArray(base.npcIds)) base.npcIds = [];
    if (!Array.isArray(base.eventIds)) base.eventIds = [];
    if (!Array.isArray(base.propIds)) base.propIds = [];
    if (!Array.isArray(base.connections)) base.connections = [];
    if (!Array.isArray(base.ambience)) base.ambience = [];
    if (!Array.isArray(data.tags)) data.tags = [];
    if (!Array.isArray(data.sublocations)) data.sublocations = [];
  }

  $: if (data) ensureDefaults();

  function getBase(): Record<string, unknown> { return (data.base || {}) as Record<string, unknown>; }
  function getArr(obj: Record<string, unknown>, key: string): string[] { return (obj[key] || []) as string[]; }
  function getConns(): Record<string, unknown>[] { return (getBase().connections || []) as Record<string, unknown>[]; }
  function s(obj: Record<string, unknown>, key: string): string { return String(obj[key] ?? ''); }
  function getSubs(): Record<string, unknown>[] { return (data.sublocations || []) as Record<string, unknown>[]; }
  function subName(sub: Record<string, unknown>): string {
    const base = sub.base as Record<string, unknown> | undefined;
    return String(base?.name ?? '');
  }
  function setSubBaseName(i: number, name: string) {
    const subs = getSubs();
    if (!subs[i].base) subs[i].base = {};
    (subs[i].base as Record<string, unknown>).name = name;
    data = data;
    onChange();
  }

  function addToArr(obj: Record<string, unknown>, key: string) {
    obj[key] = [...getArr(obj, key), ''];
    data = data; onChange();
  }

  function removeFromArr(obj: Record<string, unknown>, key: string, i: number) {
    obj[key] = getArr(obj, key).filter((_v, j) => j !== i);
    data = data; onChange();
  }

  function addConnection() {
    const base = getBase();
    const conns = getConns();
    conns.push({ targetLocationId: '', description: '' });
    base.connections = conns;
    data = data; onChange();
  }

  function removeConnection(i: number) {
    const base = getBase();
    base.connections = getConns().filter((_c, j) => j !== i);
    data = data; onChange();
  }

  let expandedConns = new Set<number>();
  function toggleConn(i: number) {
    if (expandedConns.has(i)) expandedConns.delete(i);
    else expandedConns.add(i);
    expandedConns = expandedConns;
  }

  let expandedSubs = new Set<number>();
  function toggleSub(i: number) {
    if (expandedSubs.has(i)) expandedSubs.delete(i);
    else expandedSubs.add(i);
    expandedSubs = expandedSubs;
  }
</script>

<div class="form">
  <!-- Basic info -->
  <div class="field-row">
    <div class="field" style="flex:1">
      <label class="field-label">ID</label>
      <input class="field-input" bind:value={data.id} on:input={onChange} />
    </div>
    <div class="field" style="flex:1">
      <label class="field-label">名稱</label>
      <input class="field-input" value={getBase().name ?? ''} on:input={(e) => { getBase().name = val(e); onChange(); }} />
    </div>
  </div>

  <div class="field-row">
    <div class="field" style="flex:1">
      <label class="field-label">Region ID</label>
      <input class="field-input" bind:value={data.regionId} on:input={onChange} />
    </div>
    <div class="field" style="flex:1">
      <label class="field-label">District ID</label>
      <input class="field-input" bind:value={data.districtId} on:input={onChange} />
    </div>
  </div>

  <div class="field">
    <label class="field-label">描述</label>
    <textarea class="field-textarea" rows="3" value={s(getBase(), 'description')} on:input={(e) => { getBase().description = val(e); onChange(); }}></textarea>
  </div>

  <!-- Tags -->
  <div class="field">
    <label class="field-label">標籤</label>
    <div class="tag-row">
      {#each getArr(data, 'tags') as tag, i}
        <div class="tag-chip">
          <input class="mini-input" value={tag} on:input={(e) => {
            const tags = getArr(data, 'tags'); tags[i] = val(e); data.tags = tags; onChange();
          }} />
          <button class="rm" on:click={() => removeFromArr(data, 'tags', i)}>✕</button>
        </div>
      {/each}
      <button class="add-btn sm" on:click={() => addToArr(data, 'tags')}>+</button>
    </div>
  </div>

  <!-- NPC / Event / Prop ID arrays -->
  <div class="section-label">關聯實體</div>
  <div class="ref-grid">
    <div class="ref-col">
      <div class="ref-label">NPC</div>
      {#each getArr(getBase(), 'npcIds') as npcId, i}
        <div class="ref-item">
          <EntityPicker type="npc" value={npcId} placeholder="NPC..." />
          <button class="rm" on:click={() => removeFromArr(getBase(), 'npcIds', i)}>✕</button>
        </div>
      {/each}
      <button class="add-btn sm" on:click={() => addToArr(getBase(), 'npcIds')}>+ NPC</button>
    </div>

    <div class="ref-col">
      <div class="ref-label">事件</div>
      {#each getArr(getBase(), 'eventIds') as evtId, i}
        <div class="ref-item">
          <EntityPicker type="event" value={evtId} placeholder="事件..." />
          <button class="rm" on:click={() => removeFromArr(getBase(), 'eventIds', i)}>✕</button>
        </div>
      {/each}
      <button class="add-btn sm" on:click={() => addToArr(getBase(), 'eventIds')}>+ 事件</button>
    </div>

    <div class="ref-col">
      <div class="ref-label">物件</div>
      {#each getArr(getBase(), 'propIds') as propId, i}
        <div class="ref-item">
          <EntityPicker type="prop" value={propId} placeholder="物件..." />
          <button class="rm" on:click={() => removeFromArr(getBase(), 'propIds', i)}>✕</button>
        </div>
      {/each}
      <button class="add-btn sm" on:click={() => addToArr(getBase(), 'propIds')}>+ 物件</button>
    </div>
  </div>

  <!-- Connections -->
  <div class="section">
    <div class="section-label">連結 · {getConns().length}</div>
    {#each getConns() as conn, i}
      <div class="card">
        <div class="card-header" on:click={() => toggleConn(i)}>
          <span class="card-arrow">{expandedConns.has(i) ? '▼' : '▶'}</span>
          <span class="card-title">{conn.targetLocationId || '（未設定）'}</span>
          <button class="rm sm" on:click|stopPropagation={() => removeConnection(i)}>✕</button>
        </div>
        {#if expandedConns.has(i)}
          <div class="card-body">
            <div class="field">
              <label class="field-label">目標地點</label>
              <EntityPicker type="location" value={String(conn.targetLocationId ?? '')} placeholder="地點 ID..." />
            </div>
            <div class="field">
              <label class="field-label">描述</label>
              <input class="field-input sm" value={conn.description ?? ''} on:input={(e) => {
                getConns()[i].description = val(e); data = data; onChange();
              }} />
            </div>
          </div>
        {/if}
      </div>
    {/each}
    <button class="add-btn" on:click={addConnection}>+ 新增連結</button>
  </div>

  <!-- Sublocations (summary only — too deep to fully edit here) -->
  <div class="section">
    <div class="section-label">子位置 · {getSubs().length}</div>
    {#each getSubs() as sub, i}
      <div class="card">
        <div class="card-header" on:click={() => toggleSub(i)}>
          <span class="card-arrow">{expandedSubs.has(i) ? '▼' : '▶'}</span>
          <span class="card-title">{sub.id || `sub_${i}`} — {subName(sub)}</span>
        </div>
        {#if expandedSubs.has(i)}
          <div class="card-body">
            <div class="field-row">
              <div class="field" style="flex:1">
                <label class="field-label">ID</label>
                <input class="field-input sm" value={sub.id ?? ''} on:input={(e) => { getSubs()[i].id = val(e); data = data; onChange(); }} />
              </div>
              <div class="field" style="flex:1">
                <label class="field-label">名稱</label>
                <input class="field-input sm" value={subName(sub)} on:input={(e) => { setSubBaseName(i, val(e)); }} />
              </div>
            </div>
            <div class="hint">子位置的完整編輯請使用 JSON 模式</div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-row { display: flex; gap: 12px; align-items: flex-start; }
  .field-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; }
  .field-input {
    background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none;
  }
  .field-input:focus { border-color: var(--border-accent); }
  .field-input.sm { font-size: 10px; padding: 3px 6px; }
  .field-textarea {
    background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 11px; padding: 6px 8px; border-radius: 2px;
    outline: none; resize: vertical; line-height: 1.6;
  }
  .field-textarea:focus { border-color: var(--border-accent); }

  .section { display: flex; flex-direction: column; gap: 6px; }
  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }

  .tag-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .tag-chip { display: flex; align-items: center; gap: 2px; }
  .mini-input {
    background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 9px; padding: 2px 5px; border-radius: 2px; outline: none; width: 80px;
  }
  .mini-input:focus { border-color: var(--border-accent); }

  .ref-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .ref-col { display: flex; flex-direction: column; gap: 4px; }
  .ref-label { font-size: 8px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; }
  .ref-item { display: flex; gap: 3px; align-items: center; }

  .card { border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
  .card-header {
    display: flex; align-items: center; gap: 6px; padding: 4px 8px;
    background: var(--bg-tertiary); cursor: pointer; transition: background 0.08s;
  }
  .card-header:hover { background: var(--bg-secondary); }
  .card-arrow { font-size: 8px; color: var(--text-dim); flex-shrink: 0; }
  .card-title { font-size: 10px; color: var(--text-secondary); font-family: var(--font-mono); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  .rm { background: none; border: none; color: var(--text-dim); font-size: 9px; cursor: pointer; padding: 2px 4px; flex-shrink: 0; }
  .rm:hover { color: var(--accent-red); }
  .rm.sm { font-size: 8px; padding: 1px 3px; }

  .add-btn {
    background: none; border: 1px dashed var(--border); color: var(--text-dim);
    font-family: var(--font-mono); font-size: 9px; padding: 3px 8px; cursor: pointer;
    border-radius: 2px; transition: color 0.1s, border-color 0.1s; text-align: center;
  }
  .add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }
  .add-btn.sm { padding: 2px 6px; font-size: 8px; }

  .hint { font-size: 9px; color: var(--text-dim); font-style: italic; }
</style>
