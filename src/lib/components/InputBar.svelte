<script lang="ts">
  import { isStreaming, inputDisabled, selfCheckOpen, inventoryOpen } from '$lib/stores/gameStore';

  export let onSubmit: (input: string) => void;

  let inputValue = '';

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
</script>

<div class="input-bar">
  <!-- Self-check toggle -->
  <button
    class="side-btn self-btn"
    on:click={() => selfCheckOpen.update(v => !v)}
    title="自我視察"
    aria-label="自我視察"
    class:active={$selfCheckOpen}
  >
    自我<br/>視察
  </button>

  <!-- Input area -->
  <div class="input-area">
    <span class="prefix" aria-hidden="true">&gt;</span>
    <input
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

  <!-- Inventory toggle -->
  <button
    class="side-btn inv-btn"
    on:click={() => inventoryOpen.update(v => !v)}
    title="物品欄"
    aria-label="物品欄"
    class:active={$inventoryOpen}
  >
    INV
  </button>
</div>

<style>
  .input-bar {
    display: flex;
    align-items: stretch;
    height: var(--bottom-bar-h);
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
    grid-column: 1 / -1;
  }

  /* Side buttons */
  .side-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    text-align: center;
    line-height: 1.3;
  }

  .self-btn {
    width: var(--left-sidebar-w);
    border-right: 1px solid var(--border);
  }

  .inv-btn {
    width: 68px;
    border-left: 1px solid var(--border);
    border-right: none;
    font-size: 11px;
    letter-spacing: 0.1em;
  }

  .side-btn:hover,
  .side-btn.active {
    background: var(--bg-tertiary);
    color: var(--accent);
  }

  /* Input area */
  .input-area {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: var(--bg-input);
  }

  .prefix {
    color: var(--accent);
    font-size: 15px;
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

  .text-input::placeholder { color: var(--text-dim); }
  .text-input:disabled { opacity: 0.4; cursor: not-allowed; }

  .submit-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 14px;
    width: 30px;
    height: 26px;
    cursor: pointer;
    border-radius: 2px;
    flex-shrink: 0;
    transition: border-color 0.12s, color 0.12s;
  }

  .submit-btn:not(:disabled):hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .submit-btn:disabled { opacity: 0.2; cursor: not-allowed; }
</style>
