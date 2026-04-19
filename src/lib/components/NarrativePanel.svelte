<script lang="ts">
  import { afterUpdate } from 'svelte';
  import { narrativeLines, isStreaming } from '$lib/stores/gameStore';

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
</script>

<div class="narrative-wrap">
  <div
    class="narrative-panel"
    bind:this={scrollEl}
    on:scroll={onScroll}
  >
    <div class="content">
      {#each $narrativeLines as line (line.id)}
        <p class="line line--{line.type}" class:streaming={line.isStreaming}>
          {#if line.type === 'player'}
            <span class="prompt">&gt;</span>{line.text.replace(/^> /, '')}
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

  {#if showScrollBtn}
    <button class="scroll-btn" on:click={scrollToLatest} title="回到最新">↓</button>
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

  .prompt {
    margin-right: 6px;
    color: var(--accent);
  }

  .line--system {
    color: var(--text-system);
    font-size: 12px;
    font-style: italic;
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
