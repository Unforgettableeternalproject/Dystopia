// GameController.factionGraph.test.ts
//
// Tests for factionGraphUI computation in syncUIState.
// Covers:
//   - No output when no factions discovered
//   - Discovery via contactedFactions (0-rep contact)
//   - Discovery via non-zero reputation
//   - unknownUntil hides name as '???' until intel is known
//   - Edges appear only when both endpoint factions are discovered

import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { GameController } from '../lib/engine/GameController';
import { playerUI } from '../lib/stores/gameStore';
import type { ILLMClient, ChatMessage } from '../lib/ai/ILLMClient';
import type { LocationNode, RegionIndex } from '../lib/types';
import type { Faction, FactionGraphDefinition } from '../lib/types/world';
import type { StateManager } from '../lib/engine/StateManager';

// ── Minimal scripted client (unused in sync-only tests) ──────────────────────

class NoopClient implements ILLMClient {
  async complete(_sys: string, _msg: string): Promise<string> {
    return JSON.stringify({ allowed: true, reason: null, modifiedInput: null, actionType: null, targetId: null });
  }
  async *stream(_sys: string, _msgs: ChatMessage[]): AsyncGenerator<string> { /* no-op */ }
}

// ── Minimal lore fixtures ─────────────────────────────────────────────────────

function makeLocation(): LocationNode {
  return {
    id: 'test_loc',
    name: 'Test Location',
    regionId: 'crambell',
    tags: [],
    base: {
      description: 'A test room.',
      ambience: [],
      connections: [],
      npcIds: [],
      eventIds: [],
      propIds: [],
      isAccessible: true,
    },
    localVariants: [],
  };
}

function makeRegion(): RegionIndex {
  return {
    id: 'crambell',
    name: 'Crambell',
    theme: 'test',
    locationIds: ['test_loc'],
    npcIds: [],
    questIds: [],
    factionIds: ['faction_public', 'faction_secret'],
    globalEventIds: [],
  };
}

const factionPublic: Faction = {
  id: 'faction_public',
  name: '公開派系',
  regionId: 'crambell',
  description: 'A well-known faction.',
  defaultReputation: 0,
  // no unknownUntil → player knows name on first contact
};

const factionSecret: Faction = {
  id: 'faction_secret',
  name: '秘密派系',
  regionId: 'crambell',
  description: 'An organisation whose identity is hidden.',
  defaultReputation: 0,
  unknownUntil: 'secret_faction',
};

const factionGraph: FactionGraphDefinition = {
  id: 'crambell',
  factionIds: ['faction_public', 'faction_secret'],
  edges: [{ a: 'faction_public', b: 'faction_secret', weight: -1 }],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeController(): GameController {
  const client = new NoopClient();
  const gc = new GameController({ dm: client, regulator: client });
  gc.loadLore({
    locations: { test_loc: makeLocation() },
    regions:   { crambell: makeRegion() },
    factions:  { faction_public: factionPublic, faction_secret: factionSecret },
    factionGraphs: { crambell: factionGraph },
  });
  return gc;
}

/** Direct access to the private StateManager inside GameController. */
function stateOf(gc: GameController): StateManager {
  return (gc as unknown as { state: StateManager }).state;
}

/** Force syncUIState to run immediately with current game state. */
function syncUI(gc: GameController): void {
  const gs = stateOf(gc).getState();
  (gc as unknown as { syncUIState: (gs: unknown) => void }).syncUIState(gs);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GameController factionGraphUI', () => {
  it('returns undefined when no factions are discovered', () => {
    const gc = makeController();
    syncUI(gc);
    expect(get(playerUI).factionGraphUI).toBeUndefined();
  });

  it('shows discovered faction via contactedFactions (zero rep)', () => {
    const gc = makeController();
    stateOf(gc).contactFaction('faction_public');
    syncUI(gc);

    const graph = get(playerUI).factionGraphUI;
    expect(graph).toBeDefined();
    expect(graph!.nodes).toHaveLength(1);
    expect(graph!.nodes[0].id).toBe('faction_public');
    expect(graph!.nodes[0].displayName).toBe('公開派系');
    expect(graph!.nodes[0].rep).toBe(0);
    expect(graph!.nodes[0].revealed).toBe(true);
  });

  it('shows faction with non-zero reputation even without explicit contactFaction call', () => {
    const gc = makeController();
    // modifyReputation auto-contacts the faction too
    stateOf(gc).modifyReputation('faction_public', 5);
    syncUI(gc);

    const graph = get(playerUI).factionGraphUI;
    expect(graph).toBeDefined();
    expect(graph!.nodes[0].id).toBe('faction_public');
    expect(graph!.nodes[0].rep).toBe(5);
  });

  it('shows secret faction as ??? before unknownUntil flag is set', () => {
    const gc = makeController();
    stateOf(gc).contactFaction('faction_secret');
    syncUI(gc);

    const graph = get(playerUI).factionGraphUI;
    expect(graph).toBeDefined();
    expect(graph!.nodes).toHaveLength(1);
    expect(graph!.nodes[0].displayName).toBe('???');
    expect(graph!.nodes[0].revealed).toBe(false);
  });

  it('reveals secret faction name once unknownUntil intel is known', () => {
    const gc = makeController();
    stateOf(gc).contactFaction('faction_secret');
    stateOf(gc).grantIntel('secret_faction');
    syncUI(gc);

    const graph = get(playerUI).factionGraphUI;
    expect(graph!.nodes[0].displayName).toBe('秘密派系');
    expect(graph!.nodes[0].revealed).toBe(true);
  });

  it('hides an edge when only one of its endpoint factions is discovered', () => {
    const gc = makeController();
    stateOf(gc).contactFaction('faction_public');   // only one side
    syncUI(gc);

    const graph = get(playerUI).factionGraphUI;
    expect(graph!.edges).toHaveLength(0);
  });

  it('shows the edge once both endpoint factions are discovered', () => {
    const gc = makeController();
    stateOf(gc).contactFaction('faction_public');
    stateOf(gc).contactFaction('faction_secret');
    syncUI(gc);

    const graph = get(playerUI).factionGraphUI;
    expect(graph!.edges).toHaveLength(1);
    expect(graph!.edges[0].weight).toBe(-1);
  });
});
