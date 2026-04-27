<script lang="ts">
  /**
   * StarterEditor — editor for lore/world/starter.json
   * Defines the player's starting state: location, time, stats, inventory.
   */
  import EntityPicker from '../EntityPicker.svelte';
  import KeyValueEditor from '../KeyValueEditor.svelte';

  export let data: Record<string, unknown>;
  export let onChange: () => void = () => {};

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  function getWorld(): Record<string, unknown> {
    if (!data.world || typeof data.world !== 'object') data.world = {};
    return data.world as Record<string, unknown>;
  }

  function getStartTime(): Record<string, unknown> {
    const w = getWorld();
    if (!w.startTime || typeof w.startTime !== 'object') w.startTime = { year: 1498, month: 1, day: 1, hour: 0, minute: 0 };
    return w.startTime as Record<string, unknown>;
  }

  function getStartingFlags(): string[] {
    return (getWorld().startingFlags || []) as string[];
  }

  function getPlayer(): Record<string, unknown> {
    if (!data.player || typeof data.player !== 'object') data.player = {};
    return data.player as Record<string, unknown>;
  }

  function getStatGroup(key: string): Record<string, unknown> {
    const p = getPlayer();
    if (!p[key] || typeof p[key] !== 'object') p[key] = {};
    return p[key] as Record<string, unknown>;
  }

  function getInventory(): string[] {
    return (getPlayer().inventory || []) as string[];
  }

  function getKnownIntelIds(): string[] {
    return (getPlayer().knownIntelIds || []) as string[];
  }

  function s(obj: Record<string, unknown>, key: string): string { return String(obj[key] ?? ''); }
  function n(obj: Record<string, unknown>, key: string, def = 0): number { return Number(obj[key] ?? def); }
</script>

<div class="form">
  <!-- World settings -->
  <div class="section">
    <div class="section-label">世界設定</div>

    <div class="field">
      <label class="field-label">起始地點</label>
      <EntityPicker type="location" value={s(getWorld(), 'startLocationId')} placeholder="地點 ID..."
        onSelect={(id) => { getWorld().startLocationId = id; data = data; onChange(); }} />
    </div>

    <div class="field-row">
      <div class="field" style="flex:1">
        <label class="field-label">時段</label>
        <select class="field-select" value={s(getWorld(), 'startPeriod') || 'rest'} on:change={(e) => { getWorld().startPeriod = val(e); onChange(); }}>
          <option value="work">work</option>
          <option value="rest">rest</option>
          <option value="special">special</option>
        </select>
      </div>
      <div class="field" style="flex:1">
        <label class="field-label">World Phase</label>
        <input class="field-input" value={s(getWorld(), 'worldPhase')} on:input={(e) => { getWorld().worldPhase = val(e); onChange(); }} />
      </div>
    </div>

    <div class="sub-label">起始時間</div>
    <div class="field-row">
      {#each ['year', 'month', 'day', 'hour', 'minute'] as field}
        <div class="field" style="flex:1">
          <label class="field-label">{field}</label>
          <input class="field-input sm" type="number" value={n(getStartTime(), field)} on:input={(e) => { getStartTime()[field] = parseInt(val(e)) || 0; onChange(); }} />
        </div>
      {/each}
    </div>

    <div class="field">
      <label class="field-label">起始旗標（逗號分隔）</label>
      <input class="field-input" value={getStartingFlags().join(', ')}
        on:input={(e) => { getWorld().startingFlags = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
    </div>
  </div>

  <!-- Player settings -->
  <div class="section">
    <div class="section-label">玩家設定</div>

    <div class="field-row">
      <div class="field" style="flex:1">
        <label class="field-label">出身</label>
        <input class="field-input" value={s(getPlayer(), 'origin')} on:input={(e) => { getPlayer().origin = val(e); onChange(); }} />
      </div>
      <div class="field" style="flex:1">
        <label class="field-label">稱號</label>
        <input class="field-input" value={s(getPlayer(), 'title')} on:input={(e) => { getPlayer().title = val(e); onChange(); }} />
      </div>
    </div>

    <!-- Primary Stats -->
    <div class="sub-label">主要數值 (primaryStats)</div>
    <div class="stat-grid">
      {#each ['strength', 'knowledge', 'talent', 'spirit', 'luck'] as stat}
        <div class="stat-field">
          <label class="field-label">{stat}</label>
          <input class="field-input sm" type="number" value={n(getStatGroup('primaryStats'), stat, 5)}
            on:input={(e) => { getStatGroup('primaryStats')[stat] = parseInt(val(e)) || 0; onChange(); }} />
        </div>
      {/each}
    </div>

    <!-- Secondary Stats -->
    <div class="sub-label">次要數值 (secondaryStats)</div>
    <div class="stat-grid">
      {#each ['consciousness', 'mysticism', 'technology'] as stat}
        <div class="stat-field">
          <label class="field-label">{stat}</label>
          <input class="field-input sm" type="number" value={n(getStatGroup('secondaryStats'), stat)}
            on:input={(e) => { getStatGroup('secondaryStats')[stat] = parseInt(val(e)) || 0; onChange(); }} />
        </div>
      {/each}
    </div>

    <!-- Status Stats -->
    <div class="sub-label">狀態數值 (statusStats)</div>
    <div class="stat-grid">
      {#each ['stamina', 'staminaMax', 'stress', 'stressMax', 'endo', 'endoMax'] as stat}
        <div class="stat-field">
          <label class="field-label">{stat}</label>
          <input class="field-input sm" type="number" value={n(getStatGroup('statusStats'), stat)}
            on:input={(e) => { getStatGroup('statusStats')[stat] = parseInt(val(e)) || 0; onChange(); }} />
        </div>
      {/each}
    </div>
  </div>

  <!-- Inventory -->
  <div class="section">
    <div class="section-label">初始物品欄</div>
    {#each getInventory() as item, i}
      <div class="inv-row">
        <input class="field-input sm" style="flex:1" value={item} on:input={(e) => {
          const inv = getInventory(); inv[i] = val(e); getPlayer().inventory = inv; onChange();
        }} />
        <button class="rm" on:click={() => { getPlayer().inventory = getInventory().filter((_x, j) => j !== i); onChange(); }}>✕</button>
      </div>
    {/each}
    <button class="add-btn" on:click={() => { getPlayer().inventory = [...getInventory(), '']; onChange(); }}>+ 物品</button>
    <div class="hint">格式：item_id 或 item_id|name:...|desc:...|content:...</div>
  </div>

  <!-- Known Intel -->
  <div class="section">
    <div class="section-label">已知情報</div>
    <div class="field">
      <input class="field-input" value={getKnownIntelIds().join(', ')} placeholder="逗號分隔 intel ID..."
        on:input={(e) => { getPlayer().knownIntelIds = val(e).split(',').map(x => x.trim()).filter(Boolean); onChange(); }} />
    </div>
  </div>
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-row { display: flex; gap: 10px; align-items: flex-start; }
  .field-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; }
  .field-input { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }
  .field-input:focus { border-color: var(--border-accent); }
  .field-input.sm { font-size: 10px; padding: 3px 6px; }
  .field-select { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }

  .section { display: flex; flex-direction: column; gap: 8px; }
  .section-label { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.06em; font-weight: 500; }
  .sub-label { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; margin-top: 4px; }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 6px; }
  .stat-field { display: flex; flex-direction: column; gap: 2px; }

  .inv-row { display: flex; gap: 4px; align-items: center; }

  .rm { background: none; border: none; color: var(--text-dim); font-size: 9px; cursor: pointer; padding: 2px 4px; flex-shrink: 0; }
  .rm:hover { color: var(--accent-red); }

  .add-btn { background: none; border: 1px dashed var(--border); color: var(--text-dim); font-family: var(--font-mono); font-size: 9px; padding: 3px 8px; cursor: pointer; border-radius: 2px; transition: color 0.1s, border-color 0.1s; text-align: center; }
  .add-btn:hover { border-color: var(--accent-dim); color: var(--accent); }

  .hint { font-size: 8px; color: var(--text-dim); font-style: italic; }
</style>
