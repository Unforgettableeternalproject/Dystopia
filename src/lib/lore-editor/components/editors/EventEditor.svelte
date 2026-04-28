<script lang="ts">
  /**
   * EventEditor — form editor for GameEvent entities.
   * Structure: id, locationId, description, isRepeatable, condition, outcomes[]
   */
  import ConditionEditor from '../ConditionEditor.svelte';
  import EffectsEditor from '../EffectsEditor.svelte';
  import EntityPicker from '../EntityPicker.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.description) data.description = '';
    if (data.isRepeatable === undefined) data.isRepeatable = false;
    if (!data.condition || typeof data.condition !== 'object') data.condition = {};
    if (!Array.isArray(data.outcomes)) data.outcomes = [];
  }

  $: if (data) ensureDefaults();

  function getCond(): Record<string, unknown> { return (data.condition || {}) as Record<string, unknown>; }
  function getOutcomes(): Record<string, unknown>[] { return (data.outcomes || []) as Record<string, unknown>[]; }
  /** Safely get a string field from a record (avoids TS unknown in templates). */
  function s(obj: Record<string, unknown>, key: string): string { return String(obj[key] ?? ''); }
  function n(obj: Record<string, unknown>, key: string, def = 0): number { return Number(obj[key] ?? def); }

  // locationId can be string, string[] or undefined
  function getLocationIds(): string[] {
    const loc = data.locationId;
    if (!loc) return [];
    if (typeof loc === 'string') return [loc];
    if (Array.isArray(loc)) return loc as string[];
    return [];
  }

  function setLocationIds(ids: string[]) {
    if (ids.length === 0) delete data.locationId;
    else if (ids.length === 1) data.locationId = ids[0];
    else data.locationId = ids;
    onChange();
  }

  function addOutcome() {
    const outcomes = getOutcomes();
    outcomes.push({ id: `outcome_${outcomes.length}`, description: '', weight: 1 });
    data.outcomes = outcomes;
    onChange();
  }

  function removeOutcome(i: number) {
    data.outcomes = getOutcomes().filter((_o, j) => j !== i);
    onChange();
  }

  let expandedOutcomes = new Set<number>();
  function toggleOutcome(i: number) {
    if (expandedOutcomes.has(i)) expandedOutcomes.delete(i);
    else expandedOutcomes.add(i);
    expandedOutcomes = expandedOutcomes; // trigger reactivity
  }
</script>

<div class="form">
  <!-- Basic fields -->
  <div class="field-row">
    <div class="field" style="flex:1">
      <label class="field-label">ID</label>
      <input class="field-input" bind:value={data.id} on:input={onChange} />
    </div>
    <div class="field">
      <label class="field-label">
        <input type="checkbox" checked={!!data.isRepeatable} on:change={() => { data.isRepeatable = !data.isRepeatable; onChange(); }} />
        可重複
      </label>
    </div>
  </div>

  <div class="field">
    <label class="field-label">描述（DM 用）</label>
    <textarea class="field-textarea" rows="2" bind:value={data.description} on:input={onChange}></textarea>
  </div>

  <!-- Location IDs -->
  <div class="field">
    <label class="field-label">觸發地點（空 = 全域事件）</label>
    <div class="loc-list">
      {#each getLocationIds() as locId, i}
        <div class="loc-item">
          <EntityPicker type="location" value={locId} placeholder="地點 ID..." onSelect={(id) => { const ids = getLocationIds(); ids[i] = id; setLocationIds(ids); }} />
          <button class="rm-btn" on:click={() => { const ids = getLocationIds(); ids.splice(i, 1); setLocationIds(ids); }}>✕</button>
        </div>
      {/each}
      <button class="add-btn" on:click={() => { setLocationIds([...getLocationIds(), '']); }}>+ 新增地點</button>
    </div>
  </div>

  <!-- Condition -->
  <div class="section">
    <div class="section-label">觸發條件</div>
    <ConditionEditor data={getCond()} onChange={() => { data.condition = getCond(); onChange(); }} />
  </div>

  <!-- Outcomes -->
  <div class="section">
    <div class="section-label">結果（Outcomes）· {getOutcomes().length}</div>
    {#each getOutcomes() as outcome, i}
      <div class="outcome-card">
        <div class="outcome-header" on:click={() => toggleOutcome(i)}>
          <span class="outcome-arrow">{expandedOutcomes.has(i) ? '▼' : '▶'}</span>
          <span class="outcome-id">{outcome.id || `outcome_${i}`}</span>
          {#if outcome.weight}
            <span class="outcome-weight">w:{outcome.weight}</span>
          {/if}
          <button class="rm-btn sm" on:click|stopPropagation={() => removeOutcome(i)}>✕</button>
        </div>

        {#if expandedOutcomes.has(i)}
          <div class="outcome-body">
            <div class="field-row">
              <div class="field" style="flex:1">
                <label class="field-label">ID</label>
                <input class="field-input sm" value={s(outcome, 'id')} on:input={(e) => {
                  getOutcomes()[i].id = val(e); data.outcomes = getOutcomes(); onChange();
                }} />
              </div>
              <div class="field" style="width:60px">
                <label class="field-label">權重</label>
                <input class="field-input sm" type="number" value={n(outcome, 'weight', 1)} on:input={(e) => {
                  getOutcomes()[i].weight = parseFloat(val(e)) || 1; data.outcomes = getOutcomes(); onChange();
                }} />
              </div>
            </div>

            <div class="field">
              <label class="field-label">描述</label>
              <textarea class="field-textarea sm" rows="2" value={s(outcome, 'description')} on:input={(e) => {
                getOutcomes()[i].description = val(e); data.outcomes = getOutcomes(); onChange();
              }}></textarea>
            </div>

            {#if outcome.condition !== undefined}
              <div class="field">
                <label class="field-label">Outcome 條件（旗標字串）
                  <button class="rm-btn sm" on:click={() => { delete getOutcomes()[i].condition; data.outcomes = getOutcomes(); onChange(); }}>移除</button>
                </label>
                <input class="field-input sm" value={s(outcome, 'condition')} on:input={(e) => {
                  getOutcomes()[i].condition = val(e); data.outcomes = getOutcomes(); onChange();
                }} />
              </div>
            {:else}
              <button class="add-btn" on:click={() => {
                getOutcomes()[i].condition = ''; data.outcomes = getOutcomes(); onChange();
              }}>+ Outcome 條件</button>
            {/if}

            <div class="sub-label">效果</div>
            <EffectsEditor data={outcome} onChange={() => { data.outcomes = getOutcomes(); onChange(); }} />
          </div>
        {/if}
      </div>
    {/each}
    <button class="add-btn" on:click={addOutcome}>+ 新增 Outcome</button>
  </div>
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-row { display: flex; gap: 12px; align-items: flex-start; }
  .field-label {
    font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase;
    display: flex; align-items: center; gap: 4px;
  }
  .field-label input[type="checkbox"] { accent-color: var(--accent); }
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

  .section { display: flex; flex-direction: column; gap: 8px; }
  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }
  .sub-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; margin-top: 4px; }

  .loc-list { display: flex; flex-direction: column; gap: 4px; }
  .loc-item { display: flex; gap: 4px; align-items: center; }

  .outcome-card {
    border: 1px solid var(--border); border-radius: 2px; overflow: hidden;
  }
  .outcome-header {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    background: var(--bg-tertiary); cursor: pointer; transition: background 0.08s;
  }
  .outcome-header:hover { background: var(--bg-secondary); }
  .outcome-arrow { font-size: 8px; color: var(--text-dim); flex-shrink: 0; }
  .outcome-id { font-size: 10px; color: var(--text-secondary); font-family: var(--font-mono); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .outcome-weight { font-size: 8px; color: var(--text-dim); font-family: var(--font-mono); flex-shrink: 0; }
  .outcome-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; }

  .rm-btn {
    background: none; border: none; color: var(--text-dim); font-size: 9px; cursor: pointer; padding: 2px 4px; flex-shrink: 0;
  }
  .rm-btn:hover { color: var(--accent-red); }
  .rm-btn.sm { font-size: 8px; padding: 1px 3px; }

  .add-btn {
    background: none; border: 1px dashed var(--border); color: var(--text-dim);
    font-family: var(--font-mono); font-size: 9px; padding: 4px 10px; cursor: pointer;
    border-radius: 2px; transition: color 0.1s, border-color 0.1s; text-align: center;
  }
  .add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }
</style>
