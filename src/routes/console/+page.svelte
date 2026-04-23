<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import {
    traceEntries,
    listenForTraces,
    clearTraces,
    exportTraces,
  } from '$lib/stores/traceStore';
  import { logEntries, exportLog, clearLog, listenForLogs } from '$lib/utils/Logger';
  import { save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import type { TraceEntry, TracePhase } from '$lib/stores/traceStore';
  import type { LogEntry } from '$lib/utils/Logger';

  let cleanup: (() => void) | null = null;
  let logCleanup: (() => void) | null = null;
  let activeTab: 'traces' | 'log' = 'traces';
  let expandedTraces = new Set<number>();
  let expandedPhases = new Set<string>();  // "traceId-phaseName"
  let autoScroll = true;
  let filterText = '';
  let traceContainer: HTMLElement;
  let logContainer: HTMLElement;

  // Level filter for log tab
  let logLevelFilter: 'all' | 'debug' | 'info' | 'warn' | 'error' = 'all';

  // Export toast
  let exportToast = '';
  let exportToastTimeout: ReturnType<typeof setTimeout> | null = null;
  function showToast(msg: string) {
    exportToast = msg;
    if (exportToastTimeout) clearTimeout(exportToastTimeout);
    exportToastTimeout = setTimeout(() => { exportToast = ''; }, 3000);
  }

  onMount(() => {
    cleanup = listenForTraces();
    logCleanup = listenForLogs();
    document.title = 'Dystopia Console';
  });

  onDestroy(() => {
    cleanup?.();
    logCleanup?.();
  });

  // Auto-scroll on new entries
  $: if (autoScroll && $traceEntries.length && traceContainer) {
    requestAnimationFrame(() => traceContainer?.scrollTo(0, traceContainer.scrollHeight));
  }
  $: if (autoScroll && $logEntries.length && logContainer) {
    requestAnimationFrame(() => logContainer?.scrollTo(0, logContainer.scrollHeight));
  }

  // Filtered traces
  $: filteredTraces = filterText
    ? $traceEntries.filter(t =>
        t.label.toLowerCase().includes(filterText.toLowerCase()) ||
        t.type.includes(filterText.toLowerCase()) ||
        t.phases.some(p =>
          p.name.includes(filterText.toLowerCase()) ||
          (p.raw?.toLowerCase().includes(filterText.toLowerCase()) ?? false) ||
          (p.error?.toLowerCase().includes(filterText.toLowerCase()) ?? false) ||
          JSON.stringify(p.data).toLowerCase().includes(filterText.toLowerCase())
        )
      )
    : $traceEntries;

  // Filtered log entries
  $: filteredLogs = (() => {
    let logs = $logEntries;
    if (logLevelFilter !== 'all') logs = logs.filter(l => l.level === logLevelFilter);
    if (filterText) {
      const f = filterText.toLowerCase();
      logs = logs.filter(l =>
        l.message.toLowerCase().includes(f) ||
        l.tag.toLowerCase().includes(f) ||
        (l.detail ? JSON.stringify(l.detail).toLowerCase().includes(f) : false)
      );
    }
    return logs;
  })();

  function toggleTrace(id: number) {
    if (expandedTraces.has(id)) expandedTraces.delete(id);
    else expandedTraces.add(id);
    expandedTraces = expandedTraces;  // trigger reactivity
  }

  function togglePhase(key: string) {
    if (expandedPhases.has(key)) expandedPhases.delete(key);
    else expandedPhases.add(key);
    expandedPhases = expandedPhases;
  }

  function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function phaseIcon(name: string): string {
    switch (name) {
      case 'input':       return '>';
      case 'regulator':   return 'R';
      case 'context':     return 'C';
      case 'dm-phase1':   return 'D1';
      case 'judge':       return 'J';
      case 'dm-phase2':   return 'D2';
      case 'resolution':  return '=';
      case 'effects':     return 'FX';
      case 'error':       return '!';
      default:            return '?';
    }
  }

  function phaseColor(name: string, hasError: boolean): string {
    if (hasError) return '#ff4444';
    switch (name) {
      case 'input':       return '#6ec6ff';
      case 'regulator':   return '#ffa726';
      case 'context':     return '#888';
      case 'dm-phase1':   return '#ab47bc';
      case 'judge':       return '#66bb6a';
      case 'dm-phase2':   return '#ab47bc';
      case 'resolution':  return '#42a5f5';
      case 'effects':     return '#ffca28';
      default:            return '#999';
    }
  }

  function levelColor(level: string): string {
    switch (level) {
      case 'debug': return '#666';
      case 'info':  return '#6ec6ff';
      case 'warn':  return '#ffa726';
      case 'error': return '#ff4444';
      default:      return '#999';
    }
  }

  function formatData(data: unknown): string {
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }

  async function handleExport() {
    const content = activeTab === 'traces' ? exportTraces() : exportLog();
    const ext = activeTab === 'traces' ? 'json' : 'log';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `dystopia-${activeTab}-${ts}.${ext}`;

    try {
      const filePath = await saveDialog({
        defaultPath: filename,
        filters: [{ name: ext === 'json' ? 'JSON' : 'Log', extensions: [ext] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, content);
      showToast(`已匯出：${filePath.split(/[\\/]/).pop()}`);
    } catch (err) {
      showToast(`匯出失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleClear() {
    if (activeTab === 'traces') {
      clearTraces();
      expandedTraces = new Set();
      expandedPhases = new Set();
    } else {
      clearLog();
    }
  }

  function expandAll() {
    for (const t of filteredTraces) expandedTraces.add(t.id);
    expandedTraces = expandedTraces;
  }

  function collapseAll() {
    expandedTraces = new Set();
    expandedPhases = new Set();
  }
</script>

<div class="console-root">
  <!-- Header -->
  <div class="console-header">
    <span class="console-title">終端控制台</span>
    <div class="console-actions">
      <input
        class="console-filter"
        bind:value={filterText}
        placeholder="進行查詢..."
      />
      <label class="auto-scroll-toggle">
        <input type="checkbox" bind:checked={autoScroll} />
        自動捲動
      </label>
    </div>
  </div>

  <!-- Tab bar + controls -->
  <div class="console-toolbar">
    <div class="tab-group">
      <button
        class="console-tab"
        class:active={activeTab === 'traces'}
        on:click={() => (activeTab = 'traces')}
      >
        追蹤
        <span class="tab-count">{$traceEntries.length}</span>
      </button>
      <button
        class="console-tab"
        class:active={activeTab === 'log'}
        on:click={() => (activeTab = 'log')}
      >
        日誌
        <span class="tab-count">{$logEntries.length}</span>
      </button>
    </div>

    <div class="toolbar-right">
      {#if activeTab === 'traces'}
        <button class="console-btn" on:click={expandAll} title="展開全部">
          [+]
        </button>
        <button class="console-btn" on:click={collapseAll} title="收合全部">
          [-]
        </button>
      {:else}
        <select class="level-select" bind:value={logLevelFilter}>
          <option value="all">所有等級</option>
          <option value="debug">除錯</option>
          <option value="info">資訊</option>
          <option value="warn">警告</option>
          <option value="error">錯誤</option>
        </select>
      {/if}
      <button class="console-btn export" on:click={handleExport}>匯出日誌</button>
      <button class="console-btn clear" on:click={handleClear}>清除日誌</button>
    </div>
  </div>

  <!-- Content -->
  <div class="console-content">
    {#if activeTab === 'traces'}
      <div class="trace-list" bind:this={traceContainer}>
        {#if filteredTraces.length === 0}
          <div class="empty-state">
            {#if $traceEntries.length === 0}
              等待來自應用程式的堆疊追蹤…
            {:else}
              沒有符合篩選條件的追蹤。
            {/if}
          </div>
        {/if}
        {#each filteredTraces as trace (trace.id)}
          {@const hasError = trace.phases.some(p => p.error)}
          <div class="trace-entry" class:has-error={hasError}>
            <!-- Trace header -->
            <button
              class="trace-header"
              on:click={() => toggleTrace(trace.id)}
            >
              <span class="trace-expand">{expandedTraces.has(trace.id) ? 'v' : '>'}</span>
              <span class="trace-time">{formatTimestamp(trace.timestamp)}</span>
              <span class="trace-type" class:exploration={trace.type === 'exploration'}
                    class:dialogue={trace.type === 'dialogue'}
                    class:event={trace.type === 'event'}
                    class:system={trace.type === 'system'}
              >{trace.type}</span>
              <span class="trace-turn">T{trace.turn}</span>
              <span class="trace-label">{trace.label}</span>
              {#if trace.locationId}
                <span class="trace-loc">@ {trace.locationId}</span>
              {/if}
              <!-- Phase summary pills -->
              <span class="phase-pills">
                {#each trace.phases as phase}
                  <span
                    class="phase-pill"
                    style="color: {phaseColor(phase.name, !!phase.error)}"
                    title="{phase.name}{phase.error ? ' (ERROR)' : ''}"
                  >{phaseIcon(phase.name)}</span>
                {/each}
              </span>
            </button>

            <!-- Expanded phases -->
            {#if expandedTraces.has(trace.id)}
              <div class="trace-phases">
                {#each trace.phases as phase, i}
                  {@const phaseKey = `${trace.id}-${phase.name}-${i}`}
                  <div class="phase-entry">
                    <button
                      class="phase-header"
                      on:click={() => togglePhase(phaseKey)}
                    >
                      <span class="phase-expand">{expandedPhases.has(phaseKey) ? 'v' : '>'}</span>
                      <span class="phase-badge" style="background: {phaseColor(phase.name, !!phase.error)}">{phaseIcon(phase.name)}</span>
                      <span class="phase-name">{phase.name}</span>
                      <span class="phase-time">{formatTimestamp(phase.timestamp)}</span>
                      {#if phase.error}
                        <span class="phase-error-badge">ERROR</span>
                      {/if}
                    </button>

                    {#if expandedPhases.has(phaseKey)}
                      <div class="phase-detail">
                        {#if phase.error}
                          <div class="detail-section error-section">
                            <span class="detail-label">Error</span>
                            <pre class="detail-pre error">{phase.error}</pre>
                          </div>
                        {/if}
                        {#if phase.raw}
                          <div class="detail-section">
                            <span class="detail-label">Raw LLM Response</span>
                            <pre class="detail-pre raw">{phase.raw}</pre>
                          </div>
                        {/if}
                        <div class="detail-section">
                          <span class="detail-label">Data</span>
                          <pre class="detail-pre">{formatData(phase.data)}</pre>
                        </div>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <!-- Log tab -->
      <div class="log-list" bind:this={logContainer}>
        {#if filteredLogs.length === 0}
          <div class="empty-state">
            {#if $logEntries.length === 0}
              目前沒有任何日誌條目。
            {:else}
              沒有符合篩選條件的日誌條目。
            {/if}
          </div>
        {/if}
        {#each filteredLogs as entry (entry.id)}
          <div class="log-entry" class:log-warn={entry.level === 'warn'} class:log-error={entry.level === 'error'}>
            <span class="log-time">{formatTimestamp(entry.timestamp)}</span>
            <span class="log-level" style="color: {levelColor(entry.level)}">{entry.level.toUpperCase().padEnd(5)}</span>
            <span class="log-tag">[{entry.tag}]</span>
            <span class="log-msg">{entry.message}</span>
            {#if entry.detail !== undefined}
              <pre class="log-detail">{typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail, null, 2)}</pre>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Status bar -->
  <div class="console-status">
    <span>
      {#if activeTab === 'traces'}
        {filteredTraces.length} / {$traceEntries.length} 堆疊追蹤
      {:else}
        {filteredLogs.length} / {$logEntries.length} 日誌條目
      {/if}
    </span>
    <span class="status-right">
      BroadcastChannel: {cleanup ? '已連線' : '未連線'}
    </span>
  </div>

  <!-- Export toast -->
  {#if exportToast}
    <div class="export-toast" transition:fade={{ duration: 150 }}>{exportToast}</div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #0a0a0a;
    overflow: hidden;
  }

  .console-root {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace;
    font-size: 12px;
    color: #c8c8c8;
    background: #0a0a0a;
  }

  /* Header */
  .console-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: #1a1a2e;
    border-bottom: 1px solid #2a2a3e;
    flex-shrink: 0;
  }

  .console-title {
    font-size: 13px;
    font-weight: 600;
    color: #e0e0e0;
    letter-spacing: 0.5px;
  }

  .console-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .console-filter {
    background: #111;
    border: 1px solid #333;
    color: #ccc;
    padding: 3px 8px;
    font-size: 11px;
    font-family: inherit;
    border-radius: 3px;
    width: 160px;
  }
  .console-filter:focus {
    outline: none;
    border-color: #555;
  }

  .auto-scroll-toggle {
    font-size: 11px;
    color: #888;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .auto-scroll-toggle input { margin: 0; cursor: pointer; }

  /* Toolbar */
  .console-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    background: #111;
    border-bottom: 1px solid #222;
    flex-shrink: 0;
  }

  .tab-group {
    display: flex;
    gap: 2px;
  }

  .console-tab {
    background: transparent;
    border: none;
    color: #777;
    padding: 4px 12px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .console-tab:hover { color: #aaa; }
  .console-tab.active {
    color: #e0e0e0;
    border-bottom-color: #6ec6ff;
  }

  .tab-count {
    font-size: 10px;
    color: #555;
    margin-left: 4px;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .console-btn {
    background: #1a1a1a;
    border: 1px solid #333;
    color: #aaa;
    padding: 3px 10px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    border-radius: 3px;
  }
  .console-btn:hover { background: #222; color: #ddd; }
  .console-btn.export { color: #6ec6ff; border-color: #3a5a7a; }
  .console-btn.export:hover { background: #1a2a3a; }
  .console-btn.clear { color: #ff6b6b; border-color: #5a2a2a; }
  .console-btn.clear:hover { background: #3a1a1a; }

  .level-select {
    background: #1a1a1a;
    border: 1px solid #333;
    color: #aaa;
    padding: 3px 6px;
    font-size: 11px;
    font-family: inherit;
    border-radius: 3px;
  }

  /* Content */
  .console-content {
    flex: 1;
    overflow: hidden;
  }

  .trace-list, .log-list {
    height: 100%;
    overflow-y: auto;
    padding: 4px 0;
  }

  .empty-state {
    text-align: center;
    color: #555;
    padding: 40px;
    font-style: italic;
  }

  /* Trace entries */
  .trace-entry {
    border-bottom: 1px solid #1a1a1a;
  }
  .trace-entry.has-error {
    border-left: 3px solid #ff4444;
  }

  .trace-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    background: transparent;
    border: none;
    color: #c8c8c8;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  .trace-header:hover { background: #151515; }

  .trace-expand {
    color: #555;
    width: 12px;
    flex-shrink: 0;
  }

  .trace-time {
    color: #555;
    font-size: 11px;
    flex-shrink: 0;
  }

  .trace-type {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .trace-type.exploration { background: #1a2a3a; color: #6ec6ff; }
  .trace-type.dialogue    { background: #2a1a3a; color: #bb86fc; }
  .trace-type.event       { background: #3a2a1a; color: #ffa726; }
  .trace-type.system      { background: #1a1a1a; color: #888; }

  .trace-turn {
    color: #666;
    font-size: 11px;
    flex-shrink: 0;
  }

  .trace-label {
    color: #ddd;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .trace-loc {
    color: #555;
    font-size: 11px;
    flex-shrink: 0;
  }

  .phase-pills {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .phase-pill {
    font-size: 10px;
    font-weight: 700;
  }

  /* Phases */
  .trace-phases {
    padding: 0 0 4px 24px;
    background: #0d0d0d;
  }

  .phase-entry {
    border-left: 1px solid #222;
    margin-left: 8px;
  }

  .phase-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: transparent;
    border: none;
    color: #aaa;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  .phase-header:hover { background: #151515; }

  .phase-expand {
    color: #444;
    width: 10px;
    flex-shrink: 0;
  }

  .phase-badge {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 2px;
    color: #000;
    font-weight: 700;
    flex-shrink: 0;
  }

  .phase-name {
    color: #aaa;
  }

  .phase-time {
    color: #444;
    font-size: 10px;
    margin-left: auto;
  }

  .phase-error-badge {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 2px;
    background: #5a1a1a;
    color: #ff6b6b;
    font-weight: 700;
  }

  /* Phase detail */
  .phase-detail {
    padding: 4px 8px 8px 28px;
  }

  .detail-section {
    margin-bottom: 6px;
  }

  .detail-label {
    font-size: 10px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: block;
    margin-bottom: 2px;
  }

  .detail-pre {
    background: #111;
    border: 1px solid #222;
    padding: 6px 8px;
    margin: 0;
    font-size: 11px;
    color: #bbb;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
    border-radius: 3px;
  }
  .detail-pre.raw {
    color: #999;
    border-color: #2a2a2a;
  }
  .detail-pre.error {
    color: #ff6b6b;
    border-color: #5a2a2a;
    background: #1a0a0a;
  }

  .error-section {
    margin-bottom: 8px;
  }

  /* Log entries */
  .log-entry {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    padding: 2px 12px;
    font-size: 11px;
  }
  .log-entry:hover { background: #111; }
  .log-entry.log-warn { background: rgba(255, 167, 38, 0.05); }
  .log-entry.log-error { background: rgba(255, 68, 68, 0.05); }

  .log-time {
    color: #444;
    flex-shrink: 0;
  }

  .log-level {
    font-weight: 600;
    font-size: 10px;
    flex-shrink: 0;
    width: 42px;
  }

  .log-tag {
    color: #6ec6ff;
    flex-shrink: 0;
  }

  .log-msg {
    color: #ccc;
  }

  .log-detail {
    width: 100%;
    background: #111;
    border: 1px solid #1a1a1a;
    padding: 4px 8px;
    margin: 2px 0 2px 70px;
    font-size: 10px;
    color: #888;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    border-radius: 3px;
  }

  /* Status bar */
  .console-status {
    display: flex;
    justify-content: space-between;
    padding: 3px 12px;
    background: #111;
    border-top: 1px solid #222;
    font-size: 10px;
    color: #555;
    flex-shrink: 0;
  }

  .status-right { color: #444; }

  /* Scrollbar */
  .trace-list::-webkit-scrollbar,
  .log-list::-webkit-scrollbar,
  .detail-pre::-webkit-scrollbar,
  .log-detail::-webkit-scrollbar {
    width: 6px;
  }
  .trace-list::-webkit-scrollbar-thumb,
  .log-list::-webkit-scrollbar-thumb,
  .detail-pre::-webkit-scrollbar-thumb,
  .log-detail::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
  }
  .trace-list::-webkit-scrollbar-track,
  .log-list::-webkit-scrollbar-track,
  .detail-pre::-webkit-scrollbar-track,
  .log-detail::-webkit-scrollbar-track {
    background: transparent;
  }

  /* Export toast */
  .export-toast {
    position: fixed;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a2a3a;
    border: 1px solid #3a5a7a;
    color: #6ec6ff;
    font-size: 11px;
    font-family: inherit;
    padding: 6px 16px;
    border-radius: 3px;
    z-index: 100;
    pointer-events: none;
  }
</style>
