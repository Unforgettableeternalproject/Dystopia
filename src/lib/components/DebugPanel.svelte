<script lang="ts">
  import type { GameController } from '$lib/engine/GameController';
  import { playerUI, detailedPlayer, type EndingType, shadowComparisons, shadowModeActive, statCheckOverlay } from '$lib/stores/gameStore';
  export let controller: GameController;
  export let onClose: () => void;

  const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  async function openConsoleWindow() {
    if (IS_TAURI) {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const existing = await WebviewWindow.getByLabel('console');
      if (existing) {
        await existing.setFocus();
        return;
      }
      new WebviewWindow('console', {
        url: '/console',
        title: 'Dystopia Console',
        width: 900,
        height: 600,
        resizable: true,
        decorations: true,
      });
    } else {
      const win = window.open('/console', 'dystopia_console', 'width=900,height=600,resizable=yes');
      win?.focus();
    }
  }

  type Tab = 'encounter' | 'npc' | 'event' | 'quest' | 'location' | 'flag' | 'player' | 'ending' | 'judge' | 'item' | 'rep' | 'dice';
  let activeTab: Tab = 'encounter';
  let filter = '';
  let flagInput = '';
  let flagAction: 'set' | 'unset' = 'set';

  // -- Player state tab --------------------------------------------------
  let targetYear   = 1498;
  let targetMonth  = 6;
  let targetDay    = 12;
  let targetHour   = 21;
  let targetMinute = 23;
  let melphinInput = 0;

  // Stat inputs keyed by dotPath
  let statInputs: Record<string, number> = {};

  // Reputation / affinity inputs
  let repInputs: Record<string, number> = {};
  let affinityInputs: Record<string, number> = {};

  function initRepInputs() {
    const dp = $detailedPlayer;
    for (const f of catalog.factions) {
      repInputs[f.id] = dp?.reputation[f.id] ?? 0;
    }
    for (const n of catalog.npcs) {
      affinityInputs[n.id] = dp?.affinity[n.id] ?? 0;
    }
  }

  function initStatInputs() {
    const dp = $detailedPlayer;
    if (!dp) return;
    for (const [k, v] of Object.entries(dp.statusStats))   statInputs['statusStats.'   + k] = v;
    for (const [k, v] of Object.entries(dp.primaryStats))  statInputs['primaryStats.'  + k] = v;
    for (const [k, v] of Object.entries(dp.secondaryStats)) statInputs['secondaryStats.' + k] = v;
    melphinInput = $playerUI.melphin ?? 0;
    const t = controller.debugGetCurrentTime();
    targetYear = t.year; targetMonth = t.month; targetDay = t.day;
    targetHour = t.hour; targetMinute = t.minute;
  }

  function applyStatSet(dotPath: string) {
    const val = statInputs[dotPath];
    if (val === undefined || isNaN(val)) return;
    controller.debugSetStat(dotPath, Math.max(0, Math.floor(val)));
  }

  const STATUS_LABELS: Record<string, string> = {
    stamina: '體力', staminaMax: '體力上限',
    stress: '壓力', stressMax: '壓力上限',
    endo: 'Endo', endoMax: 'Endo 上限',
    experience: '經驗',
  };
  const PRIMARY_LABELS: Record<string, string> = {
    strength: '力量', knowledge: '知識', talent: '才能', spirit: '靈性', luck: '運氣',
  };
  const SECONDARY_LABELS: Record<string, string> = {
    consciousness: '意識', mysticism: '神秘', technology: '技術',
  };

  const catalog = controller.getDebugCatalog();

  const tabLabels: Record<Tab, string> = {
    encounter: `遭遇 (${catalog.encounters.length})`,
    npc:       `NPC (${catalog.npcs.length})`,
    event:     `事件 (${catalog.events.length})`,
    quest:     `任務 (${catalog.quests.length})`,
    location:  `地點 (${catalog.locations.length})`,
    item:      `道具 (${catalog.items.length})`,
    flag:      '旗標',
    player:    '玩家狀態',
    ending:    '結局測試',
    judge:     'Judge 對比',
    rep:       '聲望/好感',
    dice:      '骰子動畫',
  };

  $: q = filter.toLowerCase();

  $: filteredEncounters = catalog.encounters.filter(
    e => !q || e.id.includes(q) || e.name.toLowerCase().includes(q),
  );
  $: filteredNpcs = catalog.npcs.filter(
    n => !q || n.id.includes(q) || n.name.toLowerCase().includes(q),
  );
  $: filteredEvents = catalog.events.filter(
    e => !q || e.id.includes(q) || e.name.toLowerCase().includes(q),
  );
  $: filteredQuests = catalog.quests.filter(
    q2 => !q || q2.id.includes(q) || q2.name.toLowerCase().includes(q),
  );
  $: filteredLocations = catalog.locations.filter(
    l => !q || l.id.includes(q) || l.name.toLowerCase().includes(q),
  );
  $: filteredItems = catalog.items.filter(
    i => !q || i.id.includes(q) || i.name.toLowerCase().includes(q),
  );
  // Non-stackable items already held — disable 加入 button for these
  $: heldNonStackableIds = new Set(
    ($detailedPlayer?.resolvedInventory ?? [])
      .filter(i => !i.isExpired && !catalog.items.find(c => c.id === i.itemId)?.stackable)
      .map(i => i.itemId),
  );

  const itemTypeColors: Record<string, string> = {
    key:        'var(--accent)',
    equipment:  '#5fa8d3',
    consumable: '#6a9a6a',
  };

  const encTypeColors: Record<string, string> = {
    narrative: '#c9a96e',
    event:     '#5fa8d3',
    dialogue:  '#7ec8a0',
    combat:    '#d35f5f',
    shop:      '#7ec87e',
  };

  function setTab(key: string) {
    activeTab = key as Tab;
    filter = '';
  }

  function applyFlag() {
    const f = flagInput.trim();
    if (!f) return;
    if (flagAction === 'set') controller.debugSetFlag(f);
    else controller.debugUnsetFlag(f);
  }

  let resetting = false;
  async function handleReset() {
    resetting = true;
    try {
      await controller.debugResetGame();
    } finally {
      resetting = false;
    }
  }

  const ENDINGS: { type: EndingType; label: string; color: string }[] = [
    { type: 'death',        label: '死亡結局',     color: '#d35f5f' },
    { type: 'collapse',     label: '精神崩潰結局', color: '#c9a96e' },
    { type: 'mvp_complete', label: 'MVP 完成結局', color: '#7ec8a0' },
  ];

  // ── Dice test ──────────────────────────────────────────────────
  const DICE_TYPES = [
    { sides: 4,  label: 'D4'  },
    { sides: 6,  label: 'D6'  },
    { sides: 8,  label: 'D8'  },
    { sides: 20, label: 'D20' },
  ];
  const DICE_STATS = ['strength', 'knowledge', 'agility', 'charisma', 'stamina', 'perception', 'luck', 'spirit'];

  let diceSides    = 20;
  let diceRollVal  = 14;
  let diceDC       = 12;
  let diceStatMod  = 2;
  let diceExtMod   = 0;
  let diceStat     = 'strength';

  $: dicePreviewTotal  = diceRollVal + diceStatMod + diceExtMod;
  $: dicePreviewPassed = dicePreviewTotal >= diceDC;

  function triggerDiceTest() {
    const total  = diceRollVal + diceStatMod + diceExtMod;
    const passed = total >= diceDC;
    onClose();
    statCheckOverlay.set({
      stat:   diceStat,
      dc:     diceDC,
      value:  total,
      passed,
      sides:  diceSides,
      rollResult: {
        rolls:            [diceRollVal],
        chosenRoll:       diceRollVal,
        statModifier:     diceStatMod,
        externalModifier: diceExtMod,
        total,
      },
    });
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="debug-overlay" role="dialog" aria-label="除錯介面">
  <div class="debug-panel">

    <div class="debug-header">
      <span class="debug-title">◇ 除錯介面</span>
      <input
        class="debug-search"
        type="text"
        placeholder="搜尋 ID 或名稱..."
        bind:value={filter}
      />
      <button class="reset-btn" on:click={handleReset} disabled={resetting}>
        {resetting ? '重置中…' : '⟳ 重置遊戲'}
      </button>
      <button class="console-btn" on:click={openConsoleWindow}>
        除錯主控台
      </button>
      <button class="close-btn" on:click={onClose}>✕</button>
    </div>

    <div class="tab-bar">
      {#each Object.entries(tabLabels) as [key, label]}
        <button
          class="tab-btn"
          class:active={activeTab === key}
          on:click={() => setTab(key)}
        >
          {label}
        </button>
      {/each}
    </div>

    <div class="tab-content">

      {#if activeTab === 'encounter'}
        <div class="item-list">
          {#each filteredEncounters as enc (enc.id)}
            <div class="item-row">
              <span class="item-type-badge" style="color: {encTypeColors[enc.type] ?? '#888'}">
                {enc.type}
              </span>
              <div class="item-info">
                <span class="item-name">{enc.name}</span>
                <span class="item-id">{enc.id}</span>
              </div>
              <button class="trigger-btn" on:click={() => controller.debugTriggerEncounter(enc.id)}>
                觸發
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'npc'}
        <div class="item-list">
          {#each filteredNpcs as npc (npc.id)}
            <div class="item-row">
              <span class="item-type-badge">npc</span>
              <div class="item-info">
                <span class="item-name">{npc.name}</span>
                <span class="item-id">{npc.id}</span>
              </div>
              <button class="trigger-btn secondary" on:click={() => controller.debugInspectContext(npc.id)}>
                Context
              </button>
              <button class="trigger-btn" on:click={() => controller.debugStartNpcDialogue(npc.id)}>
                對話
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'event'}
        <div class="item-list">
          {#each filteredEvents as evt (evt.id)}
            <div class="item-row">
              <div class="item-info">
                <span class="item-name">{evt.name}</span>
                <span class="item-id">{evt.id}</span>
              </div>
              <button class="trigger-btn" on:click={() => controller.debugForceEvent(evt.id).catch(console.error)}>
                強制觸發
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'quest'}
        <div class="item-list">
          {#each filteredQuests as q2 (q2.id)}
            <div class="item-row">
              <div class="item-info">
                <span class="item-name">{q2.name}</span>
                <span class="item-id">{q2.id}</span>
              </div>
              <button class="trigger-btn" on:click={() => controller.debugGrantQuest(q2.id)}>
                授予
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'location'}
        <div class="item-list">
          {#each filteredLocations as loc (loc.id)}
            <div class="item-row">
              <div class="item-info">
                <span class="item-name">{loc.name}</span>
                <span class="item-id">{loc.id}</span>
              </div>
              <button class="trigger-btn" on:click={() => controller.debugTeleport(loc.id).catch(console.error)}>
                傳送
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'item'}
        <div class="item-list">
          {#each filteredItems as itm (itm.id)}
            {@const addable = itm.stackable || !heldNonStackableIds.has(itm.id)}
            <div class="item-row">
              <span class="item-type-badge" style="color:{itemTypeColors[itm.type] ?? '#888'}">
                {itm.type}
              </span>
              <div class="item-info">
                <span class="item-name">{itm.name}</span>
                <span class="item-id">
                  {itm.id}
                  {#if itm.stackable}<span class="item-stack-label"> ×{itm.maxStack ?? '∞'}</span>{/if}
                </span>
              </div>
              <button
                class="trigger-btn"
                class:trigger-btn-disabled={!addable}
                disabled={!addable}
                on:click={() => controller.debugAddItem(itm.id)}
              >
                加入
              </button>
            </div>
          {:else}
            <div class="empty">無符合項目</div>
          {/each}
        </div>

      {:else if activeTab === 'flag'}
        <div class="flag-panel">
          <div class="flag-row">
            <input
              class="flag-input"
              type="text"
              placeholder="輸入旗標 ID..."
              bind:value={flagInput}
              on:keydown={e => e.key === 'Enter' && applyFlag()}
            />
            <label class="radio-label">
              <input type="radio" bind:group={flagAction} value="set" /> 設置
            </label>
            <label class="radio-label">
              <input type="radio" bind:group={flagAction} value="unset" /> 清除
            </label>
            <button class="trigger-btn" on:click={applyFlag}>執行</button>
          </div>
          <p class="flag-hint">也可以直接在遊戲的 debug route (/debug) 查看目前所有 active flags。</p>
          <div class="flag-row" style="margin-top:8px">
            <button class="trigger-btn secondary" style="width:100%" on:click={() => controller.debugInspectContext()}>
              印出當前場景 Context（探索模式）
            </button>
          </div>
        </div>

      {:else if activeTab === 'player'}
        <div class="player-panel-debug">

          <!-- ── 時間調整 ──────────────────────── -->
          <div class="debug-group">
            <div class="debug-group-header">◇ 時間調整</div>
            <div class="player-section">
              <div class="time-row">
                <label class="time-field wide">
                  <span class="time-field-label">年</span>
                  <input class="num-input wide" type="number" min="1498" max="1504" bind:value={targetYear} />
                </label>
                <label class="time-field">
                  <span class="time-field-label">月</span>
                  <input class="num-input" type="number" min="1" max="12" bind:value={targetMonth} />
                </label>
                <label class="time-field">
                  <span class="time-field-label">日</span>
                  <input class="num-input" type="number" min="1" max="31" bind:value={targetDay} />
                </label>
              </div>
              <div class="time-row" style="margin-top:5px">
                <label class="time-field">
                  <span class="time-field-label">時</span>
                  <input class="num-input" type="number" min="0" max="23" bind:value={targetHour} />
                </label>
                <label class="time-field">
                  <span class="time-field-label">分</span>
                  <input class="num-input" type="number" min="0" max="59" bind:value={targetMinute} />
                </label>
                <button class="trigger-btn" style="margin-left:auto" on:click={() => controller.debugSetTime(
                  Math.max(1498,Math.min(1504,Math.floor(targetYear))),
                  Math.max(1,Math.min(12,Math.floor(targetMonth))),
                  Math.max(1,Math.min(31,Math.floor(targetDay))),
                  Math.max(0,Math.min(23,Math.floor(targetHour))),
                  Math.max(0,Math.min(59,Math.floor(targetMinute)))
                )}>
                  跳到
                </button>
              </div>
            </div>
          </div>

          <!-- ── 角色數值 ──────────────────────── -->
          <div class="debug-group">
            <div class="debug-group-header">◇ 角色數值</div>

            <!-- Status stats -->
            <div class="player-section">
              <div class="player-section-label">狀態數值</div>
              {#each Object.entries(STATUS_LABELS) as [key, label]}
                <div class="stat-edit-row">
                  <span class="stat-edit-label">{label}</span>
                  <input
                    class="num-input"
                    type="number"
                    min="0"
                    bind:value={statInputs['statusStats.' + key]}
                    on:focus={initStatInputs}
                  />
                  <button class="trigger-btn small" on:click={() => applyStatSet('statusStats.' + key)}>套用</button>
                </div>
              {/each}
            </div>

            <!-- Primary stats -->
            <div class="player-section">
              <div class="player-section-label">主要屬性</div>
              {#each Object.entries(PRIMARY_LABELS) as [key, label]}
                <div class="stat-edit-row">
                  <span class="stat-edit-label">{label}</span>
                  <input
                    class="num-input"
                    type="number"
                    min="0"
                    bind:value={statInputs['primaryStats.' + key]}
                    on:focus={initStatInputs}
                  />
                  <button class="trigger-btn small" on:click={() => applyStatSet('primaryStats.' + key)}>套用</button>
                </div>
              {/each}
            </div>

            <!-- Secondary stats -->
            <div class="player-section">
              <div class="player-section-label">次要屬性</div>
              {#each Object.entries(SECONDARY_LABELS) as [key, label]}
                <div class="stat-edit-row">
                  <span class="stat-edit-label">{label}</span>
                  <input
                    class="num-input"
                    type="number"
                    min="0"
                    bind:value={statInputs['secondaryStats.' + key]}
                    on:focus={initStatInputs}
                  />
                  <button class="trigger-btn small" on:click={() => applyStatSet('secondaryStats.' + key)}>套用</button>
                </div>
              {/each}
            </div>

            <!-- Melphin -->
            <div class="player-section">
              <div class="player-section-label">所持金額</div>
              <div class="stat-edit-row">
                <span class="stat-edit-label">Melphin ₘ</span>
                <input
                  class="num-input"
                  type="number"
                  min="0"
                  bind:value={melphinInput}
                  on:focus={initStatInputs}
                />
                <button class="trigger-btn small" on:click={() => controller.debugSetMelphin(Math.max(0, Math.floor(melphinInput)))}>套用</button>
              </div>
            </div>

            <!-- Init button -->
            <div class="player-section">
              <button class="trigger-btn secondary" style="width:100%" on:click={initStatInputs}>
                從當前狀態填入數值
              </button>
            </div>

          </div>

        </div>

      {:else if activeTab === 'ending'}
        <div class="player-panel-debug">

          <!-- ── 當前數值快照 ──────────────────────── -->
          <div class="debug-group">
            <div class="debug-group-header">◇ 當前觸發數值</div>
            {#if $detailedPlayer}
              {@const ss = $detailedPlayer.statusStats}
              <div class="player-section">
                <div class="ending-stat-row">
                  <span class="stat-edit-label">體力</span>
                  <span class="ending-stat-val" class:ending-danger={ss.stamina <= 0}>
                    {ss.stamina} / {ss.staminaMax}
                  </span>
                  <span class="ending-condition">{ss.stamina <= 0 ? '⚠ 觸發死亡' : '正常'}</span>
                </div>
                <div class="ending-stat-row">
                  <span class="stat-edit-label">壓力</span>
                  <span class="ending-stat-val" class:ending-danger={ss.stress >= ss.stressMax}>
                    {ss.stress} / {ss.stressMax}
                  </span>
                  <span class="ending-condition">{ss.stress >= ss.stressMax ? '⚠ 觸發崩潰' : '正常'}</span>
                </div>
              </div>
            {:else}
              <div class="player-section">
                <span class="flag-hint">尚無玩家資料</span>
              </div>
            {/if}
          </div>

          <!-- ── 直接觸發結局 ──────────────────────── -->
          <div class="debug-group">
            <div class="debug-group-header">◇ 直接觸發結局畫面</div>
            <div class="player-section">
              {#each ENDINGS as e (e.type)}
                <div class="ending-trigger-row">
                  <div class="ending-trigger-info">
                    <span class="item-name">{e.label}</span>
                    <span class="item-id">{e.type}</span>
                  </div>
                  <button
                    class="trigger-btn"
                    style="border-color: {e.color}44; color: {e.color}"
                    on:click={() => controller.debugTriggerEnding(e.type)}
                  >
                    觸發
                  </button>
                </div>
              {/each}
            </div>
          </div>

          <!-- ── 位置捷徑 ──────────────────────── -->
          <div class="debug-group">
            <div class="debug-group-header">◇ 位置捷徑（MVP 路徑驗證）</div>
            <div class="player-section">
              <div class="ending-trigger-row">
                <div class="ending-trigger-info">
                  <span class="item-name">象限傳點 - 瓦爾</span>
                  <span class="item-id">wyar_transit_hub → mvp_complete</span>
                </div>
                <button class="trigger-btn" on:click={() => controller.debugTeleport('wyar_transit_hub').catch(console.error)}>
                  傳送
                </button>
              </div>
              <div class="ending-trigger-row">
                <div class="ending-trigger-info">
                  <span class="item-name">象限傳點 - 戴司</span>
                  <span class="item-id">delth_transit_hub</span>
                </div>
                <button class="trigger-btn" on:click={() => controller.debugTeleport('delth_transit_hub').catch(console.error)}>
                  傳送
                </button>
              </div>
            </div>
          </div>

        </div>
      {:else if activeTab === 'judge'}
        <div class="judge-panel">

          <!-- Shadow mode toggle -->
          <div class="judge-header">
            <span class="judge-title">DM + Judge Shadow Mode</span>
            <button
              class="shadow-toggle"
              class:shadow-on={$shadowModeActive}
              on:click={() => controller.debugToggleShadowMode()}
            >
              {$shadowModeActive ? '● ON' : '○ OFF'}
            </button>
          </div>
          <div class="judge-hint">
            {$shadowModeActive
              ? '每回合結束後自動記錄比對結果（不影響遊戲狀態）'
              : '開啟後每回合執行 DM Phase1 → Judge 並記錄差異'}
          </div>

          <!-- Comparison results -->
          {#if $shadowComparisons.length === 0}
            <div class="judge-empty">尚無比對記錄</div>
          {:else}
            {#each $shadowComparisons as cmp}
              <div class="cmp-card" class:cmp-diverged={cmp.divergences.length > 0}>
                <div class="cmp-meta">
                  <span class="cmp-turn">Turn {cmp.turn}</span>
                  <span class="cmp-type">{cmp.type === 'dialogue' ? '💬' : '🗺'}</span>
                  {#if cmp.divergences.length > 0}
                    <span class="cmp-badge-diff">⚠ {cmp.divergences.length} 差異</span>
                  {:else}
                    <span class="cmp-badge-ok">✓ 一致</span>
                  {/if}
                </div>
                <div class="cmp-action">{cmp.type === 'dialogue' ? cmp.playerInput : cmp.actionInput}</div>

                <!-- DM Proposal (Phase 1) -->
                <div class="cmp-section-label">DM Proposal (Phase 1)</div>
                {#if cmp.type === 'exploration'}
                  <div class="cmp-summary">{cmp.dmProposal.narrativeSummary ?? '—'}</div>
                  <div class="cmp-row"><span class="cmp-key">MOVE</span><span class="cmp-val">{cmp.dmProposal.move ?? '—'}</span></div>
                  <div class="cmp-row"><span class="cmp-key">TIME</span><span class="cmp-val">{cmp.dmProposal.timeMinutes ?? '—'} min</span></div>
                  <div class="cmp-row"><span class="cmp-key">FLAGS+</span><span class="cmp-val">{cmp.dmProposal.flagsSet?.join(', ') || '—'}</span></div>
                  <div class="cmp-row"><span class="cmp-key">ENC</span><span class="cmp-val">{cmp.dmProposal.encounter ? cmp.dmProposal.encounter.type + ':' + (cmp.dmProposal.encounter.npcId ?? cmp.dmProposal.encounter.encounterId ?? '') : '—'}</span></div>
                {:else}
                  <div class="cmp-summary">{cmp.dmProposal.narrativeSummary ?? '—'}</div>
                  <div class="cmp-row"><span class="cmp-key">NPC</span><span class="cmp-val">{cmp.npcId}</span></div>
                  <div class="cmp-row"><span class="cmp-key">END</span><span class="cmp-val">{cmp.dmProposal.endEncounter ? '✓' : '—'}</span></div>
                  <div class="cmp-row"><span class="cmp-key">ATT</span><span class="cmp-val">{cmp.dmProposal.npcState?.attitude ?? '—'}</span></div>
                  <div class="cmp-row"><span class="cmp-key">TIME</span><span class="cmp-val">{cmp.dmProposal.timeMinutes ?? '—'} min</span></div>
                  <div class="cmp-row"><span class="cmp-key">FLAGS+</span><span class="cmp-val">{cmp.dmProposal.flagsSet?.join(', ') || '—'}</span></div>
                {/if}

                <!-- Judge Resolution -->
                <div class="cmp-section-label">Judge Resolution</div>
                {#if cmp.type === 'exploration'}
                  <div class="cmp-row"><span class="cmp-key">MOVE</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.move ?? '—'}</span></div>
                  <div class="cmp-row"><span class="cmp-key">TIME</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.timeMinutes ?? '—'} min</span></div>
                  <div class="cmp-row"><span class="cmp-key">FLAGS+</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.flagsSet?.join(', ') || '—'}</span></div>
                  <div class="cmp-row"><span class="cmp-key">ENC</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.encounter ? cmp.judgeResolution.encounter.type + ':' + (cmp.judgeResolution.encounter.npcId ?? cmp.judgeResolution.encounter.encounterId ?? '') : '—'}</span></div>
                  {#if cmp.judgeResolution.reasoning}
                    <div class="cmp-row"><span class="cmp-key">WHY</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.reasoning}</span></div>
                  {/if}
                {:else}
                  <div class="cmp-row"><span class="cmp-key">END</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.endEncounter ? '✓' : '—'}</span></div>
                  <div class="cmp-row"><span class="cmp-key">ATT</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.npcState?.attitude ?? '—'}</span></div>
                  <div class="cmp-row"><span class="cmp-key">TIME</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.timeMinutes ?? '—'} min</span></div>
                  <div class="cmp-row"><span class="cmp-key">FLAGS+</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.flagsSet?.join(', ') || '—'}</span></div>
                  {#if cmp.judgeResolution.reasoning}
                    <div class="cmp-row"><span class="cmp-key">WHY</span><span class="cmp-val cmp-judge">{cmp.judgeResolution.reasoning}</span></div>
                  {/if}
                {/if}

                <!-- Divergences -->
                {#if cmp.divergences.length > 0}
                  <div class="cmp-section-label cmp-section-diff">差異明細</div>
                  {#each cmp.divergences as d}
                    <div class="cmp-diff-row">{d}</div>
                  {/each}
                {/if}
              </div>
            {/each}
          {/if}

        </div>
      {:else if activeTab === 'rep'}
        <div class="player-panel-debug">

          <!-- ── 陣營聲望 ──────────────────────── -->
          <div class="debug-group">
            <div class="debug-group-header">◇ 陣營聲望</div>
            <div class="player-section">
              <button class="trigger-btn secondary" style="width:100%" on:click={initRepInputs}>
                從當前狀態填入數值
              </button>
            </div>
            {#if catalog.factions.length === 0}
              <div class="player-section">
                <span class="flag-hint">尚無載入的陣營資料</span>
              </div>
            {:else}
              {#each catalog.factions as f (f.id)}
                <div class="player-section" style="padding: 6px 14px;">
                  <div class="rep-row">
                    <div class="rep-info">
                      <span class="item-name">{f.name}</span>
                      <span class="item-id">{f.id} · 預設: {f.defaultReputation}</span>
                    </div>
                    <input
                      class="num-input"
                      type="number"
                      bind:value={repInputs[f.id]}
                      on:focus={initRepInputs}
                    />
                    <button
                      class="trigger-btn small"
                      on:click={() => controller.debugSetReputation(f.id, repInputs[f.id] ?? 0)}
                    >套用</button>
                  </div>
                </div>
              {/each}
            {/if}
          </div>

          <!-- ── NPC 好感 ──────────────────────── -->
          <div class="debug-group">
            <div class="debug-group-header">◇ NPC 好感</div>
            {#if catalog.npcs.length === 0}
              <div class="player-section">
                <span class="flag-hint">尚無載入的 NPC 資料</span>
              </div>
            {:else}
              {#each catalog.npcs as n (n.id)}
                <div class="player-section" style="padding: 6px 14px;">
                  <div class="rep-row">
                    <div class="rep-info">
                      <span class="item-name">{n.name}</span>
                      <span class="item-id">{n.id}</span>
                    </div>
                    <input
                      class="num-input"
                      type="number"
                      bind:value={affinityInputs[n.id]}
                      on:focus={initRepInputs}
                    />
                    <button
                      class="trigger-btn small"
                      on:click={() => controller.debugSetAffinity(n.id, affinityInputs[n.id] ?? 0)}
                    >套用</button>
                  </div>
                </div>
              {/each}
            {/if}
          </div>

        </div>
      {:else if activeTab === 'dice'}
        <div class="player-panel-debug">

          <div class="debug-group">
            <div class="debug-group-header">◇ 骰子動畫測試</div>
            <div class="player-section">

              <!-- Dice type -->
              <div class="stat-edit-row">
                <span class="stat-edit-label">骰型</span>
                <div class="dice-type-btns">
                  {#each DICE_TYPES as dt}
                    <button
                      class="trigger-btn"
                      class:dice-type-active={diceSides === dt.sides}
                      on:click={() => { diceSides = dt.sides; diceRollVal = Math.min(diceRollVal, dt.sides); }}
                    >{dt.label}</button>
                  {/each}
                </div>
              </div>

              <!-- Stat -->
              <div class="stat-edit-row">
                <span class="stat-edit-label">屬性</span>
                <select class="dice-select" bind:value={diceStat}>
                  {#each DICE_STATS as s}
                    <option value={s}>{s}</option>
                  {/each}
                </select>
              </div>

              <!-- Roll value -->
              <div class="stat-edit-row">
                <span class="stat-edit-label">骰值 (1–{diceSides})</span>
                <input class="num-input" type="number" min="1" max={diceSides} bind:value={diceRollVal} />
              </div>

              <!-- Stat modifier -->
              <div class="stat-edit-row">
                <span class="stat-edit-label">屬性加值</span>
                <input class="num-input" type="number" min="-10" max="20" bind:value={diceStatMod} />
              </div>

              <!-- External modifier -->
              <div class="stat-edit-row">
                <span class="stat-edit-label">補正</span>
                <input class="num-input" type="number" min="-20" max="20" bind:value={diceExtMod} />
              </div>

              <!-- DC -->
              <div class="stat-edit-row">
                <span class="stat-edit-label">DC</span>
                <input class="num-input" type="number" min="1" max="40" bind:value={diceDC} />
              </div>

              <!-- Summary -->
              <div class="dice-preview">
                <span class="dice-preview-eq">{diceRollVal} + {diceStatMod} + {diceExtMod} = <strong style="color:{dicePreviewPassed ? '#7ec8a0' : '#d35f5f'}">{dicePreviewTotal}</strong> vs DC {diceDC}</span>
                <span class="dice-preview-result" style="color:{dicePreviewPassed ? '#7ec8a0' : '#d35f5f'}">{dicePreviewPassed ? '成功' : '失敗'}</span>
              </div>

              <button class="trigger-btn" style="width:100%; margin-top:4px" on:click={triggerDiceTest}>
                觸發判定動畫
              </button>
            </div>
          </div>

        </div>
      {/if}

    </div>
  </div>
</div>

<style>
  .debug-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 500;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 48px;
  }

  .debug-panel {
    width: min(760px, 92vw);
    max-height: 70vh;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-top: 2px solid #5fa8d3;
    display: flex;
    flex-direction: column;
    font-family: var(--font-mono);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  /* Header */
  .debug-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .debug-title {
    font-size: 11px;
    color: #5fa8d3;
    letter-spacing: 0.1em;
    flex-shrink: 0;
  }

  .debug-search {
    flex: 1;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 3px 8px;
    outline: none;
  }

  .debug-search:focus {
    border-color: #5fa8d3;
  }

  .reset-btn {
    background: none;
    border: 1px solid #c9a96e55;
    color: #c9a96e;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    padding: 2px 9px;
    cursor: pointer;
    border-radius: 2px;
    flex-shrink: 0;
    transition: border-color 0.1s, background 0.1s;
  }

  .reset-btn:hover:not(:disabled) {
    border-color: #c9a96e;
    background: rgba(201, 169, 110, 0.1);
  }

  .reset-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .console-btn {
    background: none;
    border: 1px solid #5fa8d355;
    color: #5fa8d3;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    padding: 2px 9px;
    cursor: pointer;
    border-radius: 2px;
    flex-shrink: 0;
    transition: border-color 0.1s, background 0.1s;
  }

  .console-btn:hover {
    border-color: #5fa8d3;
    background: rgba(95, 168, 211, 0.1);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 6px;
    flex-shrink: 0;
  }

  .close-btn:hover { color: var(--text-primary); }

  /* Tab bar */
  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--bg-secondary);
  }

  .tab-btn {
    background: none;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 5px 12px;
    cursor: pointer;
    letter-spacing: 0.05em;
    transition: color 0.1s, background 0.1s;
  }

  .tab-btn:hover { color: var(--text-secondary); }

  .tab-btn.active {
    color: #5fa8d3;
    background: color-mix(in srgb, #5fa8d3 6%, var(--bg-secondary));
    border-bottom: 1px solid #5fa8d3;
  }

  /* Content */
  .tab-content {
    overflow-y: auto;
    flex: 1;
    padding: 4px 0;
  }

  /* Item list */
  .item-list {
    display: flex;
    flex-direction: column;
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    transition: background 0.08s;
  }

  .item-row:hover {
    background: var(--bg-secondary);
  }

  .item-type-badge {
    font-size: 9px;
    min-width: 60px;
    letter-spacing: 0.06em;
    flex-shrink: 0;
    opacity: 0.85;
  }

  .item-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .item-name {
    font-size: 12px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-id {
    font-size: 9px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .trigger-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 10px;
    cursor: pointer;
    border-radius: 2px;
    flex-shrink: 0;
    transition: border-color 0.1s, color 0.1s;
  }

  .trigger-btn:hover {
    border-color: #5fa8d3;
    color: #5fa8d3;
  }

  .trigger-btn-disabled,
  .trigger-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
    pointer-events: none;
  }

  .item-stack-label {
    color: var(--text-dim);
    font-size: 9px;
  }

  .trigger-btn.secondary {
    opacity: 0.6;
    font-size: 9px;
  }

  .trigger-btn.secondary:hover {
    border-color: #c9a96e;
    color: #c9a96e;
    opacity: 1;
  }

  .empty {
    padding: 12px 16px;
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
  }

  /* Flag panel */
  .flag-panel {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .flag-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .flag-input {
    flex: 1;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 8px;
    outline: none;
  }

  .flag-input:focus { border-color: #5fa8d3; }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .flag-hint {
    font-size: 10px;
    color: var(--text-dim);
    margin: 0;
    line-height: 1.5;
  }

  /* Player state tab */
  .debug-group {
    border-bottom: 2px solid var(--border);
    margin-bottom: 0;
  }

  .debug-group-header {
    font-size: 9px;
    letter-spacing: 0.12em;
    color: #5fa8d3;
    padding: 6px 14px 4px;
    background: color-mix(in srgb, #5fa8d3 5%, var(--bg-secondary));
    border-bottom: 1px solid var(--border);
    text-transform: uppercase;
  }

  .player-panel-debug {
    display: flex;
    flex-direction: column;
    padding: 4px 0;
  }

  .player-section {
    padding: 8px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .player-section-label {
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    text-transform: uppercase;
    margin-bottom: 2px;
  }

  .time-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .time-field {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .time-field-label {
    font-size: 10px;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .stat-edit-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stat-edit-label {
    font-size: 10px;
    color: var(--text-secondary);
    flex: 1;
    min-width: 60px;
  }

  .num-input {
    width: 64px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 6px;
    outline: none;
    text-align: right;
    flex-shrink: 0;
  }

  .num-input.wide { width: 80px; }
  .time-field.wide { flex: 1; }

  .num-input:focus {
    border-color: #5fa8d3;
  }

  .trigger-btn.small {
    font-size: 9px;
    padding: 2px 7px;
  }

  /* Ending tab */
  .ending-stat-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ending-stat-val {
    font-size: 11px;
    color: var(--text-primary);
    min-width: 60px;
    text-align: right;
    flex-shrink: 0;
  }

  .ending-stat-val.ending-danger {
    color: #d35f5f;
  }

  .ending-condition {
    font-size: 9px;
    color: var(--text-dim);
    flex: 1;
    text-align: right;
  }

  .ending-trigger-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .ending-trigger-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  /* ── Judge tab ───────────────────────────── */
  .judge-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0;
  }
  .judge-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .judge-title {
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    text-transform: uppercase;
  }
  .shadow-toggle {
    font-size: 10px;
    font-family: var(--font-mono, monospace);
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.1s;
  }
  .shadow-toggle.shadow-on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .judge-hint {
    font-size: 9px;
    color: var(--text-dim);
    opacity: 0.7;
  }
  .judge-empty {
    font-size: 10px;
    color: var(--text-dim);
    opacity: 0.4;
    text-align: center;
    padding: 16px 0;
  }

  .cmp-card {
    border: 1px solid var(--border);
    border-radius: 2px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: rgba(0,0,0,0.1);
  }
  .cmp-card.cmp-diverged {
    border-color: #5a3a10;
    background: rgba(90,50,0,0.08);
  }
  .cmp-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }
  .cmp-turn {
    font-size: 10px;
    font-family: var(--font-mono, monospace);
    color: var(--text-dim);
  }
  .cmp-badge-ok {
    font-size: 9px;
    color: #5fa880;
  }
  .cmp-badge-diff {
    font-size: 9px;
    color: #c98040;
  }
  .cmp-action {
    font-size: 10px;
    color: var(--text-secondary);
    font-style: italic;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cmp-section-label {
    font-size: 8.5px;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    text-transform: uppercase;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid rgba(255,255,255,0.04);
  }
  .cmp-section-diff {
    color: #c98040;
  }
  .cmp-summary {
    font-size: 10px;
    color: var(--text-secondary);
    line-height: 1.4;
    padding: 2px 0;
  }
  .cmp-row {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .cmp-key {
    font-size: 8.5px;
    font-family: var(--font-mono, monospace);
    color: var(--text-dim);
    width: 48px;
    flex-shrink: 0;
  }
  .cmp-val {
    font-size: 9.5px;
    font-family: var(--font-mono, monospace);
    color: var(--text-secondary);
    word-break: break-all;
  }
  .cmp-judge {
    color: #7ec8c8;
  }
  .cmp-diff-row {
    font-size: 9px;
    font-family: var(--font-mono, monospace);
    color: #c98040;
    padding-left: 4px;
    word-break: break-all;
  }

  /* Rep/affinity tab */
  .rep-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rep-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  /* Dice test tab */
  .dice-type-btns {
    display: flex;
    gap: 4px;
  }

  .dice-type-active {
    border-color: #5fa8d3;
    color: #5fa8d3;
  }

  .dice-select {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 6px;
    outline: none;
    flex: 1;
  }

  .dice-select:focus { border-color: #5fa8d3; }

  .dice-preview {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 2px;
    margin-top: 4px;
  }

  .dice-preview-eq {
    font-size: 10px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .dice-preview-result {
    font-size: 10px;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.08em;
  }
</style>
