<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { questDetailOpen } from '$lib/stores/gameStore';
  import type { GameController } from '$lib/engine/GameController';

  export let controller: GameController;

  function close() { questDetailOpen.set(null); }
  function handleBg(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  const TYPE_LABEL: Record<string, string> = {
    main:   '主線',
    side:   '支線',
    hidden: '隱藏',
  };

  let showAbandonConfirm = false;

  function requestAbandon() { showAbandonConfirm = true; }
  function cancelAbandon()  { showAbandonConfirm = false; }

  function confirmAbandon() {
    const q = $questDetailOpen;
    if (!q) return;
    const ok = controller.abandonQuest(q.questId);
    if (ok) close();
    showAbandonConfirm = false;
  }

  $: canAbandon = $questDetailOpen?.canAbandon ?? false;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click={handleBg}>
  <aside class="modal-panel" transition:fly={{ y: -8, duration: 200, easing: cubicOut }} role="dialog" aria-label="任務詳情">
    {#if $questDetailOpen}
      {@const q = $questDetailOpen}
      <div class="modal-header">
        <div class="header-left">
          <span class="type-badge type-{q.type}">{TYPE_LABEL[q.type] ?? q.type}</span>
          <span class="modal-title">{q.name}</span>
        </div>
        <button class="close-btn" on:click={close} aria-label="關閉">✕</button>
      </div>

      <div class="modal-body">
        <div class="stage-label">當前階段</div>
        <p class="stage-desc">{q.stageSummary}</p>

        {#if q.objectives.length > 0}
          <div class="obj-label">目標</div>
          <ul class="obj-list">
            {#each q.objectives as obj, i}
              <li
                class="obj-item"
                class:done={obj.completed}
                style={!obj.completed ? `animation-delay: ${i * 90}ms` : undefined}
              >
                <span class="obj-check">{obj.completed ? '✓' : '○'}</span>
                <span class="obj-text">{obj.description}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      {#if canAbandon}
        <div class="modal-footer">
          {#if showAbandonConfirm}
            <span class="abandon-confirm-text">確定要放棄此任務？</span>
            <button class="footer-btn danger" on:click={confirmAbandon}>確定放棄</button>
            <button class="footer-btn" on:click={cancelAbandon}>取消</button>
          {:else}
            <button class="footer-btn abandon" on:click={requestAbandon}>放棄任務</button>
          {/if}
        </div>
      {/if}
    {/if}
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
  }

  /* ── Header ───────────────────────────────── */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-tertiary);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .modal-title {
    font-size: 13px;
    color: var(--text-primary);
    font-weight: 500;
    letter-spacing: 0.03em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .type-badge {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 2px;
    border: 1px solid;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }

  .type-main   { color: var(--accent);   border-color: var(--accent);   opacity: 0.9; }
  .type-side   { color: var(--text-dim); border-color: var(--border);   opacity: 0.8; }
  .type-hidden { color: #8b6a9a;         border-color: #8b6a9a;         opacity: 0.8; }

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

  /* ── Body ─────────────────────────────────── */
  .modal-body {
    padding: 14px 16px;
    overflow-y: auto;
    flex: 1;
  }

  .stage-label,
  .obj-label {
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .obj-label {
    margin-top: 16px;
  }

  .stage-desc {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.65;
    margin: 0;
  }

  /* ── Objectives ───────────────────────────── */
  .obj-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  @keyframes objNewGlow {
    0%   { opacity: 0; text-shadow: 0 0 10px rgba(201, 169, 110, 0.8); color: #c9a96e; }
    30%  { opacity: 1; text-shadow: 0 0 6px rgba(201, 169, 110, 0.5); color: #c9a96e; }
    100% { opacity: 1; text-shadow: none; color: var(--text-secondary); }
  }

  .obj-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .obj-item:not(.done) {
    animation: objNewGlow 1.4s ease-out both;
  }

  .obj-item.done {
    color: var(--text-dim);
    opacity: 0.6;
  }

  .obj-item.done .obj-text {
    text-decoration: line-through;
    text-decoration-color: var(--text-dim);
  }

  .obj-check {
    flex-shrink: 0;
    width: 14px;
    font-size: 10px;
    margin-top: 1px;
  }

  .obj-item.done .obj-check {
    color: var(--accent);
    opacity: 0.7;
  }

  .obj-item:not(.done) .obj-check {
    color: var(--text-dim);
  }

  /* ── Footer (abandon) ─────────────────────── */
  .modal-footer {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    background: var(--bg-tertiary);
    flex-shrink: 0;
  }

  .abandon-confirm-text {
    font-size: 10px;
    color: var(--text-dim);
    flex: 1;
    font-family: var(--font-mono);
  }

  .footer-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 4px 12px;
    background: transparent;
    border: 1px solid var(--border-accent);
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 2px;
    letter-spacing: 0.04em;
    transition: background 0.1s, color 0.1s;
  }

  .footer-btn:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .footer-btn.abandon {
    color: var(--accent-red, #c0392b);
    border-color: color-mix(in srgb, var(--accent-red, #c0392b) 40%, var(--border));
    opacity: 0.7;
    transition: opacity 0.1s, background 0.1s, color 0.1s;
  }

  .footer-btn.abandon:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--accent-red, #c0392b) 10%, transparent);
  }

  .footer-btn.danger {
    border-color: var(--accent-red, #c0392b);
    color: var(--accent-red, #c0392b);
  }

  .footer-btn.danger:hover {
    background: var(--accent-red, #c0392b);
    color: var(--text-primary);
  }


</style>
