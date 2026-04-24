<script lang="ts">
  import { derived } from 'svelte/store';
  import { playerUI, gamePhase } from '$lib/stores/gameStore';

  const isLowHp = derived(playerUI, ($p) =>
    $p.staminaMax > 0 && $p.stamina / $p.staminaMax < 0.2
  );
  const isHighStress = derived(playerUI, ($p) =>
    $p.stressMax > 0 && $p.stress / $p.stressMax >= 0.8
  );

  // Particle descriptor
  // [left%, size(px), shape(0=rect 1=tri 2=diamond 3=para), delay(s), dur(s), drift(px), rotate(deg), strokeOpacity]
  type P = [number, number, number, number, number, number, number, number];

  const particles: P[] = [
    // ── Layer 1a: main dense stream (every ~5%) ───────────────────
    [ 1,  14, 0, 0.0, 4.0,  15,   8, 0.88],
    [ 6,  17, 1, 0.2, 3.5, -10,  -5, 0.84],
    [11,  13, 2, 0.6, 3.9,  20,  12, 0.90],
    [16,  18, 3, 0.1, 3.3, -15,  -8, 0.86],
    [21,  14, 0, 0.4, 4.2,   8,   5, 0.88],
    [26,  16, 1, 0.8, 3.4, -20,  15, 0.82],
    [31,  13, 2, 0.2, 3.8,  12,  -6, 0.91],
    [36,  18, 3, 0.5, 3.6,  -8,  10, 0.85],
    [41,  14, 0, 0.9, 4.1,  18,  -4, 0.87],
    [46,  16, 1, 0.3, 3.5, -12,   7, 0.83],
    [51,  13, 2, 0.7, 4.3,  10,  -9, 0.90],
    [56,  18, 3, 0.1, 3.2, -18,   6, 0.86],
    [61,  14, 0, 0.5, 4.0,  15,  -3, 0.88],
    [66,  16, 1, 0.2, 3.6, -10,  11, 0.84],
    [71,  13, 2, 0.8, 3.9,  20,  -7, 0.91],
    [76,  18, 3, 0.4, 3.4, -14,   4, 0.85],
    [81,  14, 0, 0.6, 4.4,   8, -10, 0.87],
    [86,  16, 1, 0.1, 3.3, -20,   9, 0.83],
    [91,  13, 2, 0.4, 4.0,  12,  -5, 0.90],
    [96,  14, 3, 0.7, 3.8,  -8,   6, 0.86],
    // ── Layer 1b: fill gaps between columns ───────────────────────
    [ 4,  15, 2, 1.0, 3.8,  10,  -4, 0.85],
    [ 9,  13, 0, 1.3, 4.2, -12,   7, 0.87],
    [14,  17, 1, 0.9, 3.5,  18,  -9, 0.82],
    [19,  14, 3, 1.2, 4.0,  -8,  11, 0.88],
    [24,  16, 2, 0.6, 3.5,  14,  -5, 0.84],
    [29,  13, 0, 1.1, 3.9, -16,   4, 0.89],
    [34,  17, 1, 0.7, 3.6,  10,  -8, 0.83],
    [39,  14, 3, 1.4, 4.1,  -6,  12, 0.87],
    [44,  15, 2, 0.3, 3.4,  20,  -3, 0.85],
    [49,  13, 0, 1.0, 4.5, -14,   6, 0.90],
    [54,  16, 1, 0.8, 3.7,   8, -10, 0.83],
    [59,  14, 3, 1.3, 4.0, -18,   9, 0.86],
    [64,  17, 2, 0.5, 3.5,  12,  -4, 0.88],
    [69,  13, 0, 1.1, 4.2, -10,   8, 0.84],
    [74,  15, 1, 0.9, 3.6,  16,  -7, 0.85],
    [79,  14, 3, 1.4, 4.0,  -8,  11, 0.87],
    [84,  16, 2, 0.2, 3.6,  14,  -5, 0.90],
    [89,  13, 0, 1.2, 4.3, -12,   4, 0.85],
    [94,  17, 1, 0.6, 3.8,  10,  -9, 0.83],
    [99,  14, 3, 1.0, 4.1,  -6,   7, 0.86],
    // ── Layer 2: larger slower particles ─────────────────────────
    [ 5,  24, 2, 0.4, 5.2, -20, -12, 0.74],
    [15,  22, 0, 0.7, 4.8,  18,   8, 0.77],
    [25,  26, 1, 1.0, 5.5, -12,  -6, 0.70],
    [35,  22, 3, 0.5, 5.0,  20,  10, 0.78],
    [45,  28, 0, 0.8, 5.6,  -8,  -8, 0.72],
    [55,  22, 2, 0.3, 5.0,  22,   7, 0.75],
    [65,  24, 1, 1.1, 5.4, -16,  -4, 0.73],
    [75,  22, 3, 0.6, 4.9,  10,  12, 0.77],
    [85,  26, 0, 0.9, 5.7, -18,  -9, 0.71],
    [95,  22, 2, 0.2, 5.2,  16,   5, 0.74],
    // ── Layer 3: occasional large accent pieces ───────────────────
    [10,  32, 1, 0.8, 6.2, -25, -15, 0.62],
    [30,  30, 3, 1.2, 5.8,  22,   8, 0.65],
    [50,  34, 0, 0.5, 6.8, -18,  -5, 0.60],
    [70,  30, 2, 1.5, 6.5,  20,  10, 0.63],
    [90,  32, 1, 0.2, 7.0, -22, -12, 0.61],
  ];

  function viewBox(size: number): string {
    return `0 0 ${size} ${size}`;
  }

  function points(size: number, shape: number): string {
    const s = size, m = 0.8;
    switch (shape) {
      case 1: return `${s/2},${m} ${s-m},${s-m} ${m},${s-m}`;                          // triangle
      case 2: return `${s/2},${m} ${s-m},${s/2} ${s/2},${s-m} ${m},${s/2}`;           // diamond
      case 3: return `${s*0.28},${m} ${s-m},${m} ${s*0.72},${s-m} ${m},${s-m}`;       // parallelogram
      default: return `${m},${m} ${s-m},${m} ${s-m},${s-m} ${m},${s-m}`;              // rect
    }
  }

  function strokeColor(opacity: number): string {
    // Dark charcoal-violet for dystopian feel
    return `rgba(12, 8, 18, ${opacity})`;
  }
</script>

{#if $gamePhase === 'playing'}

  <!-- ── HP danger: red flickering vignette ──────────────────── -->
  {#if $isLowHp}
    <div class="overlay hp-danger" aria-hidden="true"></div>
  {/if}

  <!-- ── Stress danger: geometric outline particles ─────────── -->
  {#if $isHighStress}
    <div class="overlay stress-danger" aria-hidden="true">
      {#each particles as [left, size, shape, delay, dur, drift, rotate, strokeOpacity]}
        <svg
          class="particle"
          width={size}
          height={size}
          viewBox={viewBox(size)}
          style="
            left: {left}%;
            animation-delay: {delay}s;
            animation-duration: {dur}s;
            --drift: {drift}px;
            --rotate: {rotate}deg;
          "
          aria-hidden="true"
        >
          <polygon
            points={points(size, shape)}
            fill="none"
            stroke={strokeColor(strokeOpacity)}
            stroke-width="2.2"
            stroke-linejoin="miter"
          />
        </svg>
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
    overflow: hidden;
  }

  /* ── HP danger: irregular red pulse inward from all edges ──── */
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

  /* ── Stress danger: particle geometry ───────────────────────── */
  .particle {
    position: absolute;
    bottom: -2px;   /* start just below visible edge */
    animation: float-up ease-in-out infinite;
    will-change: transform, opacity;
  }

  @keyframes float-up {
    0% {
      transform: translateY(0px) translateX(0px) rotate(0deg);
      opacity: 0;
    }
    6% {
      opacity: 1;
    }
    65% {
      opacity: 0.55;
    }
    100% {
      transform: translateY(-60vh) translateX(var(--drift, 0px)) rotate(var(--rotate, 10deg));
      opacity: 0;
    }
  }
</style>
