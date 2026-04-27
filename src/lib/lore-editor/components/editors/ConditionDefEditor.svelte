<script lang="ts">
  /**
   * ConditionDefEditor — editor for lore/world/conditions.json
   * A map of condition ID → definition (tick effects, cure conditions, etc.)
   */
  import KeyValueEditor from '../KeyValueEditor.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;
  function s(obj: Record<string, unknown>, key: string): string { return String(obj[key] ?? ''); }
  function n(obj: Record<string, unknown>, key: string, def = 0): number { return Number(obj[key] ?? def); }

  function getConditions(): [string, Record<string, unknown>][] {
    return Object.entries(data).filter(([k]) => !k.startsWith('_')) as [string, Record<string, unknown>][];
  }

  function getTickEffect(cond: Record<string, unknown>): Record<string, unknown> {
    if (!cond.tickEffect || typeof cond.tickEffect !== 'object') cond.tickEffect = {};
    return cond.tickEffect as Record<string, unknown>;
  }

  function getStatChanges(tick: unknown): Record<string, unknown> {
    const t = tick as Record<string, unknown>;
    if (!t || !t.statChanges || typeof t.statChanges !== 'object') { if (t) t.statChanges = {}; return {}; }
    return t.statChanges as Record<string, unknown>;
  }

  function getCuredByItemIds(cond: Record<string, unknown>): string[] {
    return (cond.curedByItemIds || []) as string[];
  }

  function getCuredByRestQuality(cond: Record<string, unknown>): string[] {
    return (cond.curedByRestQuality || []) as string[];
  }

  let expandedConds = new Set<string>();
  function toggleCond(id: string) {
    if (expandedConds.has(id)) expandedConds.delete(id);
    else expandedConds.add(id);
    expandedConds = expandedConds;
  }

  function addCondition() {
    let id = 'new_condition';
    let idx = 0;
    while (id in data) { id = `new_condition_${++idx}`; }
    data[id] = { id, label: '', description: '', removeCondition: '' };
    data = data;
    expandedConds.add(id);
    expandedConds = expandedConds;
    onChange();
  }

  function removeCondition(id: string) {
    delete data[id];
    data = data;
    onChange();
  }
</script>

<div class="form">
  <div class="section-label">狀態定義 · {getConditions().length}</div>

  {#each getConditions() as [condId, cond]}
    <div class="card">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="card-header" on:click={() => toggleCond(condId)}>
        <span class="card-arrow">{expandedConds.has(condId) ? '▼' : '▶'}</span>
        <span class="card-id">{condId}</span>
        <span class="card-label">{s(cond, 'label')}</span>
        <button class="rm" on:click|stopPropagation={() => removeCondition(condId)}>✕</button>
      </div>
      {#if expandedConds.has(condId)}
        <div class="card-body">
          <div class="field-row">
            <div class="field" style="flex:1">
              <label class="field-label">ID</label>
              <input class="field-input" value={s(cond, 'id')} on:input={(e) => { cond.id = val(e); onChange(); }} />
            </div>
            <div class="field" style="flex:1">
              <label class="field-label">顯示名稱</label>
              <input class="field-input" value={s(cond, 'label')} on:input={(e) => { cond.label = val(e); onChange(); }} />
            </div>
          </div>

          <div class="field">
            <label class="field-label">描述</label>
            <textarea class="field-textarea" rows="3" value={s(cond, 'description')} on:input={(e) => { cond.description = val(e); onChange(); }}></textarea>
          </div>

          <div class="field">
            <label class="field-label">效果摘要（顯示在 UI）</label>
            <input class="field-input" value={s(cond, 'effectSummary')} on:input={(e) => { cond.effectSummary = val(e); onChange(); }} />
          </div>

          <div class="field">
            <label class="field-label">解除條件（描述文字）</label>
            <textarea class="field-textarea sm" rows="2" value={s(cond, 'removeCondition')} on:input={(e) => { cond.removeCondition = val(e); onChange(); }}></textarea>
          </div>

          <!-- Tick Effect -->
          {#if getTickEffect(cond)}
            <div class="sub-section">
              <div class="sub-label">持續效果 (Tick Effect)
                <button class="rm sm" on:click={() => { delete cond.tickEffect; onChange(); }}>移除</button>
              </div>
              <div class="field-row">
                <div class="field" style="flex:1">
                  <label class="field-label">每 N 回合</label>
                  <input class="field-input sm" type="number" value={n(getTickEffect(cond), 'everyNTurns', 1)} on:input={(e) => { getTickEffect(cond).everyNTurns = parseInt(val(e)) || 1; onChange(); }} />
                </div>
                <div class="field" style="flex:1">
                  <label class="field-label">最多幾次</label>
                  <input class="field-input sm" type="number" value={n(getTickEffect(cond), 'maxTicks', 0)} on:input={(e) => { getTickEffect(cond).maxTicks = parseInt(val(e)) || 0; onChange(); }} />
                </div>
              </div>
              <div class="field">
                <label class="field-label">數值變化</label>
                <KeyValueEditor data={getStatChanges(getTickEffect(cond))} keyPlaceholder="statusStats.stamina" valuePlaceholder="delta" onChange={onChange} />
              </div>
            </div>
          {:else}
            <button class="add-btn" on:click={() => { cond.tickEffect = { everyNTurns: 5, statChanges: {}, maxTicks: 3 }; onChange(); }}>+ 持續效果</button>
          {/if}

          <!-- Misc numeric fields -->
          {#if cond.actionTimeCostMultiplier !== undefined}
            <div class="field">
              <label class="field-label">行動時間乘數
                <button class="rm sm" on:click={() => { delete cond.actionTimeCostMultiplier; onChange(); }}>移除</button>
              </label>
              <input class="field-input sm" type="number" step="0.01" value={n(cond, 'actionTimeCostMultiplier', 1)} on:input={(e) => { cond.actionTimeCostMultiplier = parseFloat(val(e)) || 1; onChange(); }} />
            </div>
          {:else}
            <button class="add-btn sm" on:click={() => { cond.actionTimeCostMultiplier = 1.0; onChange(); }}>+ 時間乘數</button>
          {/if}

          <!-- Cure conditions -->
          <div class="field">
            <label class="field-label">可治癒物品 ID（逗號分隔）</label>
            <input class="field-input sm" value={getCuredByItemIds(cond).join(', ')}
              on:input={(e) => { cond.curedByItemIds = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
          </div>

          <div class="field">
            <label class="field-label">可治癒休息品質（逗號分隔：full / partial）</label>
            <input class="field-input sm" value={getCuredByRestQuality(cond).join(', ')}
              on:input={(e) => { cond.curedByRestQuality = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
          </div>
        </div>
      {/if}
    </div>
  {/each}

  <button class="add-btn" on:click={addCondition}>+ 新增狀態定義</button>
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-row { display: flex; gap: 12px; align-items: flex-start; }
  .field-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; display: flex; align-items: center; gap: 4px; }
  .field-input { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }
  .field-input:focus { border-color: var(--border-accent); }
  .field-input.sm { font-size: 10px; padding: 3px 6px; }
  .field-textarea { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 6px 8px; border-radius: 2px; outline: none; resize: vertical; line-height: 1.6; }
  .field-textarea:focus { border-color: var(--border-accent); }
  .field-textarea.sm { font-size: 10px; padding: 4px 6px; }

  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }
  .sub-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; display: flex; gap: 8px; align-items: center; }
  .sub-section { border: 1px solid var(--border); border-radius: 2px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  .card { border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
  .card-header { display: flex; align-items: center; gap: 6px; padding: 5px 8px; background: var(--bg-tertiary); cursor: pointer; transition: background 0.08s; }
  .card-header:hover { background: var(--bg-secondary); }
  .card-arrow { font-size: 8px; color: var(--text-dim); flex-shrink: 0; }
  .card-id { font-size: 10px; color: var(--accent); font-family: var(--font-mono); flex-shrink: 0; }
  .card-label { font-size: 10px; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }

  .rm { background: none; border: none; color: var(--text-dim); font-size: 9px; cursor: pointer; padding: 2px 4px; flex-shrink: 0; }
  .rm:hover { color: var(--accent-red); }
  .rm.sm { font-size: 8px; padding: 1px 3px; }

  .add-btn { background: none; border: 1px dashed var(--border); color: var(--text-dim); font-family: var(--font-mono); font-size: 9px; padding: 4px 10px; cursor: pointer; border-radius: 2px; transition: color 0.1s, border-color 0.1s; text-align: center; }
  .add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }
  .add-btn.sm { padding: 2px 6px; font-size: 8px; }
</style>
