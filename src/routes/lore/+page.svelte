<script lang="ts">
  import { onMount } from 'svelte';
  import { ENTITY_TYPES, FORM_EDITOR_TYPES, type EntityType } from '$lib/lore-editor/entityTypes';
  import { listLoreDir, readLoreFile, writeLoreFile, type LoreFileEntry } from '$lib/lore-editor/fileUtils';
  import PropEditor from '$lib/lore-editor/components/editors/PropEditor.svelte';
  import ItemEditor from '$lib/lore-editor/components/editors/ItemEditor.svelte';
  import FactionEditor from '$lib/lore-editor/components/editors/FactionEditor.svelte';
  import LocationEditor from '$lib/lore-editor/components/editors/LocationEditor.svelte';
  import NpcEditor from '$lib/lore-editor/components/editors/NpcEditor.svelte';
  import EventEditor from '$lib/lore-editor/components/editors/EventEditor.svelte';

  let activeType: EntityType = 'location';
  let filterText = '';
  let entityList: LoreFileEntry[] = [];
  let selectedEntity: LoreFileEntry | null = null;
  let rawJson = '';
  let formData: Record<string, unknown> | null = null;
  let dirty = false;
  let status = '就緒';
  let editorMode: 'form' | 'json' = 'form';

  $: hasFormEditor = FORM_EDITOR_TYPES.includes(activeType);
  $: if (!hasFormEditor) editorMode = 'json';

  const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  async function loadEntityList(type: EntityType) {
    entityList = [];
    selectedEntity = null;
    rawJson = '';
    formData = null;
    dirty = false;

    const meta = ENTITY_TYPES.find(t => t.type === type);
    if (!meta) return;

    try {
      entityList = await listLoreDir(meta.dir);
      status = `${entityList.length} 個${meta.label}`;
    } catch (err) {
      status = `錯誤：${err}`;
    }
  }

  async function selectEntity(entity: LoreFileEntry) {
    if (dirty && !confirm('尚未儲存的變更將會遺失，確定切換？')) return;
    selectedEntity = entity;
    dirty = false;

    try {
      rawJson = await readLoreFile(entity.path);
      try {
        const obj = JSON.parse(rawJson);
        formData = obj;
        if (obj.name) entity.name = obj.name;
      } catch {
        formData = null;
      }
      if (hasFormEditor && formData) {
        editorMode = 'form';
      } else {
        editorMode = 'json';
      }
      status = `已載入 ${entity.id}`;
    } catch (err) {
      status = `讀取失敗：${err}`;
    }
  }

  /** Sync formData → rawJson when switching from form to json mode */
  function syncFormToJson() {
    if (formData) {
      rawJson = JSON.stringify(formData, null, 2);
    }
  }

  /** Sync rawJson → formData when switching from json to form mode */
  function syncJsonToForm() {
    try {
      formData = JSON.parse(rawJson);
    } catch {
      status = 'JSON 格式錯誤，無法切換至表單模式';
      editorMode = 'json';
    }
  }

  function switchMode(mode: 'form' | 'json') {
    if (mode === editorMode) return;
    if (mode === 'json') syncFormToJson();
    else syncJsonToForm();
    editorMode = mode;
  }

  async function saveEntity() {
    if (!selectedEntity) return;
    // Build content from current mode
    let content: string;
    if (editorMode === 'form' && formData) {
      content = JSON.stringify(formData, null, 2);
    } else {
      content = rawJson;
    }
    // Validate
    try { JSON.parse(content); } catch (err) {
      status = `JSON 格式錯誤：${err}`;
      return;
    }
    try {
      await writeLoreFile(selectedEntity.path, content);
      rawJson = content;
      dirty = false;
      status = `已儲�� ${selectedEntity.id}`;
    } catch (err) {
      status = `儲存失敗：${err}`;
    }
  }

  function handleJsonInput(e: Event) {
    rawJson = (e.target as HTMLTextAreaElement).value;
    dirty = true;
  }

  function handleFormChange() {
    dirty = true;
  }

  function formatJson() {
    try {
      const obj = JSON.parse(rawJson);
      rawJson = JSON.stringify(obj, null, 2);
      dirty = true;
      status = '已格式化';
    } catch (err) {
      status = `JSON 格式錯誤：${err}`;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveEntity();
    }
  }

  $: filteredEntities = entityList.filter(e =>
    !filterText || e.id.toLowerCase().includes(filterText.toLowerCase())
  );

  $: loadEntityList(activeType);

  onMount(() => {
    loadEntityList(activeType);
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="editor-layout">
  <!-- Left sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="editor-title">Lore Editor</div>
      <div class="region-tag">crambell</div>
    </div>

    <div class="type-tabs">
      {#each ENTITY_TYPES as et}
        <button
          class="type-tab"
          class:active={activeType === et.type}
          on:click={() => { activeType = et.type; }}
          title={et.label}
        >
          <span class="tab-icon">{et.icon}</span>
          <span class="tab-label">{et.label}</span>
        </button>
      {/each}
    </div>

    <div class="filter-wrap">
      <input
        class="filter-input"
        bind:value={filterText}
        placeholder="搜尋 ID..."
        autocomplete="off"
        spellcheck="false"
      />
    </div>

    <div class="entity-list">
      {#each filteredEntities as entity (entity.id)}
        <button
          class="entity-item"
          class:selected={selectedEntity?.id === entity.id}
          class:dirty={selectedEntity?.id === entity.id && dirty}
          on:click={() => selectEntity(entity)}
        >
          <span class="entity-id">{entity.id}</span>
        </button>
      {/each}
      {#if filteredEntities.length === 0}
        <div class="empty-msg">
          {entityList.length === 0 ? '載入中...' : '沒有符合的結果'}
        </div>
      {/if}
    </div>
  </aside>

  <!-- Main editor area -->
  <main class="editor-main">
    {#if selectedEntity}
      <div class="editor-toolbar">
        <div class="toolbar-left">
          <span class="toolbar-id">{selectedEntity.id}</span>
          {#if dirty}
            <span class="dirty-badge">未儲存</span>
          {/if}
        </div>
        <div class="toolbar-center">
          {#if hasFormEditor}
            <button class="mode-tab" class:active={editorMode === 'form'} on:click={() => switchMode('form')}>表單</button>
            <button class="mode-tab" class:active={editorMode === 'json'} on:click={() => switchMode('json')}>JSON</button>
          {:else}
            <span class="mode-hint">JSON</span>
          {/if}
        </div>
        <div class="toolbar-right">
          {#if editorMode === 'json'}
            <button class="tool-btn" on:click={formatJson} title="格式化 JSON">格式化</button>
          {/if}
          <button class="tool-btn save-btn" on:click={saveEntity} disabled={!dirty} title="儲存 (Ctrl+S)">儲存</button>
        </div>
      </div>

      <div class="editor-body">
        {#if editorMode === 'form' && formData}
          <div class="form-scroll">
            {#if activeType === 'prop'}
              <PropEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'item'}
              <ItemEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'faction'}
              <FactionEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'location'}
              <LocationEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'npc'}
              <NpcEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'event'}
              <EventEditor data={formData} onChange={handleFormChange} />
            {/if}
          </div>
        {:else}
          <textarea
            class="json-editor"
            value={rawJson}
            on:input={handleJsonInput}
            spellcheck="false"
            autocomplete="off"
          ></textarea>
        {/if}
      </div>
    {:else}
      <div class="empty-state">
        <div class="empty-icon">◈</div>
        <div class="empty-text">選擇一個實體以開始編��</div>
        <div class="empty-hint">左側選擇類型，然後從列表中點選實體</div>
      </div>
    {/if}
  </main>
</div>

<!-- Status bar -->
<div class="status-bar">
  <span class="status-text">{status}</span>
  <span class="status-env">{IS_TAURI ? 'Tauri' : 'Web'}</span>
</div>

<style>
  /* ── Layout ─────────────────────────────────────── */
  .editor-layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    height: calc(100vh - 22px);
    overflow: hidden;
  }

  /* ── Sidebar ────────────────────────────────────── */
  .sidebar {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    background: var(--bg-secondary);
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .editor-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.08em;
  }

  .region-tag {
    font-size: 9px;
    color: var(--accent);
    border: 1px solid var(--accent-dim);
    padding: 1px 6px;
    border-radius: 2px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .type-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .type-tab {
    background: none;
    border: 1px solid transparent;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 9px;
    padding: 2px 5px;
    cursor: pointer;
    border-radius: 2px;
    display: flex;
    align-items: center;
    gap: 3px;
    transition: color 0.1s, border-color 0.1s;
    letter-spacing: 0.02em;
  }

  .type-tab:hover { color: var(--text-secondary); border-color: var(--border); }
  .type-tab.active { color: var(--accent); border-color: var(--accent-dim); background: var(--bg-tertiary); }

  .tab-icon { font-size: 8px; }
  .tab-label { font-size: 9px; }

  .filter-wrap {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .filter-input {
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 4px 8px;
    border-radius: 2px;
    outline: none;
  }

  .filter-input:focus { border-color: var(--border-accent); }
  .filter-input::placeholder { color: var(--text-dim); }

  .entity-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .entity-item {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 4px 12px;
    cursor: pointer;
    text-align: left;
    border-left: 2px solid transparent;
    transition: background 0.08s, border-color 0.08s;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .entity-item:hover { background: var(--bg-tertiary); }
  .entity-item.selected { border-left-color: var(--accent); background: var(--bg-tertiary); color: var(--text-primary); }
  .entity-item.dirty { border-left-color: #c9a96e; }

  .entity-id { letter-spacing: 0.02em; }

  .empty-msg {
    font-size: 10px;
    color: var(--text-dim);
    text-align: center;
    padding: 20px 12px;
    font-style: italic;
  }

  /* ── Main editor ────────────────────────────────── */
  .editor-main {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
    gap: 12px;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .toolbar-id {
    font-size: 11px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dirty-badge {
    font-size: 8px;
    color: #c9a96e;
    border: 1px solid #c9a96e44;
    padding: 0px 5px;
    border-radius: 2px;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }

  .toolbar-center {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .mode-tab {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 9px;
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.1s;
    letter-spacing: 0.04em;
  }

  .mode-tab:hover { color: var(--text-secondary); border-color: var(--border-accent); }
  .mode-tab.active { color: var(--accent); border-color: var(--accent-dim); background: var(--bg-tertiary); }

  .mode-hint {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.06em;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .tool-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 10px;
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.1s, color 0.1s;
  }

  .tool-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .tool-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .save-btn:not(:disabled) { border-color: var(--accent-dim); color: var(--accent); }
  .save-btn:not(:disabled):hover { border-color: var(--accent); }

  .editor-body {
    flex: 1;
    overflow: hidden;
    padding: 0;
  }

  .form-scroll {
    height: 100%;
    overflow-y: auto;
  }

  .json-editor {
    width: 100%;
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.6;
    border: none;
    outline: none;
    padding: 12px 16px;
    resize: none;
    tab-size: 2;
  }

  .json-editor::selection {
    background: var(--accent-dim);
  }

  /* ── Empty state ────────���───────────────────────── */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .empty-icon {
    font-size: 24px;
    color: var(--text-dim);
    opacity: 0.3;
  }

  .empty-text {
    font-size: 12px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
  }

  .empty-hint {
    font-size: 10px;
    color: var(--text-dim);
    opacity: 0.5;
  }

  /* ── Status bar ─────────────────────────────────── */
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    padding: 0 12px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .status-text {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.03em;
  }

  .status-env {
    font-size: 8px;
    color: var(--text-dim);
    opacity: 0.5;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  /* ── Scrollbar ──────────────────────────────────── */
  .entity-list::-webkit-scrollbar,
  .json-editor::-webkit-scrollbar,
  .form-scroll::-webkit-scrollbar {
    width: 6px;
  }

  .entity-list::-webkit-scrollbar-track,
  .json-editor::-webkit-scrollbar-track,
  .form-scroll::-webkit-scrollbar-track {
    background: var(--scrollbar-track);
  }

  .entity-list::-webkit-scrollbar-thumb,
  .json-editor::-webkit-scrollbar-thumb,
  .form-scroll::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 3px;
  }
</style>
