<script lang="ts">
  /**
   * EncounterEditor — form editor for encounter entities.
   * Handles story type (script[]) and event type (nodes map with choices).
   */
  import ConditionEditor from '../ConditionEditor.svelte';
  import EffectsEditor from '../EffectsEditor.svelte';
  import EntityPicker from '../EntityPicker.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;
  function s(obj: Record<string, unknown>, key: string): string { return String(obj[key] ?? ''); }
  function n(obj: Record<string, unknown>, key: string, def = 0): number { return Number(obj[key] ?? def); }

  const ENC_TYPES = ['story', 'event', 'dialogue', 'combat', 'shop'];

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.name) data.name = '';
    if (!data.type) data.type = 'event';
    if (!data.description) data.description = '';
  }

  $: if (data) ensureDefaults();
  $: encType = String(data.type ?? 'event');

  // ── Story helpers ──
  function getScript(): Record<string, unknown>[] { return (data.script || []) as Record<string, unknown>[]; }
  function getResult(): Record<string, unknown> {
    if (!data.result || typeof data.result !== 'object') data.result = {};
    return data.result as Record<string, unknown>;
  }
  function getResultEffects(): Record<string, unknown> {
    const r = getResult();
    if (!r.effects || typeof r.effects !== 'object') r.effects = {};
    return r.effects as Record<string, unknown>;
  }

  // ── Event helpers ──
  function getNodes(): Record<string, Record<string, unknown>> { return (data.nodes || {}) as Record<string, Record<string, unknown>>; }
  function nodeEntries(): [string, Record<string, unknown>][] { return Object.entries(getNodes()); }
  function getChoices(node: Record<string, unknown>): Record<string, unknown>[] { return (node.choices || []) as Record<string, unknown>[]; }
  function getStatCheck(node: Record<string, unknown>): Record<string, unknown> | null {
    return (node.statCheck && typeof node.statCheck === 'object') ? node.statCheck as Record<string, unknown> : null;
  }
  function getEffects(node: Record<string, unknown>): Record<string, unknown> | null {
    return (node.effects && typeof node.effects === 'object') ? node.effects as Record<string, unknown> : null;
  }
  /** Safe cast for EffectsEditor data prop. */
  function asRec(obj: unknown): Record<string, unknown> { return (obj && typeof obj === 'object') ? obj as Record<string, unknown> : {}; }

  let expandedNodes = new Set<string>();
  function toggleNode(nid: string) {
    if (expandedNodes.has(nid)) expandedNodes.delete(nid);
    else expandedNodes.add(nid);
    expandedNodes = expandedNodes;
  }

  let expandedChoices = new Set<string>();
  function toggleChoice(key: string) {
    if (expandedChoices.has(key)) expandedChoices.delete(key);
    else expandedChoices.add(key);
    expandedChoices = expandedChoices;
  }

  function addNode() {
    const nodes = getNodes();
    let id = 'new_node';
    let idx = 0;
    while (id in nodes) { id = `new_node_${++idx}`; }
    nodes[id] = { id, dmNarrative: '', choices: [] };
    data.nodes = nodes;
    expandedNodes.add(id);
    expandedNodes = expandedNodes;
    onChange();
  }

  function removeNode(nid: string) {
    const nodes = getNodes();
    delete nodes[nid];
    data.nodes = nodes;
    onChange();
  }
</script>

<div class="form">
  <!-- Basic -->
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
        {#each ENC_TYPES as t}<option value={t}>{t}</option>{/each}
      </select>
    </div>
  </div>

  <div class="field">
    <label class="field-label">描述（DM 用）</label>
    <textarea class="field-textarea" rows="2" bind:value={data.description} on:input={onChange}></textarea>
  </div>

  <!-- ═══ Story type ═══ -->
  {#if encType === 'story'}
    <div class="section">
      <div class="section-label">劇情腳本 (Script) · {getScript().length}</div>
      {#each getScript() as line, li}
        <div class="script-line">
          <div class="line-head">
            <input class="field-input sm" style="width:80px" placeholder="speaker" value={s(line, 'speaker')} on:input={(e) => { line.speaker = val(e); onChange(); }} />
            <label class="field-label sm"><input type="checkbox" checked={!!line.pause} on:change={() => { line.pause = !line.pause; onChange(); }} /> pause</label>
            <button class="rm" on:click={() => { data.script = getScript().filter((_l, j) => j !== li); onChange(); }}>✕</button>
          </div>
          <textarea class="field-textarea sm" rows="1" placeholder="text" value={s(line, 'text')} on:input={(e) => { line.text = val(e); onChange(); }}></textarea>
          {#if line.effects && typeof line.effects === 'object'}
            <div class="sub-label">效果</div>
            <EffectsEditor data={asRec(line.effects)} onChange={onChange} />
          {:else}
            <button class="add-btn sm" on:click={() => { line.effects = {}; onChange(); }}>+ 效果</button>
          {/if}
        </div>
      {/each}
      <button class="add-btn" on:click={() => { getScript().push({ speaker: 'narrator', text: '' }); data.script = getScript(); onChange(); }}>+ 腳本行</button>
    </div>

    <!-- Result -->
    <div class="section">
      <div class="section-label">Result</div>
      <div class="field">
        <label class="field-label">outcomeType</label>
        <select class="field-select sm" value={s(getResult(), 'outcomeType') || 'neutral'} on:change={(e) => { getResult().outcomeType = val(e); onChange(); }}>
          <option value="neutral">neutral</option>
          <option value="success">success</option>
          <option value="failure">failure</option>
        </select>
      </div>
      <div class="sub-label">效果</div>
      <EffectsEditor data={getResultEffects()} onChange={onChange} />
    </div>

  <!-- ═══ Event type ═══ -->
  {:else if encType === 'event'}
    <div class="field">
      <label class="field-label">入口節點 ID</label>
      <input class="field-input" bind:value={data.entryNodeId} on:input={onChange} />
    </div>

    <div class="section">
      <div class="section-label">節點 (Nodes) · {nodeEntries().length}</div>
      {#each nodeEntries() as [nid, node]}
        <div class="card">
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="card-header" on:click={() => toggleNode(nid)}>
            <span class="card-arrow">{expandedNodes.has(nid) ? '▼' : '▶'}</span>
            <span class="card-title">{nid}</span>
            {#if node.isOutcome}<span class="badge outcome">outcome:{s(node, 'outcomeType')}</span>{/if}
            {#if getStatCheck(node)}<span class="badge check">判定</span>{/if}
            <span class="card-meta">{getChoices(node).length}C</span>
            <button class="rm sm" on:click|stopPropagation={() => removeNode(nid)}>✕</button>
          </div>
          {#if expandedNodes.has(nid)}
            <div class="card-body">
              <div class="field">
                <label class="field-label">DM Narrative</label>
                <textarea class="field-textarea sm" rows="2" value={s(node, 'dmNarrative')} on:input={(e) => { node.dmNarrative = val(e); onChange(); }}></textarea>
              </div>
              <div class="field">
                <label class="field-label">Display Text</label>
                <input class="field-input sm" value={s(node, 'displayText')} on:input={(e) => { node.displayText = val(e); onChange(); }} />
              </div>

              <div class="field-row">
                <label class="field-label"><input type="checkbox" checked={!!node.isOutcome} on:change={() => { node.isOutcome = !node.isOutcome; onChange(); }} /> 結局節點</label>
                {#if node.isOutcome}
                  <select class="field-select sm" value={s(node, 'outcomeType') || 'neutral'} on:change={(e) => { node.outcomeType = val(e); onChange(); }}>
                    <option value="neutral">neutral</option>
                    <option value="success">success</option>
                    <option value="failure">failure</option>
                  </select>
                {/if}
              </div>

              <!-- Stat Check -->
              {#if getStatCheck(node)}
                <div class="sub-section">
                  <div class="sub-label">數值判定
                    <button class="rm sm" on:click={() => { delete node.statCheck; onChange(); }}>移除</button>
                  </div>
                  <div class="field-row">
                    <input class="field-input sm" style="flex:1" placeholder="stat path" value={s(asRec(node.statCheck), 'stat')} on:input={(e) => { asRec(node.statCheck).stat = val(e); onChange(); }} />
                    <input class="field-input sm" style="width:50px" type="number" placeholder="DC" value={n(asRec(node.statCheck), 'dc')} on:input={(e) => { asRec(node.statCheck).dc = parseInt(val(e)) || 0; onChange(); }} />
                  </div>
                  <div class="field-row">
                    <input class="field-input sm" style="flex:1" placeholder="successNodeId" value={s(asRec(node.statCheck), 'successNodeId')} on:input={(e) => { asRec(node.statCheck).successNodeId = val(e); onChange(); }} />
                    <input class="field-input sm" style="flex:1" placeholder="failNodeId" value={s(asRec(node.statCheck), 'failNodeId')} on:input={(e) => { asRec(node.statCheck).failNodeId = val(e); onChange(); }} />
                  </div>
                </div>
              {:else}
                <button class="add-btn sm" on:click={() => { node.statCheck = { stat: '', dc: 10, successNodeId: '', failNodeId: '' }; onChange(); }}>+ 數值判定</button>
              {/if}

              <!-- Effects -->
              {#if getEffects(node)}
                <div class="sub-label">效果</div>
                <EffectsEditor data={asRec(getEffects(node))} onChange={onChange} />
              {:else if node.isOutcome}
                <button class="add-btn sm" on:click={() => { node.effects = {}; onChange(); }}>+ 效果</button>
              {/if}

              <!-- Choices -->
              <div class="sub-label">選項 · {getChoices(node).length}</div>
              {#each getChoices(node) as choice, ci}
                {@const ck = `${nid}_${ci}`}
                <div class="choice-card">
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <!-- svelte-ignore a11y-no-static-element-interactions -->
                  <div class="choice-header" on:click={() => toggleChoice(ck)}>
                    <span class="card-arrow">{expandedChoices.has(ck) ? '▼' : '▶'}</span>
                    <span class="choice-text">{s(choice, 'text') || '（空）'}</span>
                    <span class="choice-next">→ {s(choice, 'nextNodeId')}</span>
                    <button class="rm sm" on:click|stopPropagation={() => { node.choices = getChoices(node).filter((_c, j) => j !== ci); onChange(); }}>✕</button>
                  </div>
                  {#if expandedChoices.has(ck)}
                    <div class="choice-body">
                      <div class="field-row">
                        <input class="field-input sm" style="width:50px" placeholder="id" value={s(choice, 'id')} on:input={(e) => { choice.id = val(e); onChange(); }} />
                        <input class="field-input sm" style="flex:1" placeholder="text" value={s(choice, 'text')} on:input={(e) => { choice.text = val(e); onChange(); }} />
                        <input class="field-input sm" style="width:100px" placeholder="nextNodeId" value={s(choice, 'nextNodeId')} on:input={(e) => { choice.nextNodeId = val(e); onChange(); }} />
                      </div>
                      {#if choice.condition !== undefined}
                        <div class="field">
                          <label class="field-label">條件
                            <button class="rm sm" on:click={() => { delete choice.condition; onChange(); }}>移除</button>
                          </label>
                          <input class="field-input sm" value={s(choice, 'condition')} on:input={(e) => { choice.condition = val(e); onChange(); }} />
                        </div>
                      {:else}
                        <button class="add-btn sm" on:click={() => { choice.condition = ''; onChange(); }}>+ 條件</button>
                      {/if}
                      {#if choice.minMelphin !== undefined}
                        <div class="field">
                          <label class="field-label">最低梅分
                            <button class="rm sm" on:click={() => { delete choice.minMelphin; onChange(); }}>移除</button>
                          </label>
                          <input class="field-input sm" type="number" value={n(choice, 'minMelphin')} on:input={(e) => { choice.minMelphin = parseInt(val(e)) || 0; onChange(); }} />
                        </div>
                      {:else}
                        <button class="add-btn sm" on:click={() => { choice.minMelphin = 0; onChange(); }}>+ 梅分門檻</button>
                      {/if}
                      {#if choice.effects && typeof choice.effects === 'object'}
                        <div class="sub-label">效果
                          <button class="rm sm" on:click={() => { delete choice.effects; onChange(); }}>移除</button>
                        </div>
                        <EffectsEditor data={asRec(choice.effects)} onChange={onChange} />
                      {:else}
                        <button class="add-btn sm" on:click={() => { choice.effects = {}; onChange(); }}>+ 效果</button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
              <button class="add-btn sm" on:click={() => { getChoices(node).push({ id: '', text: '', nextNodeId: '' }); node.choices = getChoices(node); onChange(); }}>+ 選項</button>
            </div>
          {/if}
        </div>
      {/each}
      <button class="add-btn" on:click={addNode}>+ 新增節點</button>
    </div>

  {:else}
    <div class="hint">此遭遇類型（{encType}）的編輯器尚未實作，請使用 JSON 模式。</div>
  {/if}
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-row { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
  .field-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; display: flex; align-items: center; gap: 4px; }
  .field-label.sm { font-size: 8px; }
  .field-label input[type="checkbox"] { accent-color: var(--accent); }
  .field-input { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }
  .field-input:focus { border-color: var(--border-accent); }
  .field-input.sm { font-size: 10px; padding: 3px 6px; }
  .field-select { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }
  .field-select.sm { font-size: 10px; padding: 3px 6px; }
  .field-textarea { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 6px 8px; border-radius: 2px; outline: none; resize: vertical; line-height: 1.6; }
  .field-textarea:focus { border-color: var(--border-accent); }
  .field-textarea.sm { font-size: 10px; padding: 4px 6px; }

  .section { display: flex; flex-direction: column; gap: 6px; }
  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }
  .sub-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; margin-top: 4px; display: flex; gap: 8px; align-items: center; }
  .sub-section { border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }

  .script-line { border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
  .line-head { display: flex; gap: 6px; align-items: center; }

  .card { border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
  .card-header { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--bg-tertiary); cursor: pointer; transition: background 0.08s; }
  .card-header:hover { background: var(--bg-secondary); }
  .card-arrow { font-size: 8px; color: var(--text-dim); flex-shrink: 0; }
  .card-title { font-size: 10px; color: var(--text-secondary); font-family: var(--font-mono); flex-shrink: 0; }
  .card-meta { font-size: 8px; color: var(--text-dim); font-family: var(--font-mono); flex: 1; text-align: right; }
  .card-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  .badge { font-size: 7px; padding: 1px 4px; border-radius: 2px; letter-spacing: 0.04em; flex-shrink: 0; }
  .badge.outcome { color: var(--accent); border: 1px solid var(--accent-dim); }
  .badge.check { color: var(--accent-blue); border: 1px solid var(--accent-blue); }

  .choice-card { border: 1px solid var(--border); border-radius: 2px; margin-left: 8px; overflow: hidden; }
  .choice-header { display: flex; align-items: center; gap: 6px; padding: 3px 6px; background: color-mix(in srgb, var(--bg-tertiary) 60%, transparent); cursor: pointer; }
  .choice-header:hover { background: var(--bg-tertiary); }
  .choice-text { font-size: 9px; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .choice-next { font-size: 8px; color: var(--text-dim); font-family: var(--font-mono); flex-shrink: 0; }
  .choice-body { padding: 6px; display: flex; flex-direction: column; gap: 6px; }

  .rm { background: none; border: none; color: var(--text-dim); font-size: 9px; cursor: pointer; padding: 2px 4px; flex-shrink: 0; }
  .rm:hover { color: var(--accent-red); }
  .rm.sm { font-size: 8px; padding: 1px 3px; }

  .add-btn { background: none; border: 1px dashed var(--border); color: var(--text-dim); font-family: var(--font-mono); font-size: 9px; padding: 3px 8px; cursor: pointer; border-radius: 2px; transition: color 0.1s, border-color 0.1s; text-align: center; }
  .add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }
  .add-btn.sm { padding: 2px 6px; font-size: 8px; }

  .hint { font-size: 10px; color: var(--text-dim); font-style: italic; padding: 20px; text-align: center; }
</style>
