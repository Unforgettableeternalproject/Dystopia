<script lang="ts">
  /**
   * DialogueEditor — form editor for dialogue profiles.
   * Structure: id, npcId, defaultContext, nodes map, triggers[], contextSnippets[]
   */
  import ConditionEditor from '../ConditionEditor.svelte';
  import EffectsEditor from '../EffectsEditor.svelte';
  import EntityPicker from '../EntityPicker.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;
  function s(obj: Record<string, unknown>, key: string): string { return String(obj[key] ?? ''); }

  function ensureDefaults() {
    if (!data.id) data.id = '';
    if (!data.npcId) data.npcId = '';
    if (!data.defaultContext) data.defaultContext = '';
    if (!data.nodes || typeof data.nodes !== 'object') data.nodes = {};
    if (!Array.isArray(data.triggers)) data.triggers = [];
    if (!Array.isArray(data.contextSnippets)) data.contextSnippets = [];
  }

  $: if (data) ensureDefaults();

  function getNodes(): Record<string, Record<string, unknown>> { return (data.nodes || {}) as Record<string, Record<string, unknown>>; }
  function nodeEntries(): [string, Record<string, unknown>][] { return Object.entries(getNodes()); }
  function getTriggers(): Record<string, unknown>[] { return (data.triggers || []) as Record<string, unknown>[]; }
  function getSnippets(): Record<string, unknown>[] { return (data.contextSnippets || []) as Record<string, unknown>[]; }
  function getChoices(node: Record<string, unknown>): Record<string, unknown>[] { return (node.choices || []) as Record<string, unknown>[]; }
  function getLines(node: Record<string, unknown>): Record<string, unknown>[] { return (node.lines || []) as Record<string, unknown>[]; }
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
    nodes[id] = { lines: [], choices: [] };
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
  <div class="field-row">
    <div class="field" style="flex:1">
      <label class="field-label">ID</label>
      <input class="field-input" bind:value={data.id} on:input={onChange} />
    </div>
    <div class="field" style="flex:1">
      <label class="field-label">NPC ID</label>
      <EntityPicker type="npc" value={String(data.npcId ?? '')} placeholder="NPC ID..." onSelect={(id) => { data.npcId = id; data = data; onChange(); }} />
    </div>
  </div>

  <div class="field">
    <label class="field-label">Default Context（LLM 角色描述）</label>
    <textarea class="field-textarea" rows="4" bind:value={data.defaultContext} on:input={onChange}></textarea>
  </div>

  <!-- Triggers -->
  <div class="section">
    <div class="section-label">觸發條件 (Triggers) · {getTriggers().length}</div>
    {#each getTriggers() as trigger, ti}
      <div class="trigger-row">
        <input class="field-input sm" style="width:100px" placeholder="nodeId" value={s(trigger, 'nodeId')} on:input={(e) => { trigger.nodeId = val(e); onChange(); }} />
        <label class="field-label sm"><input type="checkbox" checked={!!trigger.firstMeetingOnly} on:change={() => { trigger.firstMeetingOnly = !trigger.firstMeetingOnly; onChange(); }} /> 首次</label>
        <input class="field-input sm" style="width:60px" type="number" step="0.1" placeholder="prob" value={s(trigger, 'probability') || '1'} on:input={(e) => { trigger.probability = parseFloat(val(e)) || 1; onChange(); }} />
        <button class="rm" on:click={() => { data.triggers = getTriggers().filter((_t, j) => j !== ti); onChange(); }}>✕</button>
      </div>
    {/each}
    <button class="add-btn sm" on:click={() => { getTriggers().push({ nodeId: '', firstMeetingOnly: false, probability: 1 }); data.triggers = getTriggers(); onChange(); }}>+ 觸發</button>
  </div>

  <!-- Context Snippets -->
  <div class="section">
    <div class="section-label">Context Snippets · {getSnippets().length}</div>
    {#each getSnippets() as snip, si}
      <div class="snip-card">
        <div class="field-row">
          <input class="field-input sm" style="flex:1" placeholder="label" value={s(snip, 'label')} on:input={(e) => { snip.label = val(e); onChange(); }} />
          <input class="field-input sm" style="flex:1" placeholder="condition" value={s(snip, 'condition')} on:input={(e) => { snip.condition = val(e); onChange(); }} />
          <button class="rm" on:click={() => { data.contextSnippets = getSnippets().filter((_s, j) => j !== si); onChange(); }}>✕</button>
        </div>
        <textarea class="field-textarea sm" rows="2" placeholder="context" value={s(snip, 'context')} on:input={(e) => { snip.context = val(e); onChange(); }}></textarea>
      </div>
    {/each}
    <button class="add-btn sm" on:click={() => { getSnippets().push({ label: '', condition: '', context: '' }); data.contextSnippets = getSnippets(); onChange(); }}>+ Snippet</button>
  </div>

  <!-- Nodes -->
  <div class="section">
    <div class="section-label">對話節點 (Nodes) · {nodeEntries().length}</div>
    {#each nodeEntries() as [nid, node]}
      <div class="card">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="card-header" on:click={() => toggleNode(nid)}>
          <span class="card-arrow">{expandedNodes.has(nid) ? '▼' : '▶'}</span>
          <span class="card-title">{nid}</span>
          <span class="card-meta">{getLines(node).length}L · {getChoices(node).length}C</span>
          <button class="rm sm" on:click|stopPropagation={() => removeNode(nid)}>✕</button>
        </div>
        {#if expandedNodes.has(nid)}
          <div class="card-body">
            <!-- Lines -->
            <div class="sub-label">台詞</div>
            {#each getLines(node) as line, li}
              <div class="line-row">
                <input class="field-input sm" style="width:80px" placeholder="speaker" value={s(line, 'speaker')} on:input={(e) => { line.speaker = val(e); onChange(); }} />
                <input class="field-input sm" style="flex:1" placeholder="text" value={s(line, 'text')} on:input={(e) => { line.text = val(e); onChange(); }} />
                <button class="rm" on:click={() => { node.lines = getLines(node).filter((_l, j) => j !== li); onChange(); }}>✕</button>
              </div>
            {/each}
            <button class="add-btn sm" on:click={() => { getLines(node).push({ speaker: '', text: '' }); node.lines = getLines(node); onChange(); }}>+ 台詞</button>

            <!-- Choices -->
            <div class="sub-label">選項</div>
            {#each getChoices(node) as choice, ci}
              {@const choiceKey = `${nid}_${ci}`}
              <div class="choice-card">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div class="choice-header" on:click={() => toggleChoice(choiceKey)}>
                  <span class="card-arrow">{expandedChoices.has(choiceKey) ? '▼' : '▶'}</span>
                  <span class="choice-text">{s(choice, 'text') || '（空選項）'}</span>
                  <span class="choice-next">→ {s(choice, 'nextNodeId')}</span>
                  <button class="rm sm" on:click|stopPropagation={() => { node.choices = getChoices(node).filter((_c, j) => j !== ci); onChange(); }}>✕</button>
                </div>
                {#if expandedChoices.has(choiceKey)}
                  <div class="choice-body">
                    <div class="field-row">
                      <input class="field-input sm" style="width:60px" placeholder="id" value={s(choice, 'id')} on:input={(e) => { choice.id = val(e); onChange(); }} />
                      <input class="field-input sm" style="flex:1" placeholder="text" value={s(choice, 'text')} on:input={(e) => { choice.text = val(e); onChange(); }} />
                      <input class="field-input sm" style="width:100px" placeholder="nextNodeId" value={s(choice, 'nextNodeId')} on:input={(e) => { choice.nextNodeId = val(e); onChange(); }} />
                    </div>
                    {#if choice.condition !== undefined}
                      <div class="field">
                        <label class="field-label">條件（旗標表達式）
                          <button class="rm sm" on:click={() => { delete choice.condition; onChange(); }}>移除</button>
                        </label>
                        <input class="field-input sm" value={s(choice, 'condition')} on:input={(e) => { choice.condition = val(e); onChange(); }} />
                      </div>
                    {:else}
                      <button class="add-btn sm" on:click={() => { choice.condition = ''; onChange(); }}>+ 條件</button>
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
  .field-textarea { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 6px 8px; border-radius: 2px; outline: none; resize: vertical; line-height: 1.6; }
  .field-textarea:focus { border-color: var(--border-accent); }
  .field-textarea.sm { font-size: 10px; padding: 4px 6px; }

  .section { display: flex; flex-direction: column; gap: 6px; }
  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }
  .sub-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; margin-top: 4px; }

  .trigger-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .snip-card { display: flex; flex-direction: column; gap: 4px; padding: 6px; border: 1px solid var(--border); border-radius: 2px; }

  .card { border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
  .card-header { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--bg-tertiary); cursor: pointer; transition: background 0.08s; }
  .card-header:hover { background: var(--bg-secondary); }
  .card-arrow { font-size: 8px; color: var(--text-dim); flex-shrink: 0; }
  .card-title { font-size: 10px; color: var(--text-secondary); font-family: var(--font-mono); flex-shrink: 0; }
  .card-meta { font-size: 8px; color: var(--text-dim); font-family: var(--font-mono); flex: 1; }
  .card-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  .line-row { display: flex; gap: 4px; align-items: center; }

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
</style>
