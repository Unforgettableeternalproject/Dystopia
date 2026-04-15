<script lang="ts">
  import type { Thought } from '$lib/types';

  export let thought: Thought;
  export let onSelect: (thought: Thought) => void;
</script>

<button
  class="thought"
  class:manipulated={thought.isManipulated}
  on:click={() => onSelect(thought)}
  title={thought.isManipulated ? '（這個想法感覺不太對）' : undefined}
>
  {#if thought.isManipulated}
    <span class="manipulated-icon" aria-hidden="true">⚠</span>
  {/if}
  {thought.text}
</button>

<style>
  .thought {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-thought);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 6px 14px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    white-space: nowrap;
    border-radius: 2px;
  }

  .thought:hover {
    background: var(--bg-secondary);
    border-color: var(--accent-blue);
    color: var(--text-primary);
  }

  .thought:active {
    background: var(--accent-dim);
  }

  /* 被外力操控的 Thought */
  .thought.manipulated {
    border-color: var(--accent-red);
    color: var(--accent-red);
    opacity: 0.8;
  }
  .thought.manipulated:hover {
    opacity: 1;
  }

  .manipulated-icon {
    margin-right: 5px;
    font-size: 10px;
  }
</style>
