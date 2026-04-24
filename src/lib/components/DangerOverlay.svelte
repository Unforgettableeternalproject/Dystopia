<script lang="ts">
  import { derived } from 'svelte/store';
  import { playerUI, gamePhase } from '$lib/stores/gameStore';

  const isLowHp = derived(playerUI, ($p) =>
    $p.staminaMax > 0 && $p.stamina / $p.staminaMax < 0.2
  );
  const isHighStress = derived(playerUI, ($p) =>
    $p.stressMax > 0 && $p.stress / $p.stressMax >= 0.8
  );

  // [left%, width(px), height(px), shape, delay(s), dur(s), opacity-seed]
  // shape: 0=rect, 1=triangle↑, 2=diamond, 3=hexagon
  const shapes: [number, number, number, number, number, number, number][] = [
    [1,  52, 34, 0, 0.0, 3.2, 0],
    [6,  28, 58, 1, 0.4, 2.8, 1],
    [13, 65, 26, 2, 0.2, 3.5, 2],
    [20, 38, 48, 0, 0.8, 2.6, 3],
    [27, 32, 32, 3, 0.1, 3.8, 4],
    [34, 58, 52, 1, 0.6, 2.9, 0],
    [41, 26, 68, 0, 0.3, 3.1, 1],
    [47, 72, 36, 2, 0.9, 2.7, 2],
    [54, 40, 50, 0, 0.5, 3.4, 3],
    [60, 44, 28, 1, 0.2, 3.0, 4],
    [66, 30, 60, 3, 0.7, 2.8, 0],
    [72, 62, 38, 0, 0.4, 3.6, 1],
    [78, 46, 32, 2, 0.1, 2.5, 2],
    [84, 34, 56, 0, 0.8, 3.2, 3],
    [90, 50, 44, 1, 0.3, 3.0, 4],
    [96, 28, 62, 0, 0.6, 2.9, 0],
    // second (deeper) layer — slightly wider, more transparent
    [4,  82, 22, 0, 1.0, 4.0, 1],
    [17, 55, 36, 2, 1.2, 3.7, 2],
    [30, 48, 52, 1, 1.5, 3.3, 3],
    [43, 68, 28, 0, 1.1, 4.1, 4],
    [56, 36, 44, 3, 1.4, 3.6, 0],
    [69, 58, 26, 0, 1.3, 3.9, 1],
    [82, 50, 46, 2, 1.6, 3.4, 2],
    [93, 32, 56, 1, 1.0, 3.8, 3],
  ];

  function clipPath(shape: number): string {
    switch (shape) {
      case 1: return 'polygon(50% 0%, 0% 100%, 100% 100%)';
      case 2: return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      case 3: return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
      default: return 'none';
    }
  }

  // opacity cycling: 0→4 gives five tiers
  const opacityTier = [0.72, 0.62, 0.80, 0.68, 0.76];
</script>

<!-- Only shown during gameplay -->
{#if $gamePhase === 'playing'}

  {#if $isLowHp}
    <div class="overlay hp-danger" aria-hidden="true"></div>
  {/if}

  {#if $isHighStress}
    <div class="overlay stress-danger" aria-hidden="true">
      {#each shapes as [left, w, h, shape, delay, dur, opSeed]}
        <div
          class="geo-shape"
          style="
            left: {left}%;
            width: {w}px;
            height: {h}px;
            clip-path: {clipPath(shape)};
            animation-delay: {delay}s;
            animation-duration: {dur}s;
            opacity: {opacityTier[opSeed]};
          "
        ></div>
      {/each}
    </div>
  {/if}

{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 500;
  }

  /* ── HP danger: red flickering vignette ──────────────────────── */
  .hp-danger {
    animation: hp-flicker 2.2s ease-in-out infinite;
  }

  @keyframes hp-flicker {
    0%   { box-shadow: inset 0 0 40px rgba(210, 18, 18, 0.30), inset 0 0 90px rgba(180, 0, 0, 0.12); }
    18%  { box-shadow: inset 0 0 65px rgba(230, 25, 25, 0.70), inset 0 0 130px rgba(200, 0, 0, 0.38), inset 0 0 180px rgba(150, 0, 0, 0.16); }
    30%  { box-shadow: inset 0 0 32px rgba(190, 12, 12, 0.22), inset 0 0 75px rgba(160, 0, 0, 0.09); }
    55%  { box-shadow: inset 0 0 70px rgba(225, 30, 30, 0.75), inset 0 0 140px rgba(200, 0, 0, 0.40); }
    72%  { box-shadow: inset 0 0 45px rgba(200, 20, 20, 0.35), inset 0 0 100px rgba(170, 0, 0, 0.15); }
    88%  { box-shadow: inset 0 0 58px rgba(220, 22, 22, 0.55), inset 0 0 120px rgba(190, 0, 0, 0.28); }
    100% { box-shadow: inset 0 0 40px rgba(210, 18, 18, 0.30), inset 0 0 90px rgba(180, 0, 0, 0.12); }
  }

  /* ── Stress danger: dark geometric shapes at screen bottom ───── */
  .stress-danger {
    overflow: hidden;
  }

  .geo-shape {
    position: absolute;
    bottom: 0;
    background: rgba(8, 6, 10, 0.85);
    animation: shape-drift ease-in-out infinite alternate;
  }

  @keyframes shape-drift {
    0%   { transform: translateY(0px)   skewX(0deg)  scaleX(1.00); }
    33%  { transform: translateY(-14px) skewX(1.5deg) scaleX(1.02); }
    66%  { transform: translateY(-6px)  skewX(-1deg)  scaleX(0.98); }
    100% { transform: translateY(-20px) skewX(2deg)  scaleX(1.01); }
  }
</style>
