# Dystopia - v0.1.0-dev

"Exy!!! Look at this! I think I've made a interactive game about the area divided era! ╰(*°▽°*)╯"
"What, is it like, a real REAL game? With graphics and stuff?"

"Uhh, no. It's text-based. But it's got a DM and everything! You want to try it out? ( •̀ ω •́ )✧"
"Well haven't you make a similar thing before? The... 'Pure Town' or something?"

"Nahhhh, this one is way more ambitious. It's got a whole world, with different districts and NPCs and lore. And the DM is powered by an LLM, so it can adapt to whatever you do! (ง •̀_•́)ง"
"Technology is really something, huh? I guess it could be fun."

## Project Overview

**Dystopia** is an LLM-driven theatrical interactive RPG set in the *Destiny Weaver* universe (Area Divided Era) — a world of twelve districts divided by barriers, governed by identity locks, and shaped by forces the player may never fully understand.

The game operates like a guided TRPG: a **DM** narrates the world and voices NPCs, while a **Regulator** enforces the hard boundary between what a player *wants* to do and what they're actually *capable* of. The result is a text-based experience with coherent story, branching consequences, and natural character growth — no level-up screens, no arbitrary menus.

**MVP setting:** Campbell (District 3) — an industrial military state built on mining quotas, rigid hierarchy, and the quiet weight of complicity.

## Tech Stack

- **Frontend**: Svelte + TypeScript (Vite)
- **Desktop packaging**: Tauri
- **AI backend**: Anthropic SDK (TypeScript)
- **Lore data**: JSON vault with indexed nodes
- **Game state**: In-memory + local persistence via Tauri filesystem API

## Project Structure

```
Dystopia/
├── src/
│   ├── lib/
│   │   ├── components/      # NarrativeBox, ChoicePanel, ThoughtBubble, StatusBar
│   │   ├── engine/          # GameEngine, StateManager, FlagSystem, EventBus
│   │   ├── ai/              # DMAgent, Regulator, AnthropicClient
│   │   ├── lore/            # LoreVault access layer
│   │   └── types/           # GameState, PlayerState, LocationNode, NPCNode
│   └── routes/
├── src-tauri/               # Tauri configuration
├── lore/                    # World data (JSON)
│   ├── world/               # Global lore (regions, currency, rules)
│   ├── campbell/            # District 3 locations, NPCs, events
│   └── items/
└── docs/                    # Design documents
```

## Development Status

### Sprint 0 — Foundation (Current)
- Project scaffold (Tauri + Svelte + TypeScript)
- Core type definitions
- Lore Vault skeleton (Campbell)
- Basic architecture

### Sprint 1 — Vertical Slice (Next)
- DM Agent with streaming narration
- Regulator with action validation
- Player state management
- Single playable scene in Campbell

## Contributors

❦ Main contributors:
- ඩ unforgettableeternalproject (Bernie)

## License

Private project. All rights reserved.
