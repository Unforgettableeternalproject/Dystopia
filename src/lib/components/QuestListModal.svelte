<script lang="ts">
  import { playerUI, questListOpen, questDetailOpen } from '$lib/stores/gameStore';

  function close() { questListOpen.set(false); }
  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  const TYPE_LABEL: Record<string, string> = {
    main:   '主',
    side:   '支',
    hidden: '隱',
  };
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" on:click={handleBg}>
  <aside class="modal-panel" role="dialog" aria-label="全部任務">
    <div class="modal-header">
      <span class="modal-title">任務</span>
      <span class="quest-count">{$playerUI.totalActiveQuestCount ?? 0} 個進行中</span>
      <button class="close-btn" on:click={close} aria-label="關閉">✕</button>
    </div>

    <div class="modal-body">
      {#if $playerUI.allActiveQuestSummaries && $playerUI.allActiveQuestSummaries.length > 0}
        {#each $playerUI.allActiveQuestSummaries as q}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="quest-row" on:click={() => { questDetailOpen.set(q); close(); }}>
            <div class="quest-name">
              <span class="quest-type-badge quest-type-{q.type}">{TYPE_LABEL[q.type] ?? q.type}</span>
              {q.name}
            </div>
            <div class="quest-stage">{q.stageSummary}</div>
          </div>
        {/each}
      {:else}
        <div class="empty">沒有進行中的任務</div>
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
    width: 360px;
    max-height: 480px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: fadeSlideIn 0.14s ease-out;
  }

  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
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

  .quest-count {
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

  /* ── Body ─────────────────────────────── */
  .modal-body {
    padding: 8px 10px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .quest-row {
    padding: 6px 6px;
    border-radius: 2px;
    cursor: pointer;
    transition: background 0.12s;
    border: 1px solid transparent;
  }

  .quest-row:hover {
    background: var(--bg-tertiary);
    border-color: var(--border);
  }

  .quest-name {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .quest-type-badge {
    font-size: 8px;
    padding: 0px 4px;
    border-radius: 2px;
    letter-spacing: 0.05em;
    flex-shrink: 0;
    border: 1px solid;
  }

  .quest-type-main   { color: var(--accent);   border-color: var(--accent);   opacity: 0.85; }
  .quest-type-side   { color: var(--text-dim); border-color: var(--border);   opacity: 0.75; }
  .quest-type-hidden { color: #8b6a9a;         border-color: #8b6a9a;         opacity: 0.75; }

  .quest-stage {
    font-size: 9px;
    color: var(--text-dim);
    margin-top: 2px;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty {
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
    padding: 8px 4px;
  }
</style>
