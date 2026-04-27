<script lang="ts">
  /**
   * NpcEditor — form editor for NPC entities.
   * Fields: id, name, defaultLocationId, factionId, publicDescription,
   *         secretLayers[], schedule[], dialogueId, dialogueRules[], questIds[]
   */
  import EntityPicker from '../EntityPicker.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.name) data.name = '';
    if (!data.publicDescription) data.publicDescription = '';
    if (!Array.isArray(data.secretLayers)) data.secretLayers = [];
    if (!Array.isArray(data.schedule)) data.schedule = [];
    if (!Array.isArray(data.dialogueRules)) data.dialogueRules = [];
    if (!Array.isArray(data.questIds)) data.questIds = [];
  }

  $: if (data) ensureDefaults();

  function getSecrets(): Record<string, unknown>[] { return (data.secretLayers || []) as Record<string, unknown>[]; }
  function getSchedule(): Record<string, unknown>[] { return (data.schedule || []) as Record<string, unknown>[]; }
  function getDialogueRules(): Record<string, unknown>[] { return (data.dialogueRules || []) as Record<string, unknown>[]; }
  function getQuestIds(): string[] { return (data.questIds || []) as string[]; }
  function s(obj: Record<string, unknown>, key: string): string { return String(obj[key] ?? ''); }
  function n(obj: Record<string, unknown>, key: string, def = 0): number { return Number(obj[key] ?? def); }

  // Expandable sections
  let expandedSchedule = new Set<number>();
  function toggleSchedule(i: number) {
    if (expandedSchedule.has(i)) expandedSchedule.delete(i);
    else expandedSchedule.add(i);
    expandedSchedule = expandedSchedule;
  }

  let expandedSecrets = new Set<number>();
  function toggleSecret(i: number) {
    if (expandedSecrets.has(i)) expandedSecrets.delete(i);
    else expandedSecrets.add(i);
    expandedSecrets = expandedSecrets;
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

  <div class="field-row">
    <div class="field" style="flex:1">
      <label class="field-label">預設位置</label>
      <EntityPicker type="location" value={String(data.defaultLocationId ?? '')} placeholder="地點 ID..." onSelect={(id) => { data.defaultLocationId = id; data = data; onChange(); }} />
    </div>
    <div class="field" style="flex:1">
      <label class="field-label">所屬派系</label>
      <EntityPicker type="faction" value={String(data.factionId ?? '')} placeholder="派系 ID..." onSelect={(id) => { data.factionId = id; data = data; onChange(); }} />
    </div>
  </div>

  <div class="field">
    <label class="field-label">公開描述</label>
    <textarea class="field-textarea" rows="3" bind:value={data.publicDescription} on:input={onChange}></textarea>
  </div>

  <!-- Dialogue -->
  <div class="field-row">
    <div class="field" style="flex:1">
      <label class="field-label">預設對話 ID</label>
      <EntityPicker type="dialogue" value={String(data.dialogueId ?? '')} placeholder="對話 ID..." onSelect={(id) => { data.dialogueId = id; data = data; onChange(); }} />
    </div>
  </div>

  <!-- Quest IDs -->
  <div class="field">
    <label class="field-label">關聯任務</label>
    <div class="ref-list">
      {#each getQuestIds() as qid, i}
        <div class="ref-item">
          <EntityPicker type="quest" value={qid} placeholder="任務 ID..." onSelect={(id) => { getQuestIds()[i] = id; data = data; onChange(); }} />
          <button class="rm" on:click={() => { data.questIds = getQuestIds().filter((_q, j) => j !== i); onChange(); }}>✕</button>
        </div>
      {/each}
      <button class="add-btn" on:click={() => { data.questIds = [...getQuestIds(), '']; onChange(); }}>+ 任務</button>
    </div>
  </div>

  <!-- Schedule -->
  <div class="section">
    <div class="section-label">行程 (Schedule) · {getSchedule().length}</div>
    {#each getSchedule() as sched, i}
      <div class="card">
        <div class="card-header" on:click={() => toggleSchedule(i)}>
          <span class="card-arrow">{expandedSchedule.has(i) ? '▼' : '▶'}</span>
          <span class="card-title">{sched.id || sched.label || `schedule_${i}`}</span>
          <button class="rm sm" on:click|stopPropagation={() => {
            data.schedule = getSchedule().filter((_s, j) => j !== i); onChange();
          }}>✕</button>
        </div>
        {#if expandedSchedule.has(i)}
          <div class="card-body">
            <div class="field-row">
              <div class="field" style="flex:1">
                <label class="field-label">ID</label>
                <input class="field-input sm" value={s(sched, 'id')} on:input={(e) => { getSchedule()[i].id = val(e); data = data; onChange(); }} />
              </div>
              <div class="field" style="flex:1">
                <label class="field-label">標籤</label>
                <input class="field-input sm" value={s(sched, 'label')} on:input={(e) => { getSchedule()[i].label = val(e); data = data; onChange(); }} />
              </div>
            </div>
            <div class="field">
              <label class="field-label">地點</label>
              <EntityPicker type="location" value={String(sched.locationId ?? '')} placeholder="地點 ID..." onSelect={(id) => { getSchedule()[i].locationId = id; data = data; onChange(); }} />
            </div>
            <div class="field">
              <label class="field-label">時段（逗號分隔）</label>
              <input class="field-input sm" value={Array.isArray(sched.timePeriods) ? sched.timePeriods.join(', ') : ''}
                on:input={(e) => {
                  getSchedule()[i].timePeriods = val(e).split(',').map(s => s.trim()).filter(Boolean);
                  data = data; onChange();
                }} />
            </div>
            <div class="field">
              <label class="field-label">條件（旗標表達式）</label>
              <input class="field-input sm" value={s(sched, 'condition')} on:input={(e) => { getSchedule()[i].condition = val(e); data = data; onChange(); }} />
            </div>
            <div class="field">
              <label class="field-label">優先順序</label>
              <input class="field-input sm" type="number" value={n(sched, 'priority')} on:input={(e) => { getSchedule()[i].priority = parseInt(val(e)) || 0; data = data; onChange(); }} />
            </div>
          </div>
        {/if}
      </div>
    {/each}
    <button class="add-btn" on:click={() => {
      const s = getSchedule(); s.push({ id: '', label: '', locationId: '', timePeriods: [], priority: 0 });
      data.schedule = s; onChange();
    }}>+ 新增行程</button>
  </div>

  <!-- Secret Layers -->
  <div class="section">
    <div class="section-label">隱藏資訊層 · {getSecrets().length}</div>
    {#each getSecrets() as secret, i}
      <div class="card">
        <div class="card-header" on:click={() => toggleSecret(i)}>
          <span class="card-arrow">{expandedSecrets.has(i) ? '▼' : '▶'}</span>
          <span class="card-title">{secret.label || secret.id || `secret_${i}`}</span>
          <button class="rm sm" on:click|stopPropagation={() => {
            data.secretLayers = getSecrets().filter((_s, j) => j !== i); onChange();
          }}>✕</button>
        </div>
        {#if expandedSecrets.has(i)}
          <div class="card-body">
            <div class="field-row">
              <div class="field" style="flex:1">
                <label class="field-label">ID</label>
                <input class="field-input sm" value={s(secret, 'id')} on:input={(e) => { getSecrets()[i].id = val(e); data = data; onChange(); }} />
              </div>
              <div class="field" style="flex:1">
                <label class="field-label">標籤</label>
                <input class="field-input sm" value={s(secret, 'label')} on:input={(e) => { getSecrets()[i].label = val(e); data = data; onChange(); }} />
              </div>
            </div>
            <div class="field">
              <label class="field-label">揭露條件（旗標）</label>
              <input class="field-input sm" value={s(secret, 'condition')} on:input={(e) => { getSecrets()[i].condition = val(e); data = data; onChange(); }} />
            </div>
            <div class="field">
              <label class="field-label">Context（LLM 用）</label>
              <textarea class="field-textarea sm" rows="3" value={s(secret, 'context')} on:input={(e) => { getSecrets()[i].context = val(e); data = data; onChange(); }}></textarea>
            </div>
          </div>
        {/if}
      </div>
    {/each}
    <button class="add-btn" on:click={() => {
      const s = getSecrets(); s.push({ id: '', label: '', condition: '', context: '' });
      data.secretLayers = s; onChange();
    }}>+ 新增隱藏層</button>
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
  .field-textarea.sm { font-size: 10px; padding: 4px 6px; }

  .section { display: flex; flex-direction: column; gap: 6px; }
  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }

  .ref-list { display: flex; flex-direction: column; gap: 4px; }
  .ref-item { display: flex; gap: 4px; align-items: center; }

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
</style>
