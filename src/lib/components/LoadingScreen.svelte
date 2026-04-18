<script lang="ts">
  import { warmupStatus } from '$lib/utils/ModelWarmup';

  const STATUS_TEXT: Record<string, string> = {
    idle:    '準備中...',
    running: '正在初始化模型...',
    ready:   '模型就緒，進入世界...',
    failed:  '模型初始化失敗，嘗試繼續...',
  };

  let dots = '';
  let interval: ReturnType<typeof setInterval>;

  import { onMount, onDestroy } from 'svelte';
  onMount(() => {
    interval = setInterval(() => {
      dots = dots.length >= 3 ? '' : dots + '.';
    }, 400);
  });
  onDestroy(() => clearInterval(interval));
</script>

<div class="loading-screen">
  <div class="content">
    <div class="game-title">DYSTOPIA</div>
    <div class="loading-bar-wrap">
      <div class="loading-bar" class:ready={$warmupStatus === 'ready'}></div>
    </div>
    <div class="status-text">{STATUS_TEXT[$warmupStatus] ?? '準備中...'}{dots}</div>
  </div>
</div>

<style>
  .loading-screen {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    min-width: 300px;
  }

  .game-title {
    font-size: 36px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--text-primary);
    font-family: var(--font-mono);
    opacity: 0.6;
  }

  .loading-bar-wrap {
    width: 220px;
    height: 2px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
  }

  .loading-bar {
    height: 100%;
    width: 40%;
    background: var(--accent);
    border-radius: 2px;
    animation: sweep 1.4s ease-in-out infinite;
  }

  .loading-bar.ready {
    width: 100%;
    animation: none;
    transition: width 0.3s ease;
  }

  @keyframes sweep {
    0%   { transform: translateX(-150%); }
    100% { transform: translateX(350%); }
  }

  .status-text {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    min-width: 200px;
    text-align: center;
  }
</style>
