<script lang="ts">
  import { thoughts, isStreaming, inputDisabled } from '$lib/stores/gameStore';
  import ThoughtBubble from './ThoughtBubble.svelte';
  import type { Thought } from '$lib/types';

  export let onSubmit: (input: string) => void;

  let inputValue = '';
  let inputEl: HTMLInputElement;

  function handleSubmit() {
    const val = inputValue.trim();
    if (!val || $inputDisabled || $isStreaming) return;
    onSubmit(val);
    inputValue = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function selectThought(thought: Thought) {
    if ($inputDisabled || $isStreaming) return;
    onSubmit(thought.text);
  }
</script>

<div class="choice-panel">
  <!-- Thought Bubbles -->
  {#if $thoughts.length > 0}
    <div class="thoughts-row">
      <span class="thoughts-label">想法</span>
      <div class="thoughts-list">
        {#each $thoughts as thought (thought.id)}
          <ThoughtBubble {thought} onSelect={selectThought} />
        {/each}
      </div>
    </div>
  {/if}

  <!-- Input Row -->
  <div class="input-row">
    <span class="input-prefix" aria-hidden="true">&gt;</span>
    <input
      bind:this={inputEl}
      bind:value={inputValue}
      on:keydown={handleKeydown}
      disabled={$inputDisabled || $isStreaming}
      placeholder={$isStreaming ? '' : '輸入行動...'}
      class="text-input"
      autocomplete="off"
      spellcheck="false"
    />
    <button
      class="submit-btn"
      on:click={handleSubmit}
      disabled={$inputDisabled || $isStreaming || !inputValue.trim()}
      aria-label="送出"
    >
      ↵
    </button>
  </div>
</div>

<style>
  .choice-panel {
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  /* Thoughts row */
  .thoughts-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px 6px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  .thoughts-row::-webkit-scrollbar {
    height: 2px;
  }

  .thoughts-label {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    flex-shrink: 0;
    user-select: none;
  }

  .thoughts-list {
    display: flex;
    gap: 6px;
    flex-wrap: nowrap;
  }

  /* Input row */
  .input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    height: var(--input-height);
  }

  .input-prefix {
    color: var(--accent);
    font-size: 16px;
    font-family: var(--font-mono);
    flex-shrink: 0;
    user-select: none;
  }

  .text-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 14px;
    caret-color: var(--accent);
  }

  .text-input::placeholder {
    color: var(--text-dim);
  }

  .text-input:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .submit-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 14px;
    width: 32px;
    height: 28px;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s;
    flex-shrink: 0;
    border-radius: 2px;
  }

  .submit-btn:not(:disabled):hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .submit-btn:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }
</style>
