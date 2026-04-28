<script lang="ts">
  /**
   * QuestEditor — form editor for quest entities.
   * Structure: id, name, type, stages map, entryStageId
   */
  import EntityPicker from '../EntityPicker.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;
  function s(obj: Record<string, unknown>, key: string): string { return String(obj[key] ?? ''); }

  const QUEST_TYPES = ['main', 'side', 'hidden'];

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.name) data.name = '';
    if (!data.type) data.type = 'side';
    if (!data.entryStageId) data.entryStageId = '';
    if (!data.stages || typeof data.stages !== 'object') data.stages = {};
  }

  $: if (data) ensureDefaults();

  function getStages(): Record<string, Record<string, unknown>> { return (data.stages || {}) as Record<string, Record<string, unknown>>; }
  function stageEntries(): [string, Record<string, unknown>][] { return Object.entries(getStages()); }

  let expandedStages = new Set<string>();
  function toggleStage(sid: string) {
    if (expandedStages.has(sid)) expandedStages.delete(sid);
    else expandedStages.add(sid);
    expandedStages = expandedStages;
  }

  function addStage() {
    const stages = getStages();
    let id = 'new_stage';
    let idx = 0;
    while (id in stages) { id = `new_stage_${++idx}`; }
    stages[id] = { id, description: '', objectives: [] };
    data.stages = stages;
    expandedStages.add(id);
    expandedStages = expandedStages;
    onChange();
  }

  function removeStage(sid: string) {
    const stages = getStages();
    delete stages[sid];
    data.stages = stages;
    onChange();
  }

  function getObjectives(stage: Record<string, unknown>): Record<string, unknown>[] {
    return (stage.objectives || []) as Record<string, unknown>[];
  }

  function getOnComplete(stage: Record<string, unknown>): Record<string, unknown> {
    if (!stage.onComplete || typeof stage.onComplete !== 'object') stage.onComplete = {};
    return stage.onComplete as Record<string, unknown>;
  }

  function getOnFail(stage: Record<string, unknown>): Record<string, unknown> {
    if (!stage.onFail || typeof stage.onFail !== 'object') stage.onFail = {};
    return stage.onFail as Record<string, unknown>;
  }

  function getStringArr(obj: Record<string, unknown>, key: string): string[] {
    return (obj[key] || []) as string[];
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
    <div class="field" style="width:80px">
      <label class="field-label">類型</label>
      <select class="field-select" bind:value={data.type} on:change={onChange}>
        {#each QUEST_TYPES as t}<option value={t}>{t}</option>{/each}
      </select>
    </div>
  </div>

  <div class="field-row">
    <div class="field" style="flex:1">
      <label class="field-label">入口階段 ID</label>
      <input class="field-input" bind:value={data.entryStageId} on:input={onChange} />
    </div>
    <div class="field" style="flex:1">
      <label class="field-label">Region ID</label>
      <input class="field-input" bind:value={data.regionId} on:input={onChange} />
    </div>
  </div>

  <div class="field-row">
    <label class="field-label"><input type="checkbox" checked={!!data.autoAccept} on:change={() => { data.autoAccept = !data.autoAccept; onChange(); }} /> 自動接受</label>
    <label class="field-label"><input type="checkbox" checked={!!data.isRepeatable} on:change={() => { data.isRepeatable = !data.isRepeatable; onChange(); }} /> 可重複</label>
    <label class="field-label"><input type="checkbox" checked={data.canDitch !== false} on:change={() => { data.canDitch = data.canDitch === false; onChange(); }} /> 可放棄</label>
  </div>

  <!-- Stages -->
  <div class="section">
    <div class="section-label">階段 (Stages) · {stageEntries().length}</div>
    {#each stageEntries() as [sid, stage]}
      <div class="card">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="card-header" on:click={() => toggleStage(sid)}>
          <span class="card-arrow">{expandedStages.has(sid) ? '▼' : '▶'}</span>
          <span class="card-title">{sid}</span>
          <span class="card-desc">{s(stage, 'description').slice(0, 40)}</span>
          <button class="rm sm" on:click|stopPropagation={() => removeStage(sid)}>✕</button>
        </div>
        {#if expandedStages.has(sid)}
          <div class="card-body">
            <div class="field">
              <label class="field-label">描述</label>
              <textarea class="field-textarea sm" rows="2" value={s(stage, 'description')} on:input={(e) => { stage.description = val(e); onChange(); }}></textarea>
            </div>

            <!-- Objectives -->
            <div class="sub-label">目標</div>
            {#each getObjectives(stage) as obj, oi}
              <div class="obj-row">
                <input class="field-input sm" style="width:80px" placeholder="type" value={s(obj, 'type')} on:input={(e) => { obj.type = val(e); onChange(); }} />
                <input class="field-input sm" style="flex:1" placeholder="description" value={s(obj, 'description')} on:input={(e) => { obj.description = val(e); onChange(); }} />
                <input class="field-input sm" style="width:120px" placeholder="flag" value={s(obj, 'flag')} on:input={(e) => { obj.flag = val(e); onChange(); }} />
                <button class="rm" on:click={() => { stage.objectives = getObjectives(stage).filter((_o, j) => j !== oi); onChange(); }}>✕</button>
              </div>
            {/each}
            <button class="add-btn sm" on:click={() => { getObjectives(stage).push({ id: '', type: 'flag', description: '', flag: '' }); stage.objectives = getObjectives(stage); onChange(); }}>+ 目標</button>

            <!-- onComplete -->
            <div class="sub-label">完成時</div>
            <div class="field-row">
              <div class="field" style="flex:1">
                <label class="field-label">下一階段</label>
                <input class="field-input sm" value={s(getOnComplete(stage), 'nextStageId')} on:input={(e) => { getOnComplete(stage).nextStageId = val(e); onChange(); }} />
              </div>
            </div>
            <div class="field">
              <label class="field-label">設置旗標（逗號分隔）</label>
              <input class="field-input sm" value={getStringArr(getOnComplete(stage), 'flagsSet').join(', ')} on:input={(e) => {
                getOnComplete(stage).flagsSet = val(e).split(',').map(f => f.trim()).filter(Boolean); onChange();
              }} />
            </div>

            <!-- onFail -->
            <div class="sub-label">失敗時</div>
            <div class="field-row">
              <div class="field" style="flex:1">
                <label class="field-label">下一階段</label>
                <input class="field-input sm" value={s(getOnFail(stage), 'nextStageId')} on:input={(e) => { getOnFail(stage).nextStageId = val(e); onChange(); }} />
              </div>
              <div class="field" style="flex:1">
                <label class="field-label">啟動事件</label>
                <EntityPicker type="event" value={s(getOnFail(stage), 'startEventId')} placeholder="事件 ID..." onSelect={(id) => { getOnFail(stage).startEventId = id; onChange(); }} />
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/each}
    <button class="add-btn" on:click={addStage}>+ 新增階段</button>
  </div>
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-row { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
  .field-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; display: flex; align-items: center; gap: 4px; }
  .field-label input[type="checkbox"] { accent-color: var(--accent); }
  .field-input { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }
  .field-input:focus { border-color: var(--border-accent); }
  .field-input.sm { font-size: 10px; padding: 3px 6px; }
  .field-select { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }
  .field-textarea { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 6px 8px; border-radius: 2px; outline: none; resize: vertical; line-height: 1.6; }
  .field-textarea:focus { border-color: var(--border-accent); }
  .field-textarea.sm { font-size: 10px; padding: 4px 6px; }

  .section { display: flex; flex-direction: column; gap: 6px; }
  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }
  .sub-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; margin-top: 4px; }

  .card { border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
  .card-header { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--bg-tertiary); cursor: pointer; transition: background 0.08s; }
  .card-header:hover { background: var(--bg-secondary); }
  .card-arrow { font-size: 8px; color: var(--text-dim); flex-shrink: 0; }
  .card-title { font-size: 10px; color: var(--text-secondary); font-family: var(--font-mono); flex-shrink: 0; }
  .card-desc { font-size: 9px; color: var(--text-dim); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  .obj-row { display: flex; gap: 4px; align-items: center; }

  .rm { background: none; border: none; color: var(--text-dim); font-size: 9px; cursor: pointer; padding: 2px 4px; flex-shrink: 0; }
  .rm:hover { color: var(--accent-red); }
  .rm.sm { font-size: 8px; padding: 1px 3px; }

  .add-btn { background: none; border: 1px dashed var(--border); color: var(--text-dim); font-family: var(--font-mono); font-size: 9px; padding: 3px 8px; cursor: pointer; border-radius: 2px; transition: color 0.1s, border-color 0.1s; text-align: center; }
  .add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }
  .add-btn.sm { padding: 2px 6px; font-size: 8px; }
</style>
