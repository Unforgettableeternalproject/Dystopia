<script lang="ts">
  import { onMount } from 'svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import NarrativeBox from '$lib/components/NarrativeBox.svelte';
  import ChoicePanel from '$lib/components/ChoicePanel.svelte';
  import { GameController } from '$lib/engine/GameController';
  import { loadCrambellLore } from '$lib/utils/LoreLoader';
  import { pushLine } from '$lib/stores/gameStore';

  let controller: GameController;

  onMount(async () => {
    controller = new GameController();
    loadCrambellLore(controller);

    try {
      await controller.start();
    } catch (err) {
      pushLine('系統錯誤：無法啟動遊戲引擎。', 'system');
      console.error(err);
    }
  });

  async function handleSubmit(input: string) {
    if (!controller) return;
    try {
      await controller.submitAction(input);
    } catch (err) {
      pushLine('（動作處理時發生錯誤）', 'system');
      console.error(err);
    }
  }
</script>

<svelte:head>
  <title>Dystopia</title>
</svelte:head>

<div class="game-layout">
  <StatusBar />
  <NarrativeBox />
  <ChoicePanel onSubmit={handleSubmit} />
</div>

<style>
  .game-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }
</style>
