<script lang="ts">
  import { thoughts, isStreaming, inputDisabled } from '$lib/stores/gameStore';
  import ThoughtBubble from './ThoughtBubble.svelte';
  import type { Thought } from '$lib/types';

  export let onSelect: (thought: Thought) => void;
</script>

{#if $thoughts.length > 0}
  <div class="thoughts-panel">
    <span class="label" aria-label="想法">想法</span>
    <div class="list">
      {#each $thoughts as thought (thought.id)}
        <ThoughtBubble
          {thought}
          onSelect={(t) => {
            if (!$inputDisabled && !$isStreaming) onSelect(t);
          }}
        />
      {/each}
    </div>
  </div>
{/if}

<style>
  .thoughts-panel {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    border-top: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
    background: var(--bg-primary);
  }

  .thoughts-panel::-webkit-scrollbar {
    height: 2px;
  }

  .label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    flex-shrink: 0;
    user-select: none;
  }

  .list {
    display: flex;
    gap: 5px;
    flex-wrap: nowrap;
  }
</style>
