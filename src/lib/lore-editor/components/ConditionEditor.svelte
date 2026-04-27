<script lang="ts">
  /**
   * ConditionEditor — collapsible form for event/encounter/dialogue trigger conditions.
   * Only shows non-empty fields. "Add field" button reveals hidden fields.
   */
  import EntityPicker from './EntityPicker.svelte';
  import ArrayEditor from './ArrayEditor.svelte';

  export let data: Record<string, unknown> = {};
  export let onChange: () => void = () => {};
  export let compact: boolean = false;

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  // All possible condition fields, grouped
  const FIELD_GROUPS = [
    { group: '旗標', fields: ['flags', 'anyFlags', 'notFlags'] },
    { group: '時間', fields: ['timePeriods', 'timeRanges', 'triggerHours', 'cooldownMinutes', 'triggerOn'] },
    { group: '任務', fields: ['questActiveId', 'questStageId'] },
    { group: '物品', fields: ['itemRequirements', 'notItemIds'] },
    { group: '地點', fields: ['npcIds', 'notLocationIds'] },
    { group: '數值', fields: ['minStats', 'minMelphin', 'triggerChance'] },
    { group: '聲望/好感', fields: ['minReputation', 'maxReputation', 'minAffinity', 'maxAffinity'] },
  ];

  const FIELD_LABELS: Record<string, string> = {
    flags: '必須旗標 (AND)',
    anyFlags: '任一旗標 (OR)',
    notFlags: '排除旗標 (NOT)',
    timePeriods: '時段',
    timeRanges: '時間範圍 (JSON)',
    triggerHours: '觸發整點',
    cooldownMinutes: '冷卻 (分鐘)',
    triggerOn: '觸發時機',
    questActiveId: '任務進行中',
    questStageId: '任務階段',
    itemRequirements: '需持有物品',
    notItemIds: '排除物品',
    npcIds: '需 NPC 在場',
    notLocationIds: '排除地點',
    minStats: '最低數值 (JSON)',
    minMelphin: '最低梅分',
    triggerChance: '觸發機率 (0-1)',
    minReputation: '聲望下限 (JSON)',
    maxReputation: '聲望上限 (JSON)',
    minAffinity: '���感下限 (JSON)',
    maxAffinity: '好感上限 (JSON)',
  };

  // Fields that are string arrays
  const STRING_ARRAY_FIELDS = ['flags', 'anyFlags', 'notFlags', 'timePeriods', 'triggerHours', 'notItemIds', 'notLocationIds', 'npcIds'];
  // Fields that are numbers
  const NUMBER_FIELDS = ['cooldownMinutes', 'minMelphin', 'triggerChance'];
  // Fields that are single strings
  const STRING_FIELDS = ['questActiveId', 'questStageId', 'triggerOn'];
  // Fields that are JSON objects
  const JSON_FIELDS = ['minStats', 'timeRanges', 'minReputation', 'maxReputation', 'minAffinity', 'maxAffinity'];
  // Fields that are item requirement arrays (special)
  const ITEM_REQ_FIELD = 'itemRequirements';

  function activeFields(): string[] {
    return Object.keys(data).filter(k => data[k] !== undefined && data[k] !== null && data[k] !== '' && !k.startsWith('_'));
  }

  function inactiveFields(): string[] {
    const active = new Set(activeFields());
    const all: string[] = [];
    for (const g of FIELD_GROUPS) {
      for (const f of g.fields) {
        if (!active.has(f)) all.push(f);
      }
    }
    return all;
  }

  let showAddMenu = false;

  function addField(field: string) {
    if (STRING_ARRAY_FIELDS.includes(field)) data[field] = [];
    else if (NUMBER_FIELDS.includes(field)) data[field] = 0;
    else if (STRING_FIELDS.includes(field)) data[field] = '';
    else if (JSON_FIELDS.includes(field)) data[field] = {};
    else if (field === ITEM_REQ_FIELD) data[field] = [];
    data = data; // trigger reactivity
    showAddMenu = false;
    onChange();
  }

  function removeField(field: string) {
    delete data[field];
    data = data;
    onChange();
  }

  function getArr(field: string): string[] { return (data[field] || []) as string[]; }
  function getJson(field: string): string {
    const v = data[field];
    return (v && typeof v === 'object') ? JSON.stringify(v, null, 2) : '{}';
  }
  function getItemReqs(): Record<string, string>[] { return (data[ITEM_REQ_FIELD] || []) as Record<string, string>[]; }
</script>

<div class="cond-wrap" class:compact>
  {#each activeFields() as field (field)}
    <div class="cond-field">
      <div class="cond-field-header">
        <span class="cond-field-label">{FIELD_LABELS[field] ?? field}</span>
        <button class="cond-remove" on:click={() => removeField(field)} title="移除此條件">✕</button>
      </div>

      {#if STRING_ARRAY_FIELDS.includes(field)}
        <div class="tag-list">
          {#each getArr(field) as tag, i}
            <div class="tag-item">
              <input class="cond-input sm" value={tag} on:input={(e) => {
                const arr = [...getArr(field)]; arr[i] = val(e); data[field] = arr; onChange();
              }} />
              <button class="tag-remove" on:click={() => {
                data[field] = getArr(field).filter((_t, j) => j !== i); onChange();
              }}>✕</button>
            </div>
          {/each}
          <button class="tag-add" on:click={() => { data[field] = [...getArr(field), '']; onChange(); }}>+</button>
        </div>

      {:else if NUMBER_FIELDS.includes(field)}
        <input class="cond-input" type="number" step={field === 'triggerChance' ? '0.1' : '1'}
          value={data[field] ?? 0}
          on:input={(e) => { data[field] = parseFloat(val(e)) || 0; onChange(); }}
        />

      {:else if STRING_FIELDS.includes(field)}
        {#if field === 'questActiveId' || field === 'questStageId'}
          <input class="cond-input" value={data[field] ?? ''} on:input={(e) => { data[field] = val(e); onChange(); }} />
        {:else if field === 'triggerOn'}
          <select class="cond-select" value={data[field] ?? ''} on:change={(e) => { data[field] = val(e); onChange(); }}>
            <option value="">（預設）</option>
            <option value="rest_start">rest_start</option>
          </select>
        {:else}
          <input class="cond-input" value={data[field] ?? ''} on:input={(e) => { data[field] = val(e); onChange(); }} />
        {/if}

      {:else if JSON_FIELDS.includes(field)}
        <textarea class="cond-textarea" rows="3" value={getJson(field)}
          on:input={(e) => {
            try { data[field] = JSON.parse(val(e)); onChange(); } catch { /* ignore */ }
          }}
        ></textarea>

      {:else if field === ITEM_REQ_FIELD}
        {#each getItemReqs() as req, i}
          <div class="tag-item">
            <EntityPicker type="item" value={req.itemId ?? ''} placeholder="物品 ID..." />
            <button class="tag-remove" on:click={() => {
              data[field] = getItemReqs().filter((_r, j) => j !== i); onChange();
            }}>✕</button>
          </div>
        {/each}
        <button class="tag-add" on:click={() => { data[field] = [...getItemReqs(), { itemId: '' }]; onChange(); }}>+ 物品</button>
      {/if}
    </div>
  {/each}

  <!-- Add field button -->
  {#if inactiveFields().length > 0}
    <div class="cond-add-wrap">
      <button class="cond-add-btn" on:click={() => { showAddMenu = !showAddMenu; }}>
        + 新增條件
      </button>
      {#if showAddMenu}
        <div class="cond-add-menu">
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
    <div class="cond-empty">無觸發條件（永遠觸發）</div>
  {/if}
</div>

<style>
  .cond-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: color-mix(in srgb, var(--bg-tertiary) 30%, transparent);
  }

  .cond-wrap.compact { padding: 4px 6px; gap: 4px; }

  .cond-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cond-field-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .cond-field-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.06em;
  }

  .cond-remove {
    background: none; border: none; color: var(--text-dim); font-size: 8px; cursor: pointer; padding: 1px 3px;
  }
  .cond-remove:hover { color: var(--accent-red); }

  .cond-input {
    background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 10px; padding: 3px 6px; border-radius: 2px; outline: none; width: 100%;
  }
  .cond-input:focus { border-color: var(--border-accent); }
  .cond-input.sm { flex: 1; }

  .cond-select {
    background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 10px; padding: 3px 6px; border-radius: 2px; outline: none;
  }

  .cond-textarea {
    background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 10px; padding: 4px 6px; border-radius: 2px; outline: none;
    resize: vertical; line-height: 1.5; width: 100%;
  }
  .cond-textarea:focus { border-color: var(--border-accent); }

  .tag-list { display: flex; flex-direction: column; gap: 3px; }
  .tag-item { display: flex; gap: 4px; align-items: center; }
  .tag-remove { background: none; border: none; color: var(--text-dim); font-size: 8px; cursor: pointer; padding: 1px 3px; flex-shrink: 0; }
  .tag-remove:hover { color: var(--accent-red); }
  .tag-add {
    background: none; border: 1px dashed var(--border); color: var(--text-dim);
    font-family: var(--font-mono); font-size: 9px; padding: 2px 6px; cursor: pointer;
    border-radius: 2px; align-self: flex-start; transition: color 0.1s, border-color 0.1s;
  }
  .tag-add:hover { border-color: var(--accent-dim); color: var(--accent); }

  .cond-add-wrap { position: relative; }
  .cond-add-btn {
    background: none; border: 1px dashed var(--border); color: var(--text-dim);
    font-family: var(--font-mono); font-size: 9px; padding: 3px 10px; cursor: pointer;
    border-radius: 2px; width: 100%; transition: color 0.1s, border-color 0.1s;
  }
  .cond-add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }

  .cond-add-menu {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 20;
    background: var(--bg-secondary); border: 1px solid var(--border-accent);
    border-radius: 2px; padding: 4px 0; max-height: 200px; overflow-y: auto;
  }

  .add-group-label {
    font-size: 8px; color: var(--text-dim); padding: 4px 8px 1px; letter-spacing: 0.08em; text-transform: uppercase;
  }

  .add-field-btn {
    display: block; width: 100%; background: none; border: none; color: var(--text-secondary);
    font-family: var(--font-mono); font-size: 9px; padding: 3px 12px; cursor: pointer;
    text-align: left; transition: background 0.06s;
  }
  .add-field-btn:hover { background: var(--bg-tertiary); }

  .cond-empty {
    font-size: 9px; color: var(--text-dim); font-style: italic; text-align: center; padding: 4px;
  }

  .cond-add-menu::-webkit-scrollbar { width: 4px; }
  .cond-add-menu::-webkit-scrollbar-track { background: var(--scrollbar-track); }
  .cond-add-menu::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }
</style>
