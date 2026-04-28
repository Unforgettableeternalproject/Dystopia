<script lang="ts">
  import { afterUpdate } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { narrativeLines, isStreaming, inputDisabled, previousSnapshot, rewindAction, eventToast, acquisitionNotifs } from '$lib/stores/gameStore';

  let scrollEl: HTMLDivElement;
  let autoScroll  = true;
  let prevLineCount    = 0;
  let prevScrollHeight = 0;
  let showScrollBtn    = false;

  // Page-style scroll:
  // • New line added → scroll so new content appears near the top of viewport
  // • Streaming → follow cursor only when near the bottom edge
  afterUpdate(() => {
    if (!scrollEl) return;

    const lineCount = $narrativeLines.length;
    const sh = scrollEl.scrollHeight;
    const ch = scrollEl.clientHeight;

    if (!autoScroll) {
      showScrollBtn = sh - scrollEl.scrollTop - ch > 80;
      prevLineCount    = lineCount;
      prevScrollHeight = sh;
      return;
    }

    if (lineCount > prevLineCount && prevScrollHeight > 0) {
      // New paragraph — page-style: position viewport so new content starts near top
      const target = Math.max(0, prevScrollHeight - 20);
      scrollEl.scrollTop = target;
    } else if ($isStreaming) {
      // Streaming append — scroll only when cursor is near the bottom edge
      if (sh - scrollEl.scrollTop - ch < 100) {
        scrollEl.scrollTop = sh;
      }
    } else {
      // Non-streaming update (signals stripped, etc.) — stay at bottom
      scrollEl.scrollTop = sh;
    }

    showScrollBtn    = false;
    prevLineCount    = lineCount;
    prevScrollHeight = sh;
  });

  function onScroll() {
    if (!scrollEl) return;
    const sh = scrollEl.scrollHeight;
    const ch = scrollEl.clientHeight;
    const distFromBottom = sh - scrollEl.scrollTop - ch;
    autoScroll    = distFromBottom < 40;
    showScrollBtn = distFromBottom > 80;
  }

  function scrollToLatest() {
    if (!scrollEl) return;
    autoScroll = true;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    showScrollBtn = false;
  }

  // ── Edit last action ───────────────────────────────────────────

  let editingInline = false;
  let editText = '';
  let rewindModalOpen = false;
  let isRewinding = false;

  $: lastPlayerLineId = (() => {
    for (let i = $narrativeLines.length - 1; i >= 0; i--) {
      const t = $narrativeLines[i].type;
      if (t === 'player' || t === 'player-dialogue') return $narrativeLines[i].id;
    }
    return null;
  })();

  $: canEdit = !!$previousSnapshot && !$isStreaming && !$inputDisabled && !isRewinding && !editingInline;

  function startInlineEdit() {
    editText = $previousSnapshot?.originalInput ?? '';
    editingInline = true;
  }

  function cancelInlineEdit() {
    editingInline = false;
    editText = '';
  }

  function handleInlineKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmRewind(); }
    if (e.key === 'Escape') cancelInlineEdit();
  }

  async function confirmRewind() {
    if (!editText.trim() || !$rewindAction) return;
    editingInline = false;
    rewindModalOpen = true;
    isRewinding = true;
    await new Promise(r => setTimeout(r, 1400));
    rewindModalOpen = false;
    isRewinding = false;
    await $rewindAction(editText.trim());
  }
</script>

<div class="narrative-wrap">
  <div
    class="narrative-panel"
    class:rewind-active={isRewinding}
    bind:this={scrollEl}
    on:scroll={onScroll}
  >
    <div class="content">
      {#each $narrativeLines as line (line.id)}
        <p class="line line--{line.type}" class:streaming={line.isStreaming} class:thinking={line.type === 'system' && line.text === '···'} class:editing={line.id === lastPlayerLineId && editingInline}>
          {#if line.type === 'player'}
            {#if line.id === lastPlayerLineId && editingInline}
              <span class="prompt">&gt;</span>
              <input class="inline-edit-input" bind:value={editText} on:keydown={handleInlineKey} autofocus />
              <button class="inline-confirm" on:click={confirmRewind} disabled={!editText.trim()} title="確認">✓</button>
              <button class="inline-cancel" on:click={cancelInlineEdit} title="取消">✗</button>
            {:else}
              <span class="prompt">&gt;</span>{line.text.replace(/^> /, '')}
              {#if line.id === lastPlayerLineId && canEdit}
                <button class="edit-btn" on:click={startInlineEdit} title="重新考慮此行動">✎</button>
              {/if}
            {/if}
          {:else if line.type === 'player-dialogue'}
            {#if line.id === lastPlayerLineId && editingInline}
              <input class="inline-edit-input" bind:value={editText} on:keydown={handleInlineKey} autofocus />
              <button class="inline-confirm" on:click={confirmRewind} disabled={!editText.trim()} title="確認">✓</button>
              <button class="inline-cancel" on:click={cancelInlineEdit} title="取消">✗</button>
            {:else}
              {line.text}
              {#if line.id === lastPlayerLineId && canEdit}
                <button class="edit-btn" on:click={startInlineEdit} title="重新考慮此行動">✎</button>
              {/if}
            {/if}
          {:else if line.type === 'system'}
            <span class="sys-prefix">—</span>{line.text}
          {:else if line.type === 'rejected'}
            <span class="rej-prefix">✕</span>{line.text}
          {:else}
            {line.text}
          {/if}
          {#if line.isStreaming}<span class="cursor" aria-hidden="true">▊</span>{/if}
        </p>
      {/each}

      {#if $narrativeLines.length === 0}
        <p class="line line--system">正在載入...</p>
      {/if}
    </div>
  </div>

  {#if $eventToast}
    <div class="event-toast toast--{$eventToast.variant}">
      {$eventToast.label}
    </div>
  {/if}

  {#if $acquisitionNotifs.length > 0}
    <div class="acq-notif-stack">
      {#each $acquisitionNotifs as notif (notif.id)}
        <div class="acq-notif" class:acq-notif--gain={notif.gain} class:acq-notif--loss={!notif.gain}>
          {notif.label}
        </div>
      {/each}
    </div>
  {/if}

  {#if showScrollBtn}
    <button class="scroll-btn" on:click={scrollToLatest} title="回到最新">↓</button>
  {/if}

  {#if rewindModalOpen}
    <div class="rewind-overlay" transition:fade={{duration: 120}}>
      <div class="rewind-modal" transition:fly={{y: 8, duration: 250}}>
        <div class="rewind-clock">◴</div>
        <p class="rewind-label">REWINDING</p>
        <div class="rewind-scanline"></div>
        <p class="rewind-wip">⚠ 此功能仍在開發測試階段</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .narrative-wrap {
    position: relative;
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .narrative-panel {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px 12px;
    scroll-behavior: auto; /* no smooth — page-style jumps need to be instant */
  }

  .content {
    max-width: 660px;
    margin: 0 auto;
  }

  /* Line variants */
  .line {
    margin-bottom: 0.55em;
    white-space: pre-wrap;
    word-break: break-word;
    animation: fadeIn 0.12s ease-out;
  }

  .line--narrative {
    color: var(--text-primary);
    line-height: 1.85;
  }

  /* NPC scripted dialogue: slightly warmer tone, subtle left indicator */
  .line--dialogue {
    color: #b8a882;
    line-height: 1.85;
    padding-left: 10px;
    border-left: 2px solid var(--accent-dim);
    margin-left: 2px;
  }

  .line--player {
    color: var(--text-player);
    margin-top: 1em;
    margin-bottom: 0.25em;
    opacity: 0.85;
  }

  .line--player-dialogue {
    color: var(--text-player);
    margin-top: 1em;
    margin-bottom: 0.25em;
    opacity: 0.85;
  }

  .prompt {
    margin-right: 6px;
    color: var(--accent);
  }

  /* Story encounter description: gray, stage-direction style */
  .line--scene {
    color: #8a8a8a;
    line-height: 1.85;
    font-style: italic;
  }

  /* Event-triggered narration: blue, matching the event toast */
  .line--event {
    color: #5fa8d3;
    line-height: 1.85;
  }

  /* Prop interaction encounter: warm amber — player-initiated tactile interaction */
  .line--interact {
    color: #c4a85a;
    line-height: 1.85;
  }

  .line--system {
    color: var(--text-system);
    font-size: 12px;
    font-style: italic;
  }

  .thinking {
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50%      { opacity: 0.9; }
  }

  .sys-prefix {
    margin-right: 6px;
    color: var(--text-dim);
  }

  .line--rejected {
    color: var(--accent-red);
    font-size: 13px;
  }

  .rej-prefix {
    margin-right: 6px;
  }

  /* Streaming cursor */
  .cursor {
    display: inline-block;
    animation: blink 0.7s step-end infinite;
    color: var(--accent);
    margin-left: 1px;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(2px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Event toast — base */
  .event-toast {
    position: absolute;
    top: 8px;
    right: 12px;
    background: var(--bg-tertiary);
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    padding: 6px 16px;
    border-radius: 2px;
    border: 1px solid transparent;
    z-index: 10;
    pointer-events: none;
    animation: toastIn 0.18s ease-out, toastOut 0.3s ease-in 4.7s forwards;
  }

  /* Variant colours */
  .toast--normal   { color: #5fa8d3; border-color: #5fa8d355; }
  .toast--negative { color: #d4a017; border-color: #d4a01755; }
  .toast--danger   { color: #d35f5f; border-color: #d35f5f55; }

  /* Rare — gold, 7 s, glow pulse */
  .toast--rare {
    color: #c9a227;
    border-color: #c9a22770;
    background: color-mix(in srgb, var(--bg-tertiary) 88%, #c9a227 12%);
    animation:
      toastIn    0.18s ease-out,
      rarePulse  2s   ease-in-out 0.2s infinite,
      toastOut   0.3s ease-in 6.7s forwards;
  }

  @keyframes toastIn {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes toastOut {
    from { opacity: 1; }
    to   { opacity: 0; }
  }

  @keyframes rarePulse {
    0%, 100% { box-shadow: 0 0 4px #c9a22730; }
    50%       { box-shadow: 0 0 12px #c9a22780, 0 0 24px #c9a22740; }
  }

  /* Acquisition notification stack — bottom-right, stacks upward */
  .acq-notif-stack {
    position: absolute;
    bottom: 44px;
    right: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-end;
    pointer-events: none;
    z-index: 9;
  }

  .acq-notif {
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.04em;
    padding: 4px 12px;
    border-radius: 2px;
    border-left: 2px solid transparent;
    background: var(--bg-tertiary);
    animation: acqIn 0.15s ease-out, acqOut 0.25s ease-in 3.2s forwards;
    white-space: nowrap;
  }

  .acq-notif--gain {
    color: #5fd38a;
    border-color: #5fd38a;
  }

  .acq-notif--loss {
    color: #d4a017;
    border-color: #d4a017;
  }

  @keyframes acqIn {
    from { opacity: 0; transform: translateX(8px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  @keyframes acqOut {
    from { opacity: 1; }
    to   { opacity: 0; }
  }

  /* Edit-last-action button */
  .edit-btn {
    display: inline-block;
    margin-left: 8px;
    padding: 0 4px;
    background: transparent;
    border: 1px solid var(--border-accent);
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.4;
    cursor: pointer;
    border-radius: 2px;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, border-color 0.15s;
    vertical-align: middle;
  }

  .line--player:hover .edit-btn,
  .line--player-dialogue:hover .edit-btn {
    opacity: 1;
  }

  .edit-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  /* Inline edit input */
  .inline-edit-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--accent-dim);
    color: var(--text-player);
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    padding: 0 2px;
    width: min(320px, 60%);
    outline: none;
    vertical-align: baseline;
  }

  .inline-edit-input:focus {
    border-bottom-color: var(--accent);
  }

  .inline-confirm,
  .inline-cancel {
    display: inline-block;
    margin-left: 6px;
    padding: 0 5px;
    background: transparent;
    border: 1px solid transparent;
    font-size: 12px;
    cursor: pointer;
    border-radius: 2px;
    vertical-align: middle;
    transition: color 0.12s, border-color 0.12s;
  }

  .inline-confirm {
    color: var(--accent);
    border-color: var(--accent-dim);
  }

  .inline-confirm:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .inline-confirm:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .inline-cancel {
    color: var(--text-dim);
    border-color: var(--border-muted);
  }

  .inline-cancel:hover {
    color: var(--accent-red);
    border-color: var(--accent-red);
  }

  /* Rewind flash on content */
  @keyframes rewindFlash {
    0%   { opacity: 1;   filter: none; }
    15%  { opacity: 0.6; filter: brightness(1.8) saturate(0); }
    35%  { opacity: 0.2; filter: brightness(2.5) saturate(0) hue-rotate(120deg); }
    60%  { opacity: 0.5; filter: brightness(0.7) saturate(0); }
    80%  { opacity: 0.8; filter: brightness(1.2); }
    100% { opacity: 1;   filter: none; }
  }

  .narrative-panel.rewind-active .content {
    animation: rewindFlash 1.4s ease-in-out;
    pointer-events: none;
  }

  /* Rewind animation overlay */
  .rewind-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20;
  }

  .rewind-modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 3px;
    padding: 28px 36px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
    min-width: 200px;
  }

  @keyframes spinClock {
    0%   { content: '◴'; }
    25%  { content: '◷'; }
    50%  { content: '◶'; }
    75%  { content: '◵'; }
    100% { content: '◴'; }
  }

  @keyframes clockSpin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(-360deg); }
  }

  .rewind-clock {
    font-size: 32px;
    color: var(--accent);
    animation: clockSpin 0.8s linear infinite;
    display: inline-block;
    line-height: 1;
  }

  @keyframes rewindPulse {
    0%, 100% { opacity: 0.5; letter-spacing: 0.25em; }
    50%       { opacity: 1;   letter-spacing: 0.35em; }
  }

  .rewind-label {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.25em;
    color: var(--accent);
    text-transform: uppercase;
    margin: 0;
    animation: rewindPulse 0.9s ease-in-out infinite;
  }

  @keyframes scanMove {
    0%   { top: 0%; opacity: 0.6; }
    100% { top: 100%; opacity: 0; }
  }

  .rewind-scanline {
    position: relative;
    width: 100%;
    height: 1px;
    background: var(--accent);
    opacity: 0.5;
    animation: scanMove 0.7s linear infinite;
    margin: 2px 0;
  }

  .rewind-wip {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--text-dim);
    margin: 4px 0 0;
    opacity: 0.6;
  }

  /* "Back to latest" button */
  .scroll-btn {
    position: absolute;
    bottom: 8px;
    right: 12px;
    width: 28px;
    height: 28px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-accent);
    color: var(--text-secondary);
    font-size: 14px;
    cursor: pointer;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.75;
    transition: opacity 0.15s;
    animation: fadeIn 0.15s ease-out;
  }

  .scroll-btn:hover {
    opacity: 1;
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
