<script lang="ts">
  import { onMount } from 'svelte';
  import { ENTITY_TYPES, FORM_EDITOR_TYPES, type EntityType } from '$lib/lore-editor/entityTypes';
  import { listLoreDir, readLoreFile, writeLoreFile, deleteLoreFile, type LoreFileEntry } from '$lib/lore-editor/fileUtils';
  import { getEntityTemplate, generateFilename } from '$lib/lore-editor/entityTemplates';
  import { buildLoreIndex, type LoreIndexData, type RefEntry } from '$lib/lore-editor/LoreIndex';
  import PropEditor from '$lib/lore-editor/components/editors/PropEditor.svelte';
  import ItemEditor from '$lib/lore-editor/components/editors/ItemEditor.svelte';
  import FactionEditor from '$lib/lore-editor/components/editors/FactionEditor.svelte';
  import LocationEditor from '$lib/lore-editor/components/editors/LocationEditor.svelte';
  import NpcEditor from '$lib/lore-editor/components/editors/NpcEditor.svelte';
  import EventEditor from '$lib/lore-editor/components/editors/EventEditor.svelte';
  import QuestEditor from '$lib/lore-editor/components/editors/QuestEditor.svelte';
  import DialogueEditor from '$lib/lore-editor/components/editors/DialogueEditor.svelte';
  import EncounterEditor from '$lib/lore-editor/components/editors/EncounterEditor.svelte';
  import FlagEditor from '$lib/lore-editor/components/editors/FlagEditor.svelte';
  import DistrictEditor from '$lib/lore-editor/components/editors/DistrictEditor.svelte';
  import ConditionDefEditor from '$lib/lore-editor/components/editors/ConditionDefEditor.svelte';
  import StarterEditor from '$lib/lore-editor/components/editors/StarterEditor.svelte';
  import IntelEditor from '$lib/lore-editor/components/editors/IntelEditor.svelte';

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

    // Single-file types: auto-load directly
    if (meta.singleFile && meta.filePath) {
      const entry: LoreFileEntry = {
        id: meta.type,
        name: meta.label,
        path: `lore/${meta.filePath}`,
      };
      entityList = [entry];
      status = meta.label;
      // Auto-select
      await selectEntity(entry);
      return;
    }

    try {
      const list = await listLoreDir(meta.dir);
      // Load names from files in parallel (best-effort)
      await Promise.all(list.map(async (entry) => {
        try {
          const text = await readLoreFile(entry.path);
          const parsed = JSON.parse(text);
          if (parsed.name) entry.name = parsed.name;
          else if (Array.isArray(parsed) && parsed.length > 0) {
            entry.name = `${parsed.length} 個項目`;
          }
        } catch { /* keep default name = id */ }
      }));
      entityList = list;
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
        const parsed = JSON.parse(rawJson);
        // Flag files are arrays — wrap them so form editors can work
        if (Array.isArray(parsed)) {
          formData = { __isArray: true, __items: parsed } as Record<string, unknown>;
        } else {
          formData = parsed;
          if (parsed.name) entity.name = parsed.name;
        }
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

  /** Unwrap array wrapper if present. */
  function serializeFormData(): string {
    if (!formData) return rawJson;
    if (formData.__isArray && Array.isArray(formData.__items)) {
      return JSON.stringify(formData.__items, null, 2);
    }
    return JSON.stringify(formData, null, 2);
  }

  /** Sync formData → rawJson when switching from form to json mode */
  function syncFormToJson() {
    if (formData) {
      rawJson = serializeFormData();
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
      content = serializeFormData();
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
    formData = formData; // trigger Svelte reactivity for parent-level bindings
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

  let filteredEntities: LoreFileEntry[] = [];
  $: {
    const q = filterText.toLowerCase();
    filteredEntities = entityList.filter(e =>
      !q || e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    );
  }

  $: loadEntityList(activeType);

  // ── LoreIndex (reverse refs + broken refs) ──
  let loreIndex: LoreIndexData | null = null;
  let indexLoading = false;

  async function refreshIndex() {
    indexLoading = true;
    try {
      loreIndex = await buildLoreIndex();
      status = `索引完成：${loreIndex.totalEntities} 個實體，${loreIndex.brokenRefs.length} 個斷裂引用`;
    } catch (err) {
      status = `索引失敗：${err}`;
    }
    indexLoading = false;
  }

  function getUsedBy(id: string): RefEntry[] {
    return loreIndex?.reverseRefs.get(id) ?? [];
  }

  // ── New entity wizard ──
  let showNewDialog = false;
  let newEntityId = '';

  function openNewDialog() {
    const meta = ENTITY_TYPES.find(t => t.type === activeType);
    newEntityId = `crambell_${meta?.type === 'item' ? '' : (meta?.type ?? '') + '_'}`;
    showNewDialog = true;
  }

  async function createEntity() {
    if (!newEntityId.trim()) { status = 'ID 不可為空'; return; }
    const meta = ENTITY_TYPES.find(t => t.type === activeType);
    if (!meta) return;

    const filename = generateFilename(activeType, newEntityId);
    const path = `lore/${meta.dir}/${filename}`;

    // Check if already exists
    if (entityList.some(e => e.id === newEntityId.trim())) {
      status = `ID "${newEntityId}" 已存在`;
      return;
    }

    const template = getEntityTemplate(activeType, newEntityId.trim());
    const content = JSON.stringify(template, null, 2);

    try {
      await writeLoreFile(path, content);
      showNewDialog = false;
      status = `已建立 ${newEntityId}`;
      await loadEntityList(activeType);
      // Auto-select the new entity
      const created = entityList.find(e => e.id === newEntityId.trim());
      if (created) await selectEntity(created);
    } catch (err) {
      status = `建立失敗：${err}`;
    }
  }

  // ── Delete entity ──
  let showDeleteConfirm = false;

  async function deleteEntity() {
    if (!selectedEntity) return;
    const refs = getUsedBy(selectedEntity.id);
    if (refs.length > 0 && !confirm(`此實體被 ${refs.length} 個其他實體引用，確定要刪除？`)) return;

    try {
      await deleteLoreFile(selectedEntity.path);
      status = `已刪除 ${selectedEntity.id}`;
      showDeleteConfirm = false;
      selectedEntity = null;
      formData = null;
      rawJson = '';
      dirty = false;
      await loadEntityList(activeType);
    } catch (err) {
      status = `刪除失敗：${err}`;
    }
  }

  // ── Duplicate entity ──
  async function duplicateEntity() {
    if (!selectedEntity) return;
    const meta = ENTITY_TYPES.find(t => t.type === activeType);
    if (!meta) return;

    const newId = selectedEntity.id + '_copy';
    const filename = generateFilename(activeType, newId);
    const path = `lore/${meta.dir}/${filename}`;

    // Get current content and replace id
    let content: string;
    if (editorMode === 'form' && formData) {
      const clone = JSON.parse(serializeFormData());
      if (clone && typeof clone === 'object' && !Array.isArray(clone)) clone.id = newId;
      content = JSON.stringify(clone, null, 2);
    } else {
      const clone = JSON.parse(rawJson);
      if (clone && typeof clone === 'object' && !Array.isArray(clone)) clone.id = newId;
      content = JSON.stringify(clone, null, 2);
    }

    try {
      await writeLoreFile(path, content);
      status = `已複製為 ${newId}`;
      await loadEntityList(activeType);
      const created = entityList.find(e => e.id === newId);
      if (created) await selectEntity(created);
    } catch (err) {
      status = `複製失敗：${err}`;
    }
  }

  onMount(() => {
    loadEntityList(activeType);
    refreshIndex(); // Build index in background
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
      {#each ENTITY_TYPES.filter(t => t.group !== 'global') as et}
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
      <span class="tab-sep">|</span>
      {#each ENTITY_TYPES.filter(t => t.group === 'global') as et}
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

    {#if !ENTITY_TYPES.find(t => t.type === activeType)?.singleFile}
    <div class="filter-wrap">
      <div class="filter-row">
        <input
          class="filter-input"
          bind:value={filterText}
          placeholder="搜尋..."
        autocomplete="off"
        spellcheck="false"
        />
        <button class="new-btn" on:click={openNewDialog} title="新增實體">+</button>
      </div>
    </div>

    <div class="entity-list">
      {#each filteredEntities as entity (entity.id)}
        <button
          class="entity-item"
          class:selected={selectedEntity?.id === entity.id}
          class:dirty={selectedEntity?.id === entity.id && dirty}
          on:click={() => selectEntity(entity)}
          title={entity.id}
        >
          <span class="entity-name">{entity.name !== entity.id ? entity.name : ''}</span>
          <span class="entity-id">{entity.id}</span>
        </button>
      {/each}
      {#if filteredEntities.length === 0}
        <div class="empty-msg">
          {entityList.length === 0 ? '載入中...' : '沒有符合的結果'}
        </div>
      {/if}
    </div>
    {/if}
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
          <button class="tool-btn" on:click={duplicateEntity} title="複製為新實體">複製</button>
          <button class="tool-btn danger-btn" on:click={() => { showDeleteConfirm = true; }} title="刪除此實體">刪除</button>
          {#if editorMode === 'json'}
            <button class="tool-btn" on:click={formatJson} title="格式化 JSON">格式化</button>
          {/if}
          <button class="tool-btn save-btn" on:click={saveEntity} disabled={!dirty} title="儲存 (Ctrl+S)">儲存</button>
        </div>
      </div>

      <div class="editor-body">
        {#key selectedEntity?.id}
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
            {:else if activeType === 'quest'}
              <QuestEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'dialogue'}
              <DialogueEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'encounter'}
              <EncounterEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'flag'}
              <FlagEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'district'}
              <DistrictEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'condition_def'}
              <ConditionDefEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'starter'}
              <StarterEditor data={formData} onChange={handleFormChange} />
            {:else if activeType === 'intel'}
              <IntelEditor data={formData} onChange={handleFormChange} />
            {/if}

            <!-- Used By panel -->
            {#if selectedEntity && loreIndex}
              {@const usedBy = getUsedBy(selectedEntity.id)}
              {#if usedBy.length > 0}
                <div class="used-by-panel">
                  <div class="used-by-label">被引用 · {usedBy.length}</div>
                  {#each usedBy as ref}
                    <div class="used-by-item">
                      <span class="ref-source">{ref.sourceType}:{ref.sourceId}</span>
                      <span class="ref-path">{ref.fieldPath}</span>
                    </div>
                  {/each}
                </div>
              {/if}
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
        {/key}
      </div>
    {:else}
      <div class="empty-state">
        <div class="empty-icon">◈</div>
        <div class="empty-text">選擇一個項目以開始編輯</div>
        <div class="empty-hint">左側選擇類型，然後從列表中點選項目</div>
      </div>
    {/if}
  </main>
</div>

<!-- Status bar -->
<div class="status-bar">
  <span class="status-text">{status}</span>
  <div class="status-right">
    {#if loreIndex && loreIndex.brokenRefs.length > 0}
      <span class="broken-badge" title={loreIndex.brokenRefs.map(r => `${r.sourceId} → ${r.targetId}`).slice(0, 10).join('\n')}>
        {loreIndex.brokenRefs.length} 斷裂引用
      </span>
    {/if}
    <button class="status-btn" on:click={refreshIndex} disabled={indexLoading}>
      {indexLoading ? '掃描中...' : '重新掃描'}
    </button>
    <span class="status-env">{IS_TAURI ? 'Tauri' : 'Web'}</span>
  </div>
</div>

<!-- New entity dialog -->
{#if showNewDialog}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="dialog-backdrop" on:click={() => { showNewDialog = false; }}>
    <div class="dialog" on:click|stopPropagation>
      <div class="dialog-title">新增{ENTITY_TYPES.find(t => t.type === activeType)?.label ?? '實體'}</div>
      <div class="dialog-field">
        <label class="dialog-label">ID</label>
        <input class="dialog-input" bind:value={newEntityId} placeholder="crambell_..."
          autocomplete="off" spellcheck="false"
          on:keydown={(e) => { if (e.key === 'Enter') createEntity(); }}
        />
      </div>
      <div class="dialog-hint">檔案名稱：{generateFilename(activeType, newEntityId)}</div>
      <div class="dialog-actions">
        <button class="dialog-btn" on:click={() => { showNewDialog = false; }}>取消</button>
        <button class="dialog-btn primary" on:click={createEntity}>建立</button>
      </div>
    </div>
  </div>
{/if}

<!-- Delete confirmation -->
{#if showDeleteConfirm && selectedEntity}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="dialog-backdrop" on:click={() => { showDeleteConfirm = false; }}>
    <div class="dialog" on:click|stopPropagation>
      <div class="dialog-title">刪除確認</div>
      <div class="dialog-msg">確定要刪除 <strong>{selectedEntity.id}</strong>？</div>
      {#if loreIndex}
        {@const refs = getUsedBy(selectedEntity.id)}
        {#if refs.length > 0}
          <div class="dialog-warn">
            此實體被 {refs.length} 個其他實體引用：
            <div class="ref-list-compact">
              {#each refs.slice(0, 8) as ref}
                <div>{ref.sourceType}:{ref.sourceId} — {ref.fieldPath}</div>
              {/each}
              {#if refs.length > 8}
                <div>...還有 {refs.length - 8} 個</div>
              {/if}
            </div>
          </div>
        {/if}
      {/if}
      <div class="dialog-actions">
        <button class="dialog-btn" on:click={() => { showDeleteConfirm = false; }}>取消</button>
        <button class="dialog-btn danger" on:click={deleteEntity}>刪除</button>
      </div>
    </div>
  </div>
{/if}

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
  .tab-sep { color: var(--border); font-size: 10px; padding: 0 2px; align-self: center; }

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

  .entity-name {
    display: block;
    font-size: 10px;
    color: var(--text-secondary);
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .entity-name:empty { display: none; }

  .entity-id {
    display: block;
    font-size: 8px;
    color: var(--text-dim);
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .entity-item.selected .entity-name { color: var(--text-primary); }
  .entity-item.selected .entity-id { color: var(--text-secondary); }

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

  /* ── Filter row with new button ────────────── */
  .filter-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .filter-row .filter-input { flex: 1; }

  .new-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
    width: 24px;
    height: 22px;
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.1s, color 0.1s;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .new-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* ── Toolbar danger button ────────────────── */
  .danger-btn { color: var(--accent-red); border-color: transparent; }
  .danger-btn:hover:not(:disabled) { border-color: var(--accent-red); }

  /* ── Used By panel ────────────────────────── */
  .used-by-panel {
    margin: 12px 16px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: color-mix(in srgb, var(--bg-tertiary) 30%, transparent);
  }

  .used-by-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .used-by-item {
    display: flex;
    gap: 8px;
    font-size: 9px;
    font-family: var(--font-mono);
    padding: 2px 0;
    border-bottom: 1px solid var(--border);
  }

  .used-by-item:last-child { border-bottom: none; }

  .ref-source { color: var(--text-secondary); flex-shrink: 0; }
  .ref-path { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── Status bar additions ─────────────────── */
  .status-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .broken-badge {
    font-size: 8px;
    color: var(--accent-red);
    border: 1px solid var(--accent-red);
    padding: 1px 5px;
    border-radius: 2px;
    cursor: help;
  }

  .status-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 8px;
    padding: 1px 6px;
    cursor: pointer;
    border-radius: 2px;
    transition: color 0.1s;
  }

  .status-btn:hover:not(:disabled) { color: var(--text-secondary); }
  .status-btn:disabled { opacity: 0.3; }

  /* ── Dialogs ──────────────────────────────── */
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 4px;
    padding: 16px 20px;
    min-width: 320px;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .dialog-title {
    font-size: 12px;
    color: var(--text-primary);
    letter-spacing: 0.06em;
    font-weight: 500;
  }

  .dialog-field { display: flex; flex-direction: column; gap: 4px; }

  .dialog-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .dialog-input {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 10px;
    border-radius: 2px;
    outline: none;
  }

  .dialog-input:focus { border-color: var(--border-accent); }

  .dialog-hint {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .dialog-msg {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .dialog-warn {
    font-size: 10px;
    color: var(--accent-red);
    padding: 6px 8px;
    border: 1px solid var(--accent-red);
    border-radius: 2px;
    line-height: 1.5;
  }

  .ref-list-compact {
    font-size: 9px;
    font-family: var(--font-mono);
    margin-top: 4px;
    color: var(--text-dim);
  }

  .dialog-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .dialog-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 4px 14px;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.1s;
  }

  .dialog-btn:hover { border-color: var(--border-accent); color: var(--text-secondary); }
  .dialog-btn.primary { border-color: var(--accent-dim); color: var(--accent); }
  .dialog-btn.primary:hover { border-color: var(--accent); }
  .dialog-btn.danger { border-color: var(--accent-red); color: var(--accent-red); }
  .dialog-btn.danger:hover { background: var(--accent-red); color: var(--text-primary); }
</style>
