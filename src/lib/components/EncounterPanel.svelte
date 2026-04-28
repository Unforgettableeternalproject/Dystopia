<script lang="ts">
  import { activeEncounterUI } from '$lib/stores/gameStore';
  import type { EncounterType } from '$lib/types/encounter';

  export let onSelect: (choiceId: string) => void;

  // Type-specific visual config
  const typeConfig: Record<EncounterType, { label: string; icon: string; accent: string }> = {
    story:    { label: '劇情',   icon: '◇', accent: '#c9a96e' },  // amber
    event:    { label: '事件',   icon: '◈', accent: '#5fa8d3' },  // blue
    dialogue: { label: '對話',   icon: '◎', accent: '#7ec8a0' },  // teal
    combat:   { label: '戰鬥',   icon: '◆', accent: '#d35f5f' },  // red
    shop:     { label: '商店',   icon: '◉', accent: '#7ec87e' },  // green
    transit:  { label: '轉移',   icon: '⬡', accent: '#9b8abf' },  // purple
    interact: { label: '互動',   icon: '◌', accent: '#c4a85a' },  // warm gold
  };

  $: enc = $activeEncounterUI;
  $: cfg = enc ? typeConfig[enc.type] : typeConfig.event;
</script>

{#if enc}
  <div class="encounter-panel" style="--enc-accent: {cfg.accent}">

    <!-- Type header strip -->
    <div class="enc-header">
      <span class="enc-icon">{cfg.icon}</span>
      <span class="enc-type">{cfg.label}遭遇</span>
      <span class="enc-sep">·</span>
      <span class="enc-name">{enc.encounterName}</span>
    </div>

    <!-- Stat check result badge (if present) -->
    {#if enc.statCheckResult}
      {@const chk = enc.statCheckResult}
      <div class="stat-check" class:passed={chk.passed} class:failed={!chk.passed}>
        <span class="chk-icon">{chk.passed ? '▲' : '▼'}</span>
        <span class="chk-text">
          {chk.passed ? '判定成功' : '判定失敗'}
          — {chk.stat.split('.').pop()} {chk.passed ? '≥' : '<'} DC {chk.dc}
        </span>
      </div>
    {/if}

    <!-- Content by type -->
    {#if enc.type === 'event' || enc.type === 'interact'}
      <!-- Event / Prop interaction: prominent choice buttons -->
      <div class="choices event-choices">
        {#each enc.choices as choice (choice.id)}
          <button class="choice-btn event-btn" on:click={() => onSelect(choice.id)}>
            <span class="choice-arrow">›</span>
            <span class="choice-text">{choice.text}</span>
          </button>
        {/each}
        {#if enc.choices.length === 0}
          <div class="no-choices">（場景繼續中...）</div>
        {/if}
      </div>

    {:else if enc.type === 'combat'}
      <!-- Combat: stub -->
      <div class="stub-panel">
        <span class="stub-icon">◆</span>
        <p class="stub-text">戰鬥系統尚未實裝</p>
      </div>

    {:else if enc.type === 'shop'}
      <!-- Shop: stub -->
      <div class="stub-panel">
        <span class="stub-icon">◉</span>
        <p class="stub-text">商店系統尚未實裝</p>
      </div>

    {:else}
      <!-- Fallback (dialogue type routes through NPC system) -->
      <div class="no-choices">（處理中...）</div>
    {/if}

  </div>
{/if}

<style>
  /* ── Container ───────────────────────────────────────────── */
  .encounter-panel {
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }

  /* ── Header strip ────────────────────────────────────────── */
  .enc-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 5px;
    background: color-mix(in srgb, var(--enc-accent) 6%, var(--bg-tertiary));
    border-bottom: 1px solid color-mix(in srgb, var(--enc-accent) 25%, var(--border));
    border-left: 2px solid var(--enc-accent);
    flex-shrink: 0;
  }

  .enc-icon {
    font-size: 9px;
    color: var(--enc-accent);
    flex-shrink: 0;
  }

  .enc-type {
    font-size: 9px;
    color: var(--enc-accent);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-family: var(--font-mono);
    flex-shrink: 0;
    opacity: 0.85;
  }

  .enc-sep {
    font-size: 9px;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .enc-name {
    font-size: 10px;
    color: var(--text-secondary);
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Stat check badge ────────────────────────────────────── */
  .stat-check {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    font-family: var(--font-mono);
    font-size: 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .stat-check.passed {
    background: color-mix(in srgb, #5fa8d3 8%, transparent);
    color: #5fa8d3;
  }

  .stat-check.failed {
    background: color-mix(in srgb, #d35f5f 8%, transparent);
    color: #d35f5f;
  }

  .chk-icon { font-size: 8px; }

  /* ── Story (script) type ────────────────────────────────── */
  .story-script {
    padding: 10px 16px 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    overflow-y: auto;
  }

  .script-narrator {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.7;
    font-style: italic;
    margin: 0;
  }

  .script-dialogue {
    font-size: 12px;
    line-height: 1.6;
    margin: 0;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }

  .script-speaker {
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .script-player { color: var(--text-primary); }
  .script-player .script-speaker { color: var(--enc-accent); }

  .script-npc { color: var(--text-secondary); }
  .script-npc .script-speaker { color: var(--text-dim); }

  /* ── Story / narrative action ────────────────────────────── */
  .narrative-action {
    padding: 6px 12px 10px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .continue-btn {
    align-self: flex-end;
    min-width: 80px;
    text-align: center;
  }

  .skip-btn {
    align-self: flex-end;
    min-width: 80px;
    text-align: center;
    opacity: 0.6;
  }

  .skip-btn:hover {
    opacity: 1;
  }

  /* ── Event type ──────────────────────────────────────────── */
  .event-choices {
    padding: 8px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .event-btn {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    text-align: left;
  }

  .choice-arrow {
    color: var(--enc-accent);
    font-size: 12px;
    flex-shrink: 0;
    margin-top: 1px;
    opacity: 0.7;
  }

  .choice-text {
    flex: 1;
  }

  /* ── Shared choice button ────────────────────────────────── */
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
    padding: 7px 12px;
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.1s, color 0.1s, background 0.1s;
    line-height: 1.4;
  }

  .choice-btn:hover {
    border-color: var(--enc-accent);
    color: var(--text-primary);
    background: color-mix(in srgb, var(--enc-accent) 8%, var(--bg-tertiary));
  }

  /* ── Stub (combat / shop) ────────────────────────────────── */
  .stub-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    gap: 8px;
  }

  .stub-icon {
    font-size: 20px;
    color: var(--enc-accent);
    opacity: 0.4;
  }

  .stub-text {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    margin: 0;
    letter-spacing: 0.06em;
  }

  /* ── Empty state ─────────────────────────────────────────── */
  .no-choices {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
  }
</style>
