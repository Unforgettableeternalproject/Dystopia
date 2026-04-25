<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import { save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { GameController }   from '$lib/engine/GameController';
  import { loadCrambellLore } from '$lib/utils/LoreLoader';
  import { pushLine }         from '$lib/stores/gameStore';
  import { broadcastAppClose } from '$lib/utils/Logger';
  import { gamePhase, isDebugMode, activeNpcUI, selfCheckOpen, inventoryOpen, activeScriptedDialogue, activeEncounterUI, narrativeLines, encounterSessionLog, inputDisabled, questDetailOpen, questListOpen, currentQuestBanner, statCheckOverlay, endingType, loreItemOpen, restModalOpen, restResultOverlay } from '$lib/stores/gameStore';
  import type { SlotMeta }    from '$lib/utils/SaveManager';

  import TopBar          from '$lib/components/TopBar.svelte';
  import LeftSidebar     from '$lib/components/LeftSidebar.svelte';
  import NarrativePanel  from '$lib/components/NarrativePanel.svelte';
  import ThoughtsPanel   from '$lib/components/ThoughtsPanel.svelte';
  import NPCPanel        from '$lib/components/NPCPanel.svelte';
  import PlayerPanel     from '$lib/components/PlayerPanel.svelte';
  import InputBar        from '$lib/components/InputBar.svelte';
  import SelfCheckModal    from '$lib/components/SelfCheckModal.svelte';
  import InventoryModal    from '$lib/components/InventoryModal.svelte';
  import QuestDetailModal  from '$lib/components/QuestDetailModal.svelte';
  import QuestListModal    from '$lib/components/QuestListModal.svelte';
  import EndingScreen      from '$lib/components/EndingScreen.svelte';
  import TitleScreen          from '$lib/components/TitleScreen.svelte';
  import LoadingScreen        from '$lib/components/LoadingScreen.svelte';
  import ScriptedChoicePanel  from '$lib/components/ScriptedChoicePanel.svelte';
  import EncounterPanel       from '$lib/components/EncounterPanel.svelte';
  import DebugPanel           from '$lib/components/DebugPanel.svelte';
  import StatCheckOverlay     from '$lib/components/StatCheckOverlay.svelte';
  import LoreItemModal        from '$lib/components/LoreItemModal.svelte';
  import RestModal            from '$lib/components/RestModal.svelte';
  import RestResultOverlay    from '$lib/components/RestResultOverlay.svelte';
  import DangerOverlay        from '$lib/components/DangerOverlay.svelte';

  import type { Thought, ActionTargetKind } from '$lib/types';

  let controller: GameController;
  let saveSlots: (SlotMeta | null)[] = Array(6).fill(null);
  let loadMenuOpen = false;
  let saveMenuOpen = false;
  let showCloseConfirm = false;
  let showReturnConfirm = false;
  let debugPanelOpen = false;
  $: if (!$isDebugMode) debugPanelOpen = false;

  // Quest banner lifecycle is managed by enqueueQuestBanner() in gameStore — no timer needed here.

  // 偵測 activeEncounterUI 變化，若有 statCheckResult 則觸發判定 overlay
  let _prevEncounterRef: typeof $activeEncounterUI = null;
  $: {
    const enc = $activeEncounterUI;
    if (enc !== _prevEncounterRef) {
      _prevEncounterRef = enc;
      if (enc?.statCheckResult) {
        statCheckOverlay.set(enc.statCheckResult);
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if ($gamePhase === 'playing' && $isDebugMode) debugPanelOpen = !debugPanelOpen;
    }
  }

  // Plain object (not Svelte-reactive) — the closure inside onCloseRequested
  // reads .bypass directly, without going through Svelte's $$invalidate.
  const _closeGuard = { bypass: false };

  onMount(async () => {
    controller = new GameController();
    loadCrambellLore(controller);
    // Load save slot metadata for the title screen continue menu
    try {
      saveSlots = await controller.listSaves();
    } catch { /* no saves yet */ }
  });

  onMount(() => {
    // Store unlisten as a plain local — not a Svelte reactive variable
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onCloseRequested((event) => {
        if (_closeGuard.bypass) return;   // confirmed — let Tauri proceed with close
        event.preventDefault();
        showCloseConfirm = true;
      })
      .then(fn => { unlisten = fn; });

    return () => unlisten?.();   // synchronous cleanup for Svelte onMount
  });

  async function confirmClose() {
    _closeGuard.bypass = true;    // property mutation bypasses Svelte reactivity
    showCloseConfirm = false;
    broadcastAppClose();          // tell satellite windows (/console) to close
    // Directly close the console window via Tauri API (window.close() doesn't work in WebView)
    const consoleWin = await WebviewWindow.getByLabel('console');
    if (consoleWin) await consoleWin.close();
    getCurrentWindow().close();
  }

  function cancelClose() {
    showCloseConfirm = false;
  }

  // ── New game ─────────────────────────────────────────────────

  async function handleNewGame(playerName: string) {
    isDebugMode.set(false);
    gamePhase.set('loading');
    try {
      controller.resetForNewGame();
      await controller.start(playerName);
      gamePhase.set('playing');
    } catch (err) {
      pushLine('系統錯誤：無法啟動遊戲引擎。', 'system');
      console.error(err);
      gamePhase.set('title');
    }
  }

  async function handleDebugStart() {
    isDebugMode.set(true);
    gamePhase.set('loading');
    try {
      controller.resetForNewGame();
      await controller.start('DEBUG');
      gamePhase.set('playing');
    } catch (err) {
      pushLine('系統錯誤：無法啟動除錯模式。', 'system');
      console.error(err);
      isDebugMode.set(false);
      gamePhase.set('title');
    }
  }

  let endingRestartMode: 'menu' | 'naming' = 'menu';

  function handleReturnToTitle() {
    // In debug mode, skip confirmation
    if ($isDebugMode) {
      doReturnToTitle();
    } else {
      showReturnConfirm = true;
    }
  }

  function doReturnToTitle() {
    showReturnConfirm = false;
    endingRestartMode = 'menu';
    isDebugMode.set(false);
    narrativeLines.set([]);
    activeNpcUI.set(null);
    activeScriptedDialogue.set(null);
    activeEncounterUI.set(null);
    encounterSessionLog.set([]);
    inputDisabled.set(false);
    endingType.set(null);
    gamePhase.set('title');
  }

  function handleEndingRestart() {
    endingRestartMode = 'naming';
    isDebugMode.set(false);
    narrativeLines.set([]);
    activeNpcUI.set(null);
    activeScriptedDialogue.set(null);
    activeEncounterUI.set(null);
    encounterSessionLog.set([]);
    inputDisabled.set(false);
    endingType.set(null);
    gamePhase.set('title');
  }

  function handleEndingToTitle() {
    handleReturnToTitle();
  }

  // ── Load game ─────────────────────────────────────────────────

  async function handleLoadSlot(slotId: number) {
    gamePhase.set('loading');
    try {
      await controller.load(slotId);
      gamePhase.set('playing');
    } catch (err) {
      pushLine('讀取存檔失敗。', 'system');
      console.error(err);
      gamePhase.set('title');
    }
  }

  // ── In-game actions ───────────────────────────────────────────

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
    if (!controller) return;
    // Rest thoughts open RestModal instead of going to DM
    if (thought.actionType === 'rest') {
      controller.openRestModal();
      return;
    }
    controller.submitAction(thought.text, thought.actionType, thought.targetId).catch(err => {
      pushLine('（動作處理時發生錯誤）', 'system');
      console.error(err);
    });
  }

  function handleCheck(targetKind: ActionTargetKind, targetId: string, targetName: string) {
    if (!controller) return;
    controller.submitAction(`檢查 "${targetName}"`, 'examine', targetId, targetKind, true).catch(err => {
      pushLine('（檢查時發生錯誤）', 'system');
      console.error(err);
    });
  }

  async function handleDialogueChoice(choiceId: string) {
    if (!controller) return;
    await controller.selectDialogueChoice(choiceId);
  }

  async function handleEncounterChoice(choiceId: string) {
    if (!controller) return;
    await controller.selectEncounterChoice(choiceId);
  }

  async function handleStoryAdvance() {
    if (!controller) return;
    await controller.selectEncounterStoryAdvance();
  }

  function handleStorySkip() {
    if (!controller) return;
    controller.selectEncounterStorySkip();
  }

  // ── Save ──────────────────────────────────────────────────────

  function openSaveMenu() {
    if (!controller) return;
    const { allowed, reason } = controller.canSave();
    if (!allowed) { pushLine('無法存檔：' + reason, 'system'); return; }
    controller.listSaves().then(s => { saveSlots = s; saveMenuOpen = true; });
  }

  async function handleSaveToSlot(slotId: number) {
    saveMenuOpen = false;
    try {
      await controller.save(slotId, slotId === 0 ? '自動存檔' : undefined);
      saveSlots = await controller.listSaves();
      pushLine(`（已存檔至槽位 ${slotId}）`, 'system');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLine(`存檔失敗：${msg}`, 'system');
      console.error('[Save] handleSaveToSlot failed:', err);
    }
  }

  function openLoadMenu() {
    deleteConfirmSlot = null;
    controller.listSaves().then(s => { saveSlots = s; loadMenuOpen = true; });
  }

  async function handleLoadFromMenu(slotId: number) {
    loadMenuOpen = false;
    await handleLoadSlot(slotId);
  }

  // ── Save slot management ──────────────────────────────────────

  let deleteConfirmSlot: number | null = null;

  const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  async function handleExportSlot(slotId: number) {
    try {
      const json     = await controller.exportSave(slotId);
      const filename = `dystopia_slot${slotId}.dys`;
      if (IS_TAURI) {
        const filePath = await saveDialog({
          defaultPath: filename,
          filters: [{ name: 'Dystopia Save', extensions: ['dys'] }],
        });
        if (!filePath) return; // user cancelled
        await writeTextFile(filePath, json);
        pushLine(`（存檔已匯出：${filePath}）`, 'system');
      } else {
        // Browser fallback: trigger a download
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        pushLine(`（存檔已匯出：${filename}）`, 'system');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLine(`匯出失敗：${msg}`, 'system');
    }
  }

  async function handleDeleteSlot(slotId: number) {
    try {
      await controller.deleteSave(slotId);
      saveSlots = await controller.listSaves();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLine(`刪除失敗：${msg}`, 'system');
    } finally {
      deleteConfirmSlot = null;
    }
  }

  function handleImportSlot(slotId: number) {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.dys,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        await controller.importSave(content, slotId);
        saveSlots = await controller.listSaves();
        pushLine(`（存檔已匯入至槽位 ${slotId}）`, 'system');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushLine(`匯入失敗：${msg}`, 'system');
      }
    };
    input.click();
  }
</script>

<svelte:window on:keydown={handleKeydown} on:beforeunload={broadcastAppClose} />

<!-- Title screen -->
{#if $gamePhase === 'title'}
  <TitleScreen
    {saveSlots}
    initialMode={endingRestartMode}
    onNewGame={handleNewGame}
    onLoadSlot={handleLoadSlot}
    onExportSlot={handleExportSlot}
    onDeleteSlot={handleDeleteSlot}
    onImportSlot={handleImportSlot}
    onDebugStart={handleDebugStart}
  />
{/if}

<!-- Loading screen -->
{#if $gamePhase === 'loading'}
  <LoadingScreen />
{/if}

<!-- Game layout (always rendered once playing, hidden before) -->
{#if $gamePhase === 'playing'}
<div class="game-layout">
  <TopBar onSave={openSaveMenu} onLoadMenu={openLoadMenu} onReturnToTitle={handleReturnToTitle} />

  <div class="main-area" class:npc-active={$activeNpcUI !== null}>
    <LeftSidebar />

    <div class="center-column" class:encounter-active={$activeNpcUI !== null || $activeEncounterUI !== null}>
      {#if $activeNpcUI}
        <div class="encounter-bar">
          <span class="enc-icon">◈</span>
          <span class="enc-label">對話遭遇</span>
          <span class="enc-sep">·</span>
          <span class="enc-name">{$activeNpcUI.name}</span>
        </div>
      {:else if $activeEncounterUI?.type === 'story'}
        <div class="encounter-bar story-bar">
          <span class="enc-icon">◇</span>
          <span class="enc-label">劇情遭遇</span>
          <span class="enc-sep">·</span>
          <span class="enc-name">{$activeEncounterUI.encounterName}</span>
        </div>
      {/if}
      <NarrativePanel />
      {#if $activeEncounterUI && $activeEncounterUI.type !== 'story'}
        <EncounterPanel onSelect={handleEncounterChoice} />
      {:else if $activeScriptedDialogue}
        <ScriptedChoicePanel onSelect={handleDialogueChoice} />
      {:else}
        <ThoughtsPanel onSelect={handleThoughtSelect} onCheck={handleCheck} />
      {/if}
    </div>

    {#if $activeNpcUI}
      <NPCPanel onLeave={() => controller.exitDialogue()} />
    {/if}

    <PlayerPanel />
  </div>

  <InputBar onSubmit={handleSubmit} onAdvance={handleStoryAdvance} onSkip={handleStorySkip} />
</div>

<DangerOverlay />

{#if $selfCheckOpen}
  <SelfCheckModal />
{/if}

{#if $inventoryOpen}
  <InventoryModal {controller} />
{/if}

{#if $questListOpen}
  <QuestListModal />
{/if}

{#if $questDetailOpen}
  <QuestDetailModal {controller} />
{/if}

<LoreItemModal />

{#if $restModalOpen}
  <RestModal {controller} />
{/if}

{#if $restResultOverlay}
  <RestResultOverlay {controller} />
{/if}

{#if $statCheckOverlay}
  <StatCheckOverlay
    stat={$statCheckOverlay.stat}
    dc={$statCheckOverlay.dc}
    value={$statCheckOverlay.value}
    passed={$statCheckOverlay.passed}
    rollResult={$statCheckOverlay.rollResult}
    sides={$statCheckOverlay.sides ?? 20}
  />
{/if}

<!-- Quest outcome banner (completion and failure share the same position, queued) -->
{#if $currentQuestBanner}
  <div class="quest-banner" class:quest-banner-fail={$currentQuestBanner.outcome === 'failed'}>
    <span class="quest-banner-icon">{$currentQuestBanner.outcome === 'completed' ? '◆' : '✕'}</span>
    <span class="quest-banner-text">
      {$currentQuestBanner.outcome === 'completed' ? '任務完成' : '任務失敗'}：{$currentQuestBanner.name}
    </span>
  </div>
{/if}

{#if debugPanelOpen}
  <DebugPanel {controller} onClose={() => { debugPanelOpen = false; }} />
{/if}

<!-- In-game load menu overlay -->
{#if loadMenuOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="load-backdrop" transition:fade={{ duration: 150 }} on:click={() => { loadMenuOpen = false; deleteConfirmSlot = null; }}>
    <div class="load-panel" transition:fly={{ y: -8, duration: 180, easing: cubicOut }} on:click|stopPropagation>
      <div class="load-header">
        <span class="load-title">存檔管理</span>
        <button class="load-close" on:click={() => { loadMenuOpen = false; deleteConfirmSlot = null; }}>✕</button>
      </div>
      {#each saveSlots as slot, i}
        {#if slot}
          <div class="load-slot occupied">
            <button class="ls-main" on:click={() => handleLoadFromMenu(i)}>
              <span class="ls-label">{i === 0 ? '自動存檔' : slot.label ?? '存檔 ' + i}</span>
              <span class="ls-loc">{slot.locationName}</span>
              <span class="ls-time">{slot.worldTime}</span>
            </button>
            {#if i > 0}
              <div class="ls-actions">
                {#if deleteConfirmSlot === i}
                  <span class="ls-confirm-text">確定刪除?</span>
                  <button class="ls-action-btn danger" on:click={() => handleDeleteSlot(i)}>確定</button>
                  <button class="ls-action-btn" on:click={() => deleteConfirmSlot = null}>取消</button>
                {:else}
                  <button class="ls-action-btn" on:click={() => handleExportSlot(i)}>匯出</button>
                  <button class="ls-action-btn" on:click={() => handleImportSlot(i)}>匯入</button>
                  <button class="ls-action-btn danger" on:click={() => deleteConfirmSlot = i}>刪除</button>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <div class="load-slot empty">
            <span class="ls-label">{i === 0 ? '自動存檔' : '存檔 ' + i} — 空</span>
            {#if i > 0}
              <div class="ls-actions">
                <button class="ls-action-btn" on:click={() => handleImportSlot(i)}>匯入</button>
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<!-- In-game save menu overlay -->
{#if saveMenuOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="load-backdrop" transition:fade={{ duration: 150 }} on:click={() => saveMenuOpen = false}>
    <div class="load-panel" transition:fly={{ y: -8, duration: 180, easing: cubicOut }} on:click|stopPropagation>
      <div class="load-header">
        <span class="load-title">選擇存檔槽位</span>
        <button class="load-close" on:click={() => saveMenuOpen = false}>✕</button>
      </div>
      {#each saveSlots.slice(1) as slot, i}
        {@const slotId = i + 1}
        <button class="save-slot" on:click={() => handleSaveToSlot(slotId)}>
          <span class="ls-label">{slot?.label ?? '存檔 ' + slotId}{slot ? '' : ' — 空'}</span>
          {#if slot}
            <span class="ls-loc">{slot.locationName}</span>
            <span class="ls-time">{slot.worldTime}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}
{/if}

<!-- Ending screen (death / collapse / mvp_complete) -->
{#if $gamePhase === 'ending'}
  <EndingScreen
    on:restart={handleEndingRestart}
    on:toTitle={handleEndingToTitle}
  />
{/if}

<!-- Close confirmation — shown regardless of game phase -->
{#if showCloseConfirm}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="close-backdrop" transition:fade={{ duration: 150 }} on:click={cancelClose}>
    <div class="confirm-panel" transition:fly={{ y: -8, duration: 180, easing: cubicOut }} on:click|stopPropagation>
      <div class="load-header">
        <span class="load-title">離開遊戲</span>
      </div>
      <p class="confirm-msg">確定要關閉遊戲嗎？未存檔的進度將會遺失。</p>
      <div class="confirm-actions">
        <button class="confirm-btn danger" on:click={confirmClose}>確認關閉</button>
        <button class="confirm-btn" on:click={cancelClose}>返回</button>
      </div>
    </div>
  </div>
{/if}

<!-- Return to title confirmation -->
{#if showReturnConfirm}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="close-backdrop" transition:fade={{ duration: 150 }} on:click={() => showReturnConfirm = false}>
    <div class="confirm-panel" transition:fly={{ y: -8, duration: 180, easing: cubicOut }} on:click|stopPropagation>
      <div class="load-header">
        <span class="load-title">返回標題</span>
      </div>
      <p class="confirm-msg">確定要返回標題畫面嗎？未存檔的進度將會遺失。</p>
      <div class="confirm-actions">
        <button class="confirm-btn danger" on:click={doReturnToTitle}>確認返回</button>
        <button class="confirm-btn" on:click={() => showReturnConfirm = false}>取消</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .game-layout {
    display: grid;
    grid-template-rows: var(--top-bar-h) 1fr var(--bottom-bar-h);
    height: 100%;
    overflow: hidden;
  }

  .main-area {
    display: grid;
    grid-template-columns: var(--left-sidebar-w) 1fr var(--right-outer-w);
    overflow: hidden;
  }

  .main-area.npc-active {
    grid-template-columns: var(--left-sidebar-w) 1fr var(--right-inner-w) var(--right-outer-w);
  }

  .center-column {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    transition: border-color 0.25s ease;
  }

  .center-column.encounter-active {
    border-left-color: var(--accent-dim);
    border-right-color: var(--accent-dim);
  }

  /* Encounter mode header strip */
  .encounter-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 14px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-accent);
    border-left: 2px solid var(--accent);
    flex-shrink: 0;
    animation: encounterSlideIn 0.18s ease-out;
  }

  @keyframes encounterSlideIn {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .enc-icon {
    font-size: 9px;
    color: var(--accent);
    flex-shrink: 0;
  }

  .enc-label {
    font-size: 9px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .enc-sep {
    font-size: 9px;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .enc-name {
    font-size: 10px;
    color: var(--accent);
    font-weight: 500;
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Story encounter bar — amber accent */
  .story-bar {
    border-left-color: #c9a96e;
  }
  .story-bar .enc-icon,
  .story-bar .enc-name {
    color: #c9a96e;
  }

  /* In-game load menu */
  .load-backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .load-panel {
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 2px;
    width: 360px;
    max-height: 480px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .load-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-tertiary);
    flex-shrink: 0;
  }

  .load-title {
    font-size: 12px;
    color: var(--text-primary);
    letter-spacing: 0.05em;
  }

  .load-close {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
  }

  .load-close:hover { color: var(--text-primary); }

  .load-slot {
    background: transparent;
    width: 100%;
  }

  .ls-label {
    font-size: 12px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    flex: 1;
  }

  .ls-loc {
    font-size: 10px;
    color: var(--text-dim);
    flex: 1;
  }

  .ls-time {
    font-size: 10px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  /* Redesigned slot row for management view */
  .load-slot.occupied {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--border);
  }

  .ls-main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
    min-width: 0;
  }

  .ls-main:hover { background: var(--bg-tertiary); }

  .load-slot.empty {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .load-slot.empty .ls-label {
    flex: 1;
    opacity: 0.35;
  }

  .ls-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
  }

  .load-slot.empty .ls-actions {
    border-left: none;
  }

  .ls-action-btn {
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 2px;
    letter-spacing: 0.04em;
    transition: background 0.1s, color 0.1s;
    white-space: nowrap;
  }

  .ls-action-btn:hover { background: var(--bg-tertiary); color: var(--text-secondary); }
  .ls-action-btn.danger { color: var(--accent-red, #c0392b); }
  .ls-action-btn.danger:hover { background: rgba(192, 57, 43, 0.12); }

  .ls-confirm-text {
    font-size: 10px;
    color: var(--text-dim);
    padding: 0 6px;
    font-family: var(--font-mono);
  }

  /* Save menu slot (write-only, simpler) */
  .save-slot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    text-align: left;
    width: 100%;
    cursor: pointer;
    transition: background 0.1s;
  }

  .save-slot:hover { background: var(--bg-tertiary); }

  /* Close confirmation — above TitleScreen (z-index 200) */
  .close-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Close confirmation dialog */
  .confirm-panel {
    background: var(--bg-secondary);
    border: 1px solid var(--border-accent);
    border-radius: 2px;
    width: 300px;
    display: flex;
    flex-direction: column;
  }

  .confirm-msg {
    padding: 18px 16px;
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.7;
    border-bottom: 1px solid var(--border);
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    justify-content: flex-end;
  }

  .confirm-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 5px 14px;
    background: transparent;
    border: 1px solid var(--border-accent);
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 2px;
    letter-spacing: 0.04em;
    transition: background 0.1s, color 0.1s;
  }

  .confirm-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .confirm-btn.danger {
    border-color: var(--accent-red);
    color: var(--accent-red);
  }

  .confirm-btn.danger:hover {
    background: var(--accent-red);
    color: var(--text-primary);
  }

  /* ── Quest completion banner ──────────────────────── */
  .quest-banner {
    position: fixed;
    top: calc(var(--top-bar-h) + 10px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 20px;
    background: var(--bg-tertiary);
    border: 1px solid var(--accent);
    border-radius: 2px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
    animation: bannerIn 0.2s ease-out;
    pointer-events: none;
    white-space: nowrap;
  }

  .quest-banner-icon {
    font-size: 9px;
    color: var(--accent);
  }

  .quest-banner-text {
    font-size: 12px;
    color: var(--text-primary);
    letter-spacing: 0.04em;
    font-family: var(--font-mono);
  }

  .quest-banner-fail {
    border-color: var(--accent-red);
  }

  .quest-banner-fail .quest-banner-icon {
    color: var(--accent-red);
  }

  @keyframes bannerIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
