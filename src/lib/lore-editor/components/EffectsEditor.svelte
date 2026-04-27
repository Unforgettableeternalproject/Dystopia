<script lang="ts">
  /**
   * EffectsEditor — collapsible form for outcome/node effects.
   * Shows only non-empty fields with "add field" to reveal more.
   */
  import EntityPicker from './EntityPicker.svelte';

  export let data: Record<string, unknown> = {};
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  const FIELD_GROUPS = [
    { group: '旗標', fields: ['flagsSet', 'flagsUnset', 'npcFlagsSet'] },
    { group: '數值', fields: ['statChanges', 'melphinChange', 'skillExpChanges', 'characterExpGrant'] },
    { group: '物品', fields: ['grantItems'] },
    { group: '任務', fields: ['grantQuestId', 'failQuestId', 'advanceQuestStage', 'completeQuestObjective'] },
    { group: '聲望/好感', fields: ['reputationChanges', 'affinityChanges'] },
    { group: '移動/時間', fields: ['movePlayer', 'timeAdvance'] },
    { group: '狀態', fields: ['applyConditionId', 'removeConditionIds'] },
    { group: '其他', fields: ['grantIntelId', 'startEncounterId', 'eventCounterSet', 'eventCounterChanges', 'eventCounterReset'] },
  ];

  const FIELD_LABELS: Record<string, string> = {
    flagsSet: '設置旗標', flagsUnset: '取消旗標', npcFlagsSet: 'NPC 旗標 (JSON)',
    statChanges: '數值變更 (JSON)', melphinChange: '梅分變更', skillExpChanges: '技能經驗 (JSON)', characterExpGrant: '角色經驗',
    grantItems: '給予物品', grantQuestId: '給予任務', failQuestId: '失敗任務',
    advanceQuestStage: '推進任務階段 (JSON)', completeQuestObjective: '完成任務目標 (JSON)',
    reputationChanges: '聲望變更 (JSON)', affinityChanges: '好感變更 (JSON)',
    movePlayer: '移動玩家', timeAdvance: '推進時間 (分鐘)',
    applyConditionId: '施加狀態', removeConditionIds: '解除狀態',
    grantIntelId: '給予情報', startEncounterId: '啟動遭遇',
    eventCounterSet: '事件計數設置 (JSON)', eventCounterChanges: '事件計數變更 (JSON)', eventCounterReset: '事件計數重置',
  };

  const STRING_ARRAY_FIELDS = ['flagsSet', 'flagsUnset', 'removeConditionIds', 'eventCounterReset'];
  const NUMBER_FIELDS = ['melphinChange', 'characterExpGrant', 'timeAdvance'];
  const STRING_FIELDS = ['grantQuestId', 'failQuestId', 'movePlayer', 'applyConditionId', 'grantIntelId', 'startEncounterId'];
  const JSON_FIELDS = ['statChanges', 'reputationChanges', 'affinityChanges', 'npcFlagsSet', 'skillExpChanges', 'advanceQuestStage', 'completeQuestObjective', 'eventCounterSet', 'eventCounterChanges'];

  function activeFields(): string[] {
    return Object.keys(data).filter(k => data[k] !== undefined && data[k] !== null && data[k] !== '' && !k.startsWith('_'));
  }

  function inactiveFields(): string[] {
    const active = new Set(activeFields());
    const all: string[] = [];
    for (const g of FIELD_GROUPS) for (const f of g.fields) if (!active.has(f)) all.push(f);
    return all;
  }

  let showAddMenu = false;

  function addField(field: string) {
    if (STRING_ARRAY_FIELDS.includes(field)) data[field] = [];
    else if (NUMBER_FIELDS.includes(field)) data[field] = 0;
    else if (STRING_FIELDS.includes(field)) data[field] = '';
    else if (JSON_FIELDS.includes(field)) data[field] = {};
    else if (field === 'grantItems') data[field] = [];
    data = data;
    showAddMenu = false;
    onChange();
  }

  function removeField(field: string) { delete data[field]; data = data; onChange(); }

  function getArr(f: string): string[] { return (data[f] || []) as string[]; }
  function getJson(f: string): string { const v = data[f]; return (v && typeof v === 'object') ? JSON.stringify(v, null, 2) : '{}'; }
  function getGrantItems(): Record<string, string>[] { return (data.grantItems || []) as Record<string, string>[]; }
</script>

<div class="eff-wrap">
  {#each activeFields() as field (field)}
    <div class="eff-field">
      <div class="eff-field-header">
        <span class="eff-field-label">{FIELD_LABELS[field] ?? field}</span>
        <button class="eff-remove" on:click={() => removeField(field)} title="移除">✕</button>
      </div>

      {#if STRING_ARRAY_FIELDS.includes(field)}
        <div class="tag-list">
          {#each getArr(field) as tag, i}
            <div class="tag-item">
              <input class="eff-input sm" value={tag} on:input={(e) => {
                const arr = [...getArr(field)]; arr[i] = val(e); data[field] = arr; onChange();
              }} />
              <button class="tag-rm" on:click={() => { data[field] = getArr(field).filter((_t, j) => j !== i); onChange(); }}>✕</button>
            </div>
          {/each}
          <button class="tag-add" on:click={() => { data[field] = [...getArr(field), '']; onChange(); }}>+</button>
        </div>

      {:else if NUMBER_FIELDS.includes(field)}
        <input class="eff-input" type="number" value={data[field] ?? 0}
          on:input={(e) => { data[field] = parseFloat(val(e)) || 0; onChange(); }} />

      {:else if STRING_FIELDS.includes(field)}
        {#if field === 'movePlayer'}
          <EntityPicker type="location" value={String(data[field] ?? '')} placeholder="地點 ID..." />
        {:else if field === 'startEncounterId'}
          <EntityPicker type="encounter" value={String(data[field] ?? '')} placeholder="遭遇 ID..." />
        {:else if field === 'grantQuestId' || field === 'failQuestId'}
          <EntityPicker type="quest" value={String(data[field] ?? '')} placeholder="任務 ID..." />
        {:else}
          <input class="eff-input" value={data[field] ?? ''} on:input={(e) => { data[field] = val(e); onChange(); }} />
        {/if}

      {:else if JSON_FIELDS.includes(field)}
        <textarea class="eff-textarea" rows="3" value={getJson(field)}
          on:input={(e) => {
            try { data[field] = JSON.parse(val(e)); onChange(); } catch { /* ignore */ }
          }}
        ></textarea>

      {:else if field === 'grantItems'}
        {#each getGrantItems() as gi, i}
          <div class="tag-item">
            <EntityPicker type="item" value={gi.itemId ?? ''} placeholder="物品 ID..." />
            <button class="tag-rm" on:click={() => { data.grantItems = getGrantItems().filter((_g, j) => j !== i); onChange(); }}>✕</button>
          </div>
        {/each}
        <button class="tag-add" on:click={() => { data.grantItems = [...getGrantItems(), { itemId: '' }]; onChange(); }}>+ 物品</button>
      {/if}
    </div>
  {/each}

  {#if inactiveFields().length > 0}
    <div class="eff-add-wrap">
      <button class="eff-add-btn" on:click={() => { showAddMenu = !showAddMenu; }}>+ 新增效果</button>
      {#if showAddMenu}
        <div class="eff-add-menu">
          {#each FIELD_GROUPS as group}
            {#if group.fields.some(f => inactiveFields().includes(f))}
              <div class="add-group-label">{group.group}</div>
              {#each group.fields.filter(f => inactiveFields().includes(f)) as f}
                <button class="add-field-btn" on:click={() => addField(f)}>{FIELD_LABELS[f] ?? f}</button>
              {/each}
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if activeFields().length === 0}
    <div class="eff-empty">無效果</div>
  {/if}
</div>

<style>
  .eff-wrap {
    display: flex; flex-direction: column; gap: 8px;
    padding: 8px; border: 1px solid var(--border); border-radius: 2px;
    background: color-mix(in srgb, var(--bg-tertiary) 20%, transparent);
  }

  .eff-field { display: flex; flex-direction: column; gap: 4px; }
  .eff-field-header { display: flex; align-items: center; justify-content: space-between; }
  .eff-field-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; }
  .eff-remove { background: none; border: none; color: var(--text-dim); font-size: 8px; cursor: pointer; padding: 1px 3px; }
  .eff-remove:hover { color: var(--accent-red); }

  .eff-input {
    background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 10px; padding: 3px 6px; border-radius: 2px; outline: none; width: 100%;
  }
  .eff-input:focus { border-color: var(--border-accent); }
  .eff-input.sm { flex: 1; }

  .eff-textarea {
    background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 10px; padding: 4px 6px; border-radius: 2px;
    outline: none; resize: vertical; line-height: 1.5; width: 100%;
  }
  .eff-textarea:focus { border-color: var(--border-accent); }

  .tag-list { display: flex; flex-direction: column; gap: 3px; }
  .tag-item { display: flex; gap: 4px; align-items: center; }
  .tag-rm { background: none; border: none; color: var(--text-dim); font-size: 8px; cursor: pointer; padding: 1px 3px; flex-shrink: 0; }
  .tag-rm:hover { color: var(--accent-red); }
  .tag-add {
    background: none; border: 1px dashed var(--border); color: var(--text-dim);
    font-family: var(--font-mono); font-size: 9px; padding: 2px 6px; cursor: pointer;
    border-radius: 2px; align-self: flex-start; transition: color 0.1s, border-color 0.1s;
  }
  .tag-add:hover { border-color: var(--accent-dim); color: var(--accent); }

  .eff-add-wrap { position: relative; }
  .eff-add-btn {
    background: none; border: 1px dashed var(--border); color: var(--text-dim);
    font-family: var(--font-mono); font-size: 9px; padding: 3px 10px; cursor: pointer;
    border-radius: 2px; width: 100%; transition: color 0.1s, border-color 0.1s;
  }
  .eff-add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }

  .eff-add-menu {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 20;
    background: var(--bg-secondary); border: 1px solid var(--border-accent);
    border-radius: 2px; padding: 4px 0; max-height: 200px; overflow-y: auto;
  }
  .add-group-label { font-size: 8px; color: var(--text-dim); padding: 4px 8px 1px; letter-spacing: 0.08em; text-transform: uppercase; }
  .add-field-btn {
    display: block; width: 100%; background: none; border: none; color: var(--text-secondary);
    font-family: var(--font-mono); font-size: 9px; padding: 3px 12px; cursor: pointer; text-align: left; transition: background 0.06s;
  }
  .add-field-btn:hover { background: var(--bg-tertiary); }

  .eff-empty { font-size: 9px; color: var(--text-dim); font-style: italic; text-align: center; padding: 4px; }
  .eff-add-menu::-webkit-scrollbar { width: 4px; }
  .eff-add-menu::-webkit-scrollbar-track { background: var(--scrollbar-track); }
  .eff-add-menu::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }
</style>
