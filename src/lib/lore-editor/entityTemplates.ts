/**
 * Default templates for new entities by type.
 * Returns a minimal valid JSON object for the given entity type.
 */
import type { EntityType } from './entityTypes';

export function getEntityTemplate(type: EntityType, id: string): unknown {
  switch (type) {
    case 'location':
      return {
        id,
        name: '',
        regionId: 'crambell',
        districtId: '',
        tags: [],
        base: {
          name: '',
          description: '',
          ambience: [],
          connections: [],
          npcIds: [],
          eventIds: [],
          propIds: [],
          isAccessible: true,
        },
        sublocations: [],
      };
    case 'npc':
      return {
        id,
        name: '',
        defaultLocationId: '',
        factionId: '',
        publicDescription: '',
        secretLayers: [],
        schedule: [],
        dialogueId: '',
        dialogueRules: [],
        questIds: [],
      };
    case 'event':
      return {
        id,
        description: '',
        condition: {},
        outcomes: [{ id: 'default', description: '', weight: 1 }],
        isRepeatable: false,
      };
    case 'encounter':
      return {
        id,
        name: '',
        type: 'event',
        description: '',
        entryNodeId: 'start',
        nodes: {
          start: {
            id: 'start',
            dmNarrative: '',
            choices: [],
          },
        },
      };
    case 'dialogue':
      return {
        id,
        npcId: '',
        defaultContext: '',
        nodes: {},
        triggers: [],
        contextSnippets: [],
      };
    case 'quest':
      return {
        id,
        name: '',
        type: 'side',
        source: '',
        regionId: 'crambell',
        entryStageId: 'start',
        autoAccept: false,
        isRepeatable: false,
        canDitch: true,
        stages: {
          start: {
            id: 'start',
            description: '',
            objectives: [],
          },
        },
      };
    case 'item':
      return {
        id,
        name: '',
        description: '',
        type: 'key',
        obtainedFrom: [],
        stackable: false,
        isTemplate: false,
      };
    case 'prop':
      return {
        id,
        name: '',
        description: '',
        tags: [],
        checkPrompt: '',
      };
    case 'faction':
      return {
        id,
        name: '',
        regionId: 'crambell',
        description: '',
        defaultReputation: 0,
        relations: [],
      };
    case 'flag':
      return [
        {
          flagId: '',
          description: '',
          setCondition: '',
          unsetCondition: '',
          proximity: {},
        },
      ];
    case 'district':
      return {
        id,
        name: '',
        regionId: 'crambell',
        description: '',
        ambience: [],
        hasCheckpoint: false,
        regionCustom: {},
        locationIds: [],
      };
    case 'intel':
      return {
        id,
        label:       '',
        description: '',
        category:    'rumor',
      };
    default:
      return { id };
  }
}

/** Generate a filename from type and id. */
export function generateFilename(type: EntityType, id: string): string {
  // Ensure .json extension and clean characters
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return `${clean}.json`;
}
