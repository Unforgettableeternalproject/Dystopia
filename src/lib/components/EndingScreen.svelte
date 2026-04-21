<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { endingType } from '$lib/stores/gameStore';

  const dispatch = createEventDispatcher<{ restart: void; toTitle: void }>();

  const CONTENT = {
    mvp_complete: {
      label:    'MVP — 演示完成',
      title:    '你離開了戴司',
      flavor:   '閘門在你身後緩緩關閉。瓦爾象限的機械轟鳴聲從四面八方湧來，比你記憶中的任何聲音都更真實。你不知道前方等待著什麼——但戴司已經消失在身後的陰影裡了。',
      epilogue: '感謝遊玩 Dystopia 的 MVP 演示版本。',
    },
    death: {
      label:    '結局 — 死亡',
      title:    '你死了',
      flavor:   '體力耗盡，身體再也撐不住了。戴司的走廊沒有人在意倒下的人——他們只是踩過，繼續走向下一個配額站。',
      epilogue: '這裡是 Dystopia MVP 的終點。',
    },
    collapse: {
      label:    '結局 — 精神崩潰',
      title:    '你崩潰了',
      flavor:   '壓力在某一刻超過了臨界點。腦海中的聲音越來越大，然後突然一片空白。當你再次意識到自己的存在時，你已經不知道身在何處，也想不起來為什麼要撐下去。',
      epilogue: '這裡是 Dystopia MVP 的終點。',
    },
  } as const;

  $: content = CONTENT[$endingType ?? 'death'];
</script>

<div class="ending-backdrop">
  <div class="ending-panel">
    <div class="ending-label">{content.label}</div>
    <h1 class="ending-title">{content.title}</h1>
    <p class="ending-flavor">{content.flavor}</p>
    <p class="ending-epilogue">{content.epilogue}</p>

    <div class="ending-actions">
      <button class="btn-primary" on:click={() => dispatch('restart')}>重新開始</button>
      <button class="btn-secondary" on:click={() => dispatch('toTitle')}>回到主選單</button>
    </div>
  </div>
</div>

<style>
  .ending-backdrop {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: var(--bg-primary, #0a0a0a);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 1.2s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .ending-panel {
    max-width: 520px;
    width: 90%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    text-align: center;
    animation: slideUp 1s ease-out 0.3s both;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .ending-label {
    font-size: 10px;
    letter-spacing: 0.2em;
    color: var(--text-dim, #555);
    text-transform: uppercase;
    font-family: var(--font-mono);
  }

  .ending-title {
    font-size: 32px;
    font-weight: 400;
    color: var(--text-primary, #d0c8c0);
    letter-spacing: 0.06em;
    margin: 0;
    font-family: var(--font-mono);
  }

  .ending-flavor {
    font-size: 13px;
    color: var(--text-secondary, #888);
    line-height: 1.8;
    margin: 0;
    max-width: 420px;
  }

  .ending-epilogue {
    font-size: 10px;
    color: var(--text-dim, #555);
    letter-spacing: 0.1em;
    margin: 0;
    font-family: var(--font-mono);
  }

  .ending-actions {
    display: flex;
    gap: 12px;
    margin-top: 12px;
  }

  button {
    padding: 8px 24px;
    font-size: 11px;
    letter-spacing: 0.1em;
    border-radius: 2px;
    cursor: pointer;
    font-family: var(--font-mono);
    transition: all 0.15s;
    border: 1px solid;
  }

  .btn-primary {
    background: transparent;
    color: var(--text-primary, #d0c8c0);
    border-color: var(--border-accent, #555);
  }

  .btn-primary:hover {
    background: var(--bg-tertiary, #1a1a1a);
    border-color: var(--text-secondary, #888);
  }

  .btn-secondary {
    background: transparent;
    color: var(--text-dim, #555);
    border-color: var(--border, #333);
  }

  .btn-secondary:hover {
    color: var(--text-secondary, #888);
    border-color: var(--border-accent, #555);
  }
</style>
