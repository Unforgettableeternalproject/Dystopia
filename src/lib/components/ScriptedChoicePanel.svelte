<script lang="ts">
  import { activeScriptedDialogue } from '$lib/stores/gameStore';

  export let onSelect: (choiceId: string) => void;
</script>

{#if $activeScriptedDialogue}
  {@const dialogue = $activeScriptedDialogue}
  <div class="choice-panel">
    <div class="npc-label">
      <span class="npc-name">{dialogue.npcName}</span>
      <span class="sep">·</span>
      <span class="hint">選擇回應</span>
    </div>

    <div class="choices">
      {#each dialogue.currentChoices as choice (choice.id)}
        <button
          class="choice-btn"
          on:click={() => onSelect(choice.id)}
        >
          {choice.text}
        </button>
      {/each}

      {#if dialogue.currentChoices.length === 0}
        <div class="auto-end">（繼續...）</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .choice-panel {
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
    padding: 8px 12px 10px;
  }

  .npc-label {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 7px;
  }

  .npc-name {
    font-size: 9px;
    color: var(--accent);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-family: var(--font-mono);
  }

  .sep {
    font-size: 9px;
    color: var(--text-dim);
  }

  .hint {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.06em;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .choice-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: left;
    padding: 7px 12px;
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.1s, color 0.1s, background 0.1s;
    line-height: 1.4;
  }

  .choice-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-tertiary));
  }

  .auto-end {
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
    padding: 4px 0;
  }
</style>
