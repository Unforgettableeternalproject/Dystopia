# Dystopia - Project Overview

## Project Introduction

Dystopia is an **LLM-driven theatrical text RPG** set in the Destiny Weaver universe. Built as a Tauri 2 desktop application with SvelteKit, it delivers coherent tabletop RPG storytelling through a multi-agent AI architecture — a DM agent handles narrative generation, a Regulator validates player actions against stat boundaries, and a Judge verifies the DM's constraint compliance. The game features a complete engine with event systems, quest management, dice mechanics, dialogue trees, and faction relationships.

### Core Philosophy
- **Narrative Immersion**: No traditional game UI — players experience the world purely through prose, scripted encounters, and NPC dialogue
- **Logical Consistency**: Every action is validated against character stats and world rules by the Regulator before the DM processes it
- **Lore-Driven Context**: The DM only receives scene-relevant lore fragments, keeping token usage efficient while maintaining world coherence
- **Emergent Gameplay**: Flag-driven event system with conditions (time, reputation, items, NPC presence) creates dynamic world reactions

---

## My Responsibilities

As the sole developer of the project, I am responsible for:

### System Architecture Design
- Designed multi-agent AI architecture: DM (two-phase narrative) → Regulator (action validation) → Judge (constraint verification)
- Architected complete game engine with event triggers, quest lifecycle, encounter flow, and state management
- Designed Lore Vault system with structured JSON data (locations, NPCs, events, encounters, quests, props, items, intel)

### Core Engine Implementation
- **GameController**: Main turn pipeline — Regulator validation → event triggers → DM narration → quest checks → UI sync
- **EventEngine**: Comprehensive trigger system supporting flag conditions, time-of-day, probability, NPC presence, item possession, reputation thresholds, cooldowns
- **QuestEngine**: Full quest lifecycle (grant / advance / complete / fail / abandon / timed)
- **DialogueManager**: Scripted dialogue trees + LLM-powered dynamic conversation
- **EncounterEngine**: Structured encounter flow with story-type encounters
- **DiceEngine**: D&D-style dice system (1d20, advantage/disadvantage, stat modifier = floor((stat-8)/3))
- **ExperienceEngine**: Skill XP system (levels 1–20 with aptitude mechanics)
- **TimeManager / PhaseManager / FlagSystem / RestResolver**: Supporting systems

### AI Layer
- **DMAgent**: Two-phase architecture — Phase 1 produces intent JSON, Phase 2 streams narrative prose
- **Regulator**: Validates player actions against stat boundaries and world rules
- **JudgeAgent**: Verifies DM Phase 1 output for constraint compliance
- **Multi-backend**: Anthropic Claude (primary), HuggingFace, local model support via LLMClientFactory

### World-Building (Crambell / Fourth Quadrant)
- 10 locations, 6 NPCs with dialogue files, 31 events, 22 encounters, 10 quests, 18 props, 9 items, 5 intel documents
- 5 escape routes with branching storylines and flag-driven progression
- Complete story flow for Routes 1, 4, and 5; Routes 2 and 3 planned for MVP v2

---

## Core Features

### 1. Multi-Agent AI Architecture
- **DMAgent** (two-phase): Intent JSON generation → streaming narrative prose with scene-scoped lore injection
- **Regulator**: Hard validation of player actions against stat boundaries before DM processing
- **JudgeAgent**: Independent verification of DM constraint compliance
- Clear separation of concerns: narrative creativity → rule enforcement → quality assurance

### 2. Complete Game Engine
- **Turn Pipeline**: Player input → Regulator → Event triggers → DM narration → Quest checks → UI sync
- **Event System**: 31+ events with complex trigger conditions (flags, time, probability, NPC presence, items, reputation)
- **Quest System**: Full lifecycle with timed quests, multi-step progression, and branch tracking
- **Dice System**: D&D-inspired 1d20 rolls with advantage/disadvantage and stat modifiers
- **Faction & Reputation**: Relationship tracking affecting NPC interactions and event availability

### 3. Rich World Data (Crambell)
- **Locations**: Dormitory, mines, forest, warehouse, patrol zones, transit points — each with props and observe interactions
- **NPCs**: 6 fully characterized NPCs (Kach, Mildore, Kane, Elowan, Karin, Orland) with scripted dialogue and relationship dynamics
- **Story Routes**: 5 planned escape routes from the mining colony, 3 substantially implemented
- **Dynamic Events**: Time-of-day cycling, flag-gated progression, cooldown-based encounters

### 4. 27 UI Components
- NarrativePanel, EncounterPanel, ScriptedChoicePanel for gameplay
- InventoryModal, QuestListModal, QuestDetailModal for management
- MiniMap, RegionMap, TransitMapOverlay for navigation
- StatCheckOverlay, RestModal, DangerOverlay (near-death particle effects) for mechanics
- DebugPanel, FactionGraphModal for development

### 5. Tauri Desktop Application
- SvelteKit frontend with TypeScript
- Tauri 2 Rust shell for cross-platform desktop packaging
- Local filesystem persistence via Tauri APIs

---

## Technologies Used

### Frontend
- **SvelteKit**: Reactive UI framework with Vite bundling
- **TypeScript**: Type-safe development
- **Tauri 2**: Rust-based desktop application framework

### AI / LLM
- **Anthropic SDK** (`@anthropic-ai/sdk`): Claude integration for DM, Regulator, and Judge agents
- **HuggingFace Client**: Alternative LLM backend
- **NotebookLM** (`notebooklm-client`): External world-lore knowledge base

### Development
- **Vitest**: 24 test files including route integration tests
- **pnpm**: Package management

---

## Project Status

### Current Version: MVP v1 (feature/MVP_v1 branch)
- ✅ Complete game engine (GameController, EventEngine, QuestEngine, EncounterEngine, DiceEngine, ExperienceEngine)
- ✅ Multi-agent AI layer (DM two-phase, Regulator, Judge)
- ✅ 27 UI components fully implemented
- ✅ Crambell world data: 10 locations, 6 NPCs, 31 events, 22 encounters, 10 quests
- ✅ Route 1 (transfer application): playable
- ✅ Route 4 (Kane double agent): mostly complete
- 🔄 Route 5 (Kach tests → Orland escape): 60-70% complete
- 🔄 Known flag logic issues (Mildore rescue deadlock, permit flag gaps)
- ❌ Routes 2 & 3: planned for MVP v2

### Testing Status
- 24 test files including route-specific integration tests
- CrambellRoute1/4/5 integration tests
- GameController event flow and scripted trigger tests
- QuestEngine lifecycle tests

### Known Issues
- Flag syntax inconsistency (`& | !` vs `AND/OR/NOT`)
- `crambell_mildore_rescue` flag circular deadlock
- Some NPC dialogue files have TODO placeholders (Kane, Orland, Mildore)

---

## Development Challenges & Achievements

### 1. Two-Phase DM Architecture
**Challenge**: How to get structured game data (stat changes, item grants, NPC reactions) from an LLM while also producing immersive narrative prose?

**Solution**: Split DM into two phases — Phase 1 generates a structured intent JSON (stat changes, flags, items), Phase 2 uses that intent to stream literary narrative. The Judge independently verifies Phase 1 compliance.

**Achievement**: Clean separation between game mechanics and narrative output, enabling reliable state updates while preserving creative storytelling.

### 2. Complex Event Trigger System
**Challenge**: World events need to react to dozens of conditions — time of day, player flags, NPC presence, item possession, reputation levels, cooldowns, probability.

**Solution**: Built EventEngine with composable condition evaluation supporting nested flag logic, time-slot matching, and multi-criteria gates.

**Achievement**: 31 events in Crambell alone, creating a dynamic world that reacts to player choices across multiple sessions.

### 3. Multi-Route Branching Narrative
**Challenge**: 5 escape routes with interconnecting NPCs, shared flags, and mutually exclusive outcomes create exponential complexity.

**Solution**: Flag-driven progression with FlagRegistry manifests, route integration tests verifying complete paths, and careful NPC interaction design preventing deadlocks.

**Achievement**: Three substantially implemented escape routes with branching sub-paths, verified by automated integration tests.

---

## Future Roadmap

### MVP v1 Remaining
- Complete Route 5 (Kach test 3 → Orland final transit)
- Fix flag logic issues (Mildore rescue deadlock, permit gaps)
- DM dynamic GRANT/REVOKE signal system
- Audio/music system

### MVP v2
- New encounter types (combat, shop)
- Equipment system
- Journal/log system
- Crime/wanted system
- Third quadrant expansion
- Capture mechanics
- Complete Routes 2 & 3

### Long-term
- Multi-region travel with persistent world state
- Additional regions beyond Crambell
- Community-contributed lore expansion

---

## Project Highlights

### Technical Innovation
- ✅ Two-phase DM architecture (intent JSON → streaming narrative) with independent Judge verification
- ✅ Comprehensive event system with 10+ condition types and flag-driven world state
- ✅ D&D-inspired dice mechanics with stat modifiers and advantage/disadvantage

### Content Achievement
- ✅ 10 locations, 6 NPCs, 31 events, 22 encounters, 10 quests in Crambell alone
- ✅ 5 designed escape routes with 3 substantially implemented
- ✅ Route integration tests verifying complete storyline paths

### Development Quality
- ✅ 24 test files with route-specific integration coverage
- ✅ Multi-LLM backend support (Anthropic, HuggingFace, local)
- ✅ Structured lore data enabling systematic world expansion

---

**Tech Stack**: SvelteKit, TypeScript, Tauri 2 (Rust), Anthropic Claude, Vitest
**Engine Systems**: GameController, EventEngine, QuestEngine, EncounterEngine, DiceEngine, ExperienceEngine
**World Data**: 10 locations, 6 NPCs, 31 events, 22 encounters, 10 quests (Crambell)
**Current Phase**: MVP v1 — Routes 1/4 playable, Route 5 in progress
