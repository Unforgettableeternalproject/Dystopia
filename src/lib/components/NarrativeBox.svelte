<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { narrativeLines, isStreaming } from '$lib/stores/gameStore';

  let scrollEl: HTMLDivElement;
  let autoScroll = true;

  // 當新內容出現時，自動滾到底部
  afterUpdate(() => {
    if (autoScroll && scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  function onScroll() {
    const el = scrollEl;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScroll = atBottom;
  }
</script>

<div class="narrative-box" bind:this={scrollEl} on:scroll={onScroll}>
  <div class="content">
    {#each $narrativeLines as line (line.id)}
      <p
        class="line line--{line.type}"
        class:streaming={line.isStreaming}
      >
        {#if line.type === 'player'}
          <span class="prompt">&gt;</span>{line.text.replace(/^> /, '')}
        {:else if line.type === 'system'}
          <span class="system-prefix">—</span>{line.text}
        {:else if line.type === 'rejected'}
          <span class="rejected-prefix">✕</span>{line.text}
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

<style>
  .narrative-box {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px 16px;
    scroll-behavior: smooth;
  }

  .content {
    max-width: 720px;
    margin: 0 auto;
  }

  .line {
    margin-bottom: 0.6em;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Narrative — 主要敘述 */
  .line--narrative {
    color: var(--text-primary);
    line-height: 1.85;
  }

  /* Player input echo */
  .line--player {
    color: var(--text-player);
    margin-top: 1.2em;
    margin-bottom: 0.3em;
    opacity: 0.85;
  }
  .prompt {
    margin-right: 6px;
    color: var(--accent);
  }

  /* System message */
  .line--system {
    color: var(--text-system);
    font-size: 12px;
    font-style: italic;
  }
  .system-prefix {
    margin-right: 6px;
    color: var(--text-dim);
  }

  /* Rejected action */
  .line--rejected {
    color: var(--accent-red);
    font-size: 13px;
  }
  .rejected-prefix {
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

  /* Fade-in for each new line */
  .line {
    animation: fadeIn 0.15s ease-out;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(3px); }
    to   { opacity: 1; transform: translateY(0); }
  }
</style>
