<script lang="ts">
  /**
   * FlagEditor — form editor for flag manifest files.
   * Data is an ARRAY of FlagManifestEntry, not an object.
   * We wrap it: data.__flags = the array.
   */
  import EntityPicker from '../EntityPicker.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;
  function s(obj: Record<string, unknown>, key: string): string { return String(obj[key] ?? ''); }

  // Flag files are arrays at root. The editor shell parses JSON into formData.
  // If the file is an array, formData = { __isArray: true, __items: [...] }
  // But our current shell doesn't do that — formData would be the parsed object.
  // Since flag files ARE arrays, we need to handle both cases.
  function getFlags(): Record<string, unknown>[] {
    if (data.__isArray && Array.isArray(data.__items)) return data.__items as Record<string, unknown>[];
    if (Array.isArray(data)) return data as unknown as Record<string, unknown>[];
    return [];
  }

  function addFlag() {
    const flags = getFlags();
    flags.push({ flagId: '', description: '', setCondition: '', proximity: {} });
    data.__items = flags;
    onChange();
  }

  function removeFlag(i: number) {
    data.__items = getFlags().filter((_f, j) => j !== i);
    onChange();
  }

  function getProximity(flag: Record<string, unknown>): Record<string, unknown> {
    if (!flag.proximity || typeof flag.proximity !== 'object') flag.proximity = {};
    return flag.proximity as Record<string, unknown>;
  }

  function getStringArr(obj: Record<string, unknown>, key: string): string[] {
    return (obj[key] || []) as string[];
  }

  let expandedFlags = new Set<number>();
  function toggleFlag(i: number) {
    if (expandedFlags.has(i)) expandedFlags.delete(i);
    else expandedFlags.add(i);
    expandedFlags = expandedFlags;
  }
</script>

<div class="form">
  <div class="section-label">旗標清單 · {getFlags().length}</div>

  {#each getFlags() as flag, i}
    <div class="card">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="card-header" on:click={() => toggleFlag(i)}>
        <span class="card-arrow">{expandedFlags.has(i) ? '▼' : '▶'}</span>
        <span class="card-title">{s(flag, 'flagId')}</span>
        <span class="card-desc">{s(flag, 'description').slice(0, 50)}</span>
        <button class="rm sm" on:click|stopPropagation={() => removeFlag(i)}>✕</button>
      </div>
      {#if expandedFlags.has(i)}
        <div class="card-body">
          <div class="field">
            <label class="field-label">Flag ID</label>
            <input class="field-input" value={s(flag, 'flagId')} on:input={(e) => { flag.flagId = val(e); onChange(); }} />
          </div>
          <div class="field">
            <label class="field-label">描述</label>
            <textarea class="field-textarea sm" rows="2" value={s(flag, 'description')} on:input={(e) => { flag.description = val(e); onChange(); }}></textarea>
          </div>
          <div class="field">
            <label class="field-label">設置條件</label>
            <textarea class="field-textarea sm" rows="2" value={s(flag, 'setCondition')} on:input={(e) => { flag.setCondition = val(e); onChange(); }}></textarea>
          </div>
          <div class="field">
            <label class="field-label">清除條件</label>
            <textarea class="field-textarea sm" rows="2" value={s(flag, 'unsetCondition')} on:input={(e) => { flag.unsetCondition = val(e); onChange(); }}></textarea>
          </div>

          <!-- Proximity -->
          <div class="sub-label">可見性過濾 (Proximity)</div>
          <div class="prox-grid">
            <div class="field">
              <label class="field-label">地點（逗號分隔）</label>
              <input class="field-input sm" value={getStringArr(getProximity(flag), 'locationIds').join(', ')}
                on:input={(e) => { getProximity(flag).locationIds = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
            </div>
            <div class="field">
              <label class="field-label">區域（逗號分隔）</label>
              <input class="field-input sm" value={getStringArr(getProximity(flag), 'districtIds').join(', ')}
                on:input={(e) => { getProximity(flag).districtIds = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
            </div>
            <div class="field">
              <label class="field-label">任務（逗號分隔）</label>
              <input class="field-input sm" value={getStringArr(getProximity(flag), 'questIds').join(', ')}
                on:input={(e) => { getProximity(flag).questIds = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
            </div>
            <div class="field">
              <label class="field-label">時段（逗號分隔）</label>
              <input class="field-input sm" value={getStringArr(getProximity(flag), 'timePeriods').join(', ')}
                on:input={(e) => { getProximity(flag).timePeriods = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
            </div>
            <div class="field">
              <label class="field-label">必須旗標（逗號分隔）</label>
              <input class="field-input sm" value={getStringArr(getProximity(flag), 'flags').join(', ')}
                on:input={(e) => { getProximity(flag).flags = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
            </div>
            <div class="field">
              <label class="field-label">排除旗標（逗號分隔）</label>
              <input class="field-input sm" value={getStringArr(getProximity(flag), 'notFlags').join(', ')}
                on:input={(e) => { getProximity(flag).notFlags = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/each}

  <button class="add-btn" on:click={addFlag}>+ 新增旗標</button>
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; }
  .field-input { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }
  .field-input:focus { border-color: var(--border-accent); }
  .field-input.sm { font-size: 10px; padding: 3px 6px; }
  .field-textarea { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 6px 8px; border-radius: 2px; outline: none; resize: vertical; line-height: 1.6; }
  .field-textarea:focus { border-color: var(--border-accent); }
  .field-textarea.sm { font-size: 10px; padding: 4px 6px; }

  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }
  .sub-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; margin-top: 4px; }

  .card { border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
  .card-header { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--bg-tertiary); cursor: pointer; transition: background 0.08s; }
  .card-header:hover { background: var(--bg-secondary); }
  .card-arrow { font-size: 8px; color: var(--text-dim); flex-shrink: 0; }
  .card-title { font-size: 10px; color: var(--accent); font-family: var(--font-mono); flex-shrink: 0; }
  .card-desc { font-size: 9px; color: var(--text-dim); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  .prox-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

  .rm { background: none; border: none; color: var(--text-dim); font-size: 9px; cursor: pointer; padding: 2px 4px; flex-shrink: 0; }
  .rm:hover { color: var(--accent-red); }
  .rm.sm { font-size: 8px; padding: 1px 3px; }

  .add-btn { background: none; border: 1px dashed var(--border); color: var(--text-dim); font-family: var(--font-mono); font-size: 9px; padding: 3px 8px; cursor: pointer; border-radius: 2px; transition: color 0.1s, border-color 0.1s; text-align: center; }
  .add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }
</style>
