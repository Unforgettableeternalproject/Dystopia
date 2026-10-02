<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { initSettings } from '$lib/stores/settingsStore';

  // 每個視窗（主視窗、/console、/lore）啟動時讀取並套用介面設定，並監聽跨視窗同步
  onMount(() => initSettings());
</script>

<slot />
