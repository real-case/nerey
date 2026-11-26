import { describe, expect, it } from 'vitest';

import { isNeverExpires, NEVER_EXPIRES } from '../lifecycle/expiry';
import { builtInWidgets } from './catalog';
import { builtInWidgetContracts } from './contracts';

/**
 * ADR 0056 — each built-in entry is its contract plus a component, so what a server describes from
 * `builtInWidgetContracts` is what the client registers from `builtInWidgets`.
 */
describe('builtInWidgetContracts', () => {
  it('lists one contract per entry, in the same order', () => {
    expect(builtInWidgetContracts.map((c) => `${c.type}@${c.version}`)).toEqual(
      builtInWidgets.map((e) => `${e.type}@${e.version}`),
    );
  });

  it('is each entry without its component, field by field', () => {
    builtInWidgets.forEach((entry, index) => {
      const { component, ...rest } = entry;
      expect(typeof component).toBe('function');
      const contract = builtInWidgetContracts[index];
      expect(Object.keys(rest).sort()).toEqual(Object.keys(contract ?? {}).sort());
      for (const [key, value] of Object.entries(rest)) {
        expect(contract?.[key as keyof typeof contract], `${entry.type}.${key}`).toBe(value);
      }
    });
  });

  it('carries no component', () => {
    for (const contract of builtInWidgetContracts) expect('component' in contract).toBe(false);
  });
});

describe('isNeverExpires', () => {
  it('recognises the constant and rejects a copy with the same shape', () => {
    expect(isNeverExpires(NEVER_EXPIRES)).toBe(true);
    expect(isNeverExpires({ ...NEVER_EXPIRES })).toBe(false);
    expect(isNeverExpires({ persist: 'forever', expiry: [], afterExpiry: 'snapshot' })).toBe(false);
  });
});
