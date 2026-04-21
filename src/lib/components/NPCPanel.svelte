<script lang="ts">
  import { activeNpcUI, activeScriptedDialogue, isStreaming } from '$lib/stores/gameStore';

  export let onLeave: () => void = () => {};

  const ATTITUDE_COLOR: Record<string, string> = {
    friendly: '#4a7a4a',
    neutral:  'var(--text-dim)',
    cautious: '#7a6a3a',
    hostile:  'var(--accent-red)',
  };

  const ATTITUDE_LABEL: Record<string, string> = {
    friendly: '友好',
    neutral:  '中立',
    cautious: '警惕',
    hostile:  '敵對',
  };

  const NPC_TYPE_LABEL: Record<string, string> = {
    hub:     '據點型',
    quest:   '任務型',
    roaming: '遊歷型',
  };

  $: npc = $activeNpcUI;
  $: attitudeColor = npc ? (ATTITUDE_COLOR[npc.attitude] ?? 'var(--text-dim)') : '';
  $: initial = npc ? npc.name.charAt(0).toUpperCase() : '';
</script>

{#if npc}
  <aside class="npc-panel">
    <!-- Portrait -->
    <div class="portrait">
      <div class="avatar">{initial}</div>
    </div>

    <!-- Name + type -->
    <div class="npc-header">
      <div class="npc-name">{npc.name}</div>
      <div class="npc-type">{NPC_TYPE_LABEL[npc.type] ?? npc.type}</div>
    </div>

    <!-- Description -->
    <div class="npc-desc">{npc.publicDescription}</div>

    <!-- Relationship stats -->
    <div class="rel-section">
      <div class="rel-row">
        <span class="rel-label">好感</span>
        <span class="rel-val" class:pos={npc.affinity > 0} class:neg={npc.affinity < 0}>
          {npc.affinity > 0 ? '+' : ''}{npc.affinity}
        </span>
      </div>
      <div class="rel-row">
        <span class="rel-label">態度</span>
        <span class="rel-val" style="color:{attitudeColor}">
          {ATTITUDE_LABEL[npc.attitude] ?? npc.attitude}
        </span>
      </div>
      {#if npc.interactionCount > 0}
        <div class="rel-row">
          <span class="rel-label">互動</span>
          <span class="rel-val">{npc.interactionCount} 次</span>
        </div>
      {/if}
    </div>

    <!-- Exit button: hidden during scripted dialogue, disabled while DM is streaming -->
    {#if !$activeScriptedDialogue}
      <div class="exit-section">
        <button class="exit-btn" on:click={onLeave} disabled={$isStreaming}>結束對話</button>
      </div>
    {/if}
  </aside>
{/if}

<style>
  .npc-panel {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-left: 1px solid var(--border);
    background: var(--bg-secondary);
    animation: slideIn 0.15s ease-out;
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateX(8px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  /* Portrait */
  .portrait {
    padding: 14px 10px 10px;
    display: flex;
    justify-content: center;
    border-bottom: 1px solid var(--border);
  }

  .avatar {
    width: 52px;
    height: 52px;
    border-radius: 2px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    color: var(--text-secondary);
    font-weight: 300;
    letter-spacing: 0;
  }

  /* Header */
  .npc-header {
    padding: 8px 10px 6px;
    border-bottom: 1px solid var(--border);
  }

  .npc-name {
    font-size: 12px;
    color: var(--text-primary);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .npc-type {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.06em;
    margin-top: 1px;
  }

  /* Description */
  .npc-desc {
    padding: 8px 10px;
    font-size: 10px;
    color: var(--text-secondary);
    line-height: 1.55;
    border-bottom: 1px solid var(--border);
    overflow-y: auto;
    max-height: 100px;
  }

  /* Relationship */
  .rel-section {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .rel-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .rel-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
  }

  .rel-val {
    font-size: 10px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .rel-val.pos { color: #4a7a4a; }
  .rel-val.neg { color: var(--accent-red); }

  /* Exit */
  .exit-section {
    padding: 8px 10px;
    margin-top: auto;
    border-top: 1px solid var(--border);
  }

  .exit-btn {
    width: 100%;
    padding: 5px 0;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    cursor: pointer;
    border-radius: 2px;
    transition: border-color 0.12s, color 0.12s;
  }

  .exit-btn:hover:not(:disabled) {
    border-color: var(--accent-red);
    color: var(--accent-red);
  }

  .exit-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
