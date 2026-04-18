<script lang="ts">
  import { onMount } from 'svelte';
  import { GameController }    from '$lib/engine/GameController';
  import { loadCrambellLore }  from '$lib/utils/LoreLoader';
  import { pushLine }          from '$lib/stores/gameStore';
  import { activeNpcUI, selfCheckOpen, inventoryOpen } from '$lib/stores/gameStore';

  import TopBar          from '$lib/components/TopBar.svelte';
  import LeftSidebar     from '$lib/components/LeftSidebar.svelte';
  import NarrativePanel  from '$lib/components/NarrativePanel.svelte';
  import ThoughtsPanel   from '$lib/components/ThoughtsPanel.svelte';
  import NPCPanel        from '$lib/components/NPCPanel.svelte';
  import PlayerPanel     from '$lib/components/PlayerPanel.svelte';
  import InputBar        from '$lib/components/InputBar.svelte';
  import SelfCheckModal  from '$lib/components/SelfCheckModal.svelte';
  import InventoryModal  from '$lib/components/InventoryModal.svelte';

  import type { Thought } from '$lib/types';

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

  function handleThoughtSelect(thought: Thought) {
    handleSubmit(thought.text);
  }
</script>

<div class="game-layout">
  <TopBar />

  <div class="main-area" class:npc-active={$activeNpcUI !== null}>
    <LeftSidebar />

    <div class="center-column">
      <NarrativePanel />
      <ThoughtsPanel onSelect={handleThoughtSelect} />
    </div>

    {#if $activeNpcUI}
      <NPCPanel />
    {/if}

    <PlayerPanel />
  </div>

  <InputBar onSubmit={handleSubmit} />
</div>

{#if $selfCheckOpen}
  <SelfCheckModal />
{/if}

{#if $inventoryOpen}
  <InventoryModal />
{/if}

<style>
  .game-layout {
    display: grid;
    grid-template-rows: var(--top-bar-h) 1fr var(--bottom-bar-h);
    height: 100%;
    overflow: hidden;
  }

  /* Main area: left-sidebar | center | (optional NPC panel) | player panel */
  .main-area {
    display: grid;
    grid-template-columns: var(--left-sidebar-w) 1fr var(--right-outer-w);
    overflow: hidden;
  }

  .main-area.npc-active {
    grid-template-columns: var(--left-sidebar-w) 1fr var(--right-inner-w) var(--right-outer-w);
  }

  /* Center column: narrative grows, thoughts at bottom */
  .center-column {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }
</style>
