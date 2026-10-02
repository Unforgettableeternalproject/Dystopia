<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { journalEntries, journalOpen, journalUnread } from '$lib/stores/gameStore';
  import type { JournalCategory, JournalEntry, JournalTime } from '$lib/types/journal';

  // 開著日誌時不累積未讀
  $: if ($journalOpen) journalUnread.set(false);

  function close() { journalOpen.set(false); }
  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  const CATEGORY_LABEL: Record<JournalCategory, string> = {
    stats:     '數值',
    social:    '聲望好感',
    quest:     '任務',
    event:     '事件遭遇',
    item:      '物品',
    intel:     '情報',
    condition: '狀態',
    rest:      '休息',
    choice:    '選擇',
    location:  '地點',
  };
  const FILTERS: Array<JournalCategory | 'all'> = [
    'all', 'stats', 'social', 'quest', 'event', 'item', 'intel', 'condition', 'rest', 'choice', 'location',
  ];

  let filter: JournalCategory | 'all' = 'all';

  // 由新到舊
  $: visible = ([...$journalEntries].reverse() as JournalEntry[])
    .filter(e => filter === 'all' || e.category === filter);

  const pad = (n: number) => n.toString().padStart(2, '0');
  function formatTime(t: JournalTime): string {
    return `${t.month}/${t.day} ${pad(t.hour)}:${pad(t.minute)}`;
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click={handleBg}>
  <aside class="modal-panel" transition:fly={{ y: -8, duration: 200, easing: cubicOut }} role="dialog" aria-label="日誌">
    <div class="modal-header">
      <span class="modal-title">日誌</span>
      <span class="entry-count">最近 {$journalEntries.length} 筆</span>
      <button class="close-btn" on:click={close} aria-label="關閉">✕</button>
    </div>

    <div class="filter-bar">
      {#each FILTERS as f}
        <button
          class="filter-btn"
          class:active={filter === f}
          on:click={() => { filter = f; }}
        >{f === 'all' ? '全部' : CATEGORY_LABEL[f]}</button>
      {/each}
    </div>

    <div class="modal-body">
      {#if visible.length > 0}
        {#each visible as entry (entry.id)}
          <div class="entry-row">
            <div class="entry-meta">
              <span class="entry-time">{formatTime(entry.time)}</span>
              <span class="entry-badge cat-{entry.category}">{CATEGORY_LABEL[entry.category]}</span>
            </div>
            <div class="entry-text">{entry.text}</div>
            {#if entry.source}
              <div class="entry-source">來自：{entry.source}</div>
            {/if}
          </div>
        {/each}
      {:else}
        <div class="empty">{filter === 'all' ? '尚無紀錄' : '此類別尚無紀錄'}</div>
      {/if}
    </div>
  </aside>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-panel {
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 2px;
    width: 440px;
    max-height: 560px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ───────────────────────────── */
  .modal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-tertiary);
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 13px;
    color: var(--text-primary);
    font-weight: 500;
    letter-spacing: 0.03em;
    flex: 1;
  }

  .entry-count {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
    flex-shrink: 0;
    transition: color 0.1s;
  }

  .close-btn:hover { color: var(--text-primary); }

  /* ── Filter bar ───────────────────────── */
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .filter-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    padding: 2px 7px;
    border-radius: 2px;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .filter-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .filter-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-tertiary);
  }

  /* ── Body ─────────────────────────────── */
  .modal-body {
    padding: 8px 10px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-row {
    padding: 6px 6px;
    border-radius: 2px;
    border: 1px solid transparent;
    border-bottom-color: var(--border);
  }

  .entry-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .entry-time {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }

  .entry-badge {
    font-size: 8px;
    padding: 0px 4px;
    border-radius: 2px;
    letter-spacing: 0.05em;
    border: 1px solid var(--border);
    color: var(--text-dim);
  }

  .cat-quest, .cat-choice { color: var(--accent); border-color: var(--accent); opacity: 0.85; }
  .cat-event              { color: var(--accent-blue, #4a7aaa); border-color: var(--accent-blue, #4a7aaa); }
  .cat-item, .cat-intel   { color: var(--accent-green, #5fd38a); border-color: var(--accent-green, #5fd38a); opacity: 0.85; }
  .cat-condition          { color: var(--accent-red, #c0392b); border-color: var(--accent-red, #c0392b); opacity: 0.85; }

  .entry-text {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 3px;
    line-height: 1.5;
    word-break: break-word;
  }

  .entry-source {
    font-size: 9px;
    color: var(--text-dim);
    margin-top: 2px;
    line-height: 1.4;
    opacity: 0.8;
  }

  .empty {
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
    padding: 8px 4px;
  }
</style>
