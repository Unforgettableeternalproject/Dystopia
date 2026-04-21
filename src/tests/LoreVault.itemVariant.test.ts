import { describe, it, expect } from 'vitest';
import { LoreVault } from '../lib/lore/LoreVault';
import { FlagSystem } from '../lib/engine/FlagSystem';
import { EventBus } from '../lib/engine/EventBus';
import type { LocationConnection } from '../lib/types';

describe('LoreVault item variant access', () => {
  it('requires a matching variantId for transit passes', () => {
    const vault = new LoreVault();
    const flags = new FlagSystem(new EventBus(), []);
    const conn: LocationConnection = {
      targetLocationId: 'wyar_transit_hub',
      description: 'to wyar',
      access: {
        itemRequirements: [{ itemId: 'transit_pass', variantId: 'wyar' }],
      },
    };

    const withMatchingVariant = vault.canAccessConnection(
      conn,
      flags,
      'rest',
      [],
      [],
      undefined,
      [{ instanceId: 'match', itemId: 'transit_pass', variantId: 'wyar', obtainedAtMinute: 0, quantity: 1, isExpired: false }],
    );

    const withWrongVariant = vault.canAccessConnection(
      conn,
      flags,
      'rest',
      [],
      [],
      undefined,
      [{ instanceId: 'wrong', itemId: 'transit_pass', variantId: 'famein', obtainedAtMinute: 0, quantity: 1, isExpired: false }],
    );

    expect(withMatchingVariant).toBe(true);
    expect(withWrongVariant).toBe(false);
  });

  it('supports a morning-only transfer window via timeRanges', () => {
    const vault = new LoreVault();
    const flags = new FlagSystem(new EventBus(), []);
    const conn: LocationConnection = {
      targetLocationId: 'wyar_transit_hub',
      description: 'to wyar',
      access: {
        timeRanges: [
          { startHour: 0, startMinute: 0, endHour: 5, endMinute: 59 },
        ],
        itemRequirements: [{ itemId: 'transit_pass', variantId: 'wyar' }],
      },
    };

    const inventory = [
      { instanceId: 'match', itemId: 'transit_pass', variantId: 'wyar', obtainedAtMinute: 0, quantity: 1, isExpired: false },
    ];

    expect(
      vault.canAccessConnection(
        conn,
        flags,
        'rest',
        [],
        [],
        { year: 1498, month: 6, day: 12, hour: 5, minute: 30, totalMinutes: 0 },
        inventory,
      ),
    ).toBe(true);

    expect(
      vault.canAccessConnection(
        conn,
        flags,
        'rest',
        [],
        [],
        { year: 1498, month: 6, day: 12, hour: 18, minute: 30, totalMinutes: 0 },
        inventory,
      ),
    ).toBe(false);
  });
});
