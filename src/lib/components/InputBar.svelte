<script lang="ts">
  import { isStreaming, inputDisabled, selfCheckOpen, inventoryOpen, activeScriptedDialogue, activeNpcUI, activeEncounterUI, storyTypingActive, isSaving } from '$lib/stores/gameStore';

  $: inScriptedDialogue = $activeScriptedDialogue !== null;
  $: inEncounter        = $activeNpcUI !== null;
  $: inEventEncounter   = $activeEncounterUI !== null;
  $: inStoryEncounter   = $activeEncounterUI?.type === 'story';

  export let onSubmit:  (input: string) => void;
  export let onAdvance: () => void;
  export let onSkip:    () => void;

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
  <div class="input-area" class:encounter={inEncounter && !inScriptedDialogue} class:story={inStoryEncounter}>
    {#if inStoryEncounter}
      <!-- Story encounter: centered continue / skip button -->
      {#if $storyTypingActive}
        <button class="story-action-btn story-skip" on:click={onSkip}>跳過</button>
      {:else}
        <button class="story-action-btn" on:click={onAdvance}>繼續</button>
      {/if}
    {:else}
      {#if !inScriptedDialogue}
        <span class="prefix" class:enc-prefix={inEncounter} aria-hidden="true">
          {inEncounter ? '「' : '>'}
        </span>
      {/if}
      <input
        bind:value={inputValue}
        on:keydown={handleKeydown}
        disabled={$inputDisabled || $isStreaming || inScriptedDialogue || inEventEncounter}
        placeholder={inScriptedDialogue
          ? '對話進行中...'
          : inEventEncounter
            ? '請從選項中做出選擇...'
            : inEncounter
              ? `對 ${$activeNpcUI?.name} 說...`
              : $isStreaming ? '' : '輸入行動...'}
        class="text-input"
        autocomplete="off"
        spellcheck="false"
      />
      {#if $isSaving}
        <span class="saving-badge">存檔中</span>
      {/if}
      <button
        class="submit-btn"
        on:click={handleSubmit}
        disabled={$inputDisabled || $isStreaming || inScriptedDialogue || inEventEncounter || !inputValue.trim()}
        aria-label="送出"
      >
        ↵
      </button>
    {/if}
  </div>

  <!-- Inventory toggle -->
  <button
    class="side-btn inv-btn"
    on:click={() => inventoryOpen.update(v => !v)}
    title="物品欄"
    aria-label="物品欄"
    class:active={$inventoryOpen}
  >
    背包
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
    width: var(--right-outer-w);
    border-left: 1px solid var(--border);
    border-right: none;
    font-size: 11px;
    letter-spacing: 0.1em;
  }

  .saving-badge {
    font-size: 9px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    flex-shrink: 0;
    animation: savePulse 1s ease-in-out infinite;
  }

  @keyframes savePulse {
    0%, 100% { opacity: 0.4; }
    50%       { opacity: 1; }
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
    transition: background 0.25s ease;
  }

  .input-area.encounter {
    background: color-mix(in srgb, var(--accent-dim) 15%, var(--bg-input));
  }

  .prefix {
    color: var(--accent);
    font-size: 15px;
    font-family: var(--font-mono);
    flex-shrink: 0;
    user-select: none;
    transition: color 0.2s ease;
  }

  .prefix.enc-prefix {
    font-size: 17px;
    color: var(--accent);
    opacity: 0.85;
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

  /* Story encounter mode */
  .input-area.story {
    justify-content: center;
    background: color-mix(in srgb, #c9a96e 6%, var(--bg-input));
  }

  .story-action-btn {
    background: var(--bg-tertiary);
    border: 1px solid color-mix(in srgb, #c9a96e 40%, transparent);
    color: #c9a96e;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    padding: 5px 32px;
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.12s, background 0.12s;
  }

  .story-action-btn:hover {
    border-color: #c9a96e;
    background: color-mix(in srgb, #c9a96e 10%, var(--bg-tertiary));
  }

  .story-skip {
    opacity: 0.55;
  }

  .story-skip:hover {
    opacity: 1;
  }
</style>
