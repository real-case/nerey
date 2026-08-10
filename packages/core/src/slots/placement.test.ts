import { NEVER_EXPIRES } from '../lifecycle/expiry';
import { asAnyWidget, createWidgetRegistry, defineWidget, emptyRegistry } from '../registry';
import type { AnyWidgetRegistryEntry, NereyMessage, Placement } from '../types';
import {
  DEFAULT_INPUT_POSITION,
  belongsInTranscript,
  inputPositionOf,
  inputSlotAttributes,
  isDismissible,
  overlaySlotAttributes,
  resolvedPlacement,
} from './placement';

function entry(type: string, placement: Placement): AnyWidgetRegistryEntry {
  return asAnyWidget(
    defineWidget({
      type,
      version: '1.0.0',
      placement,
      lifecycle: NEVER_EXPIRES,
      // Nothing renders from these fixtures; placement resolution reads the entry, not the tree.
      component: () => null,
    }),
  );
}

function message(id: string, type: string | undefined): NereyMessage {
  if (type === undefined) return { id, role: 'assistant', text: 'plain' };
  return {
    id,
    role: 'assistant',
    text: 'plain',
    widget: { type, version: '1.0.0', payload: {}, state: {} },
  };
}

describe('resolvedPlacement', () => {
  it('reads the placement off the resolved registry entry', () => {
    const registry = createWidgetRegistry([entry('modal', { slot: 'overlay', scope: 'page' })]);

    expect(resolvedPlacement(registry, message('a', 'modal'))).toEqual({
      slot: 'overlay',
      scope: 'page',
    });
  });

  it('is undefined when nothing resolves', () => {
    expect(resolvedPlacement(emptyRegistry, message('a', 'modal'))).toBeUndefined();
  });

  it('places a plain-text message through the synthesised text envelope', () => {
    const registry = createWidgetRegistry([entry('text', { slot: 'message' })]);

    expect(resolvedPlacement(registry, message('a', undefined))).toEqual({ slot: 'message' });
  });
});

describe('belongsInTranscript', () => {
  it('keeps an unplaced message, so its fallback text survives a registry miss', () => {
    expect(belongsInTranscript(undefined)).toBe(true);
  });

  it.each([
    [{ slot: 'message' } as const, true],
    [{ slot: 'input', position: 'above' } as const, false],
    [{ slot: 'overlay', scope: 'chat' } as const, false],
  ])('%o → %s', (placement, expected) => {
    expect(belongsInTranscript(placement)).toBe(expected);
  });
});

describe('inputPositionOf', () => {
  it('defaults a position-less input entry to above', () => {
    expect(inputPositionOf({ slot: 'input' })).toBe(DEFAULT_INPUT_POSITION);
    expect(DEFAULT_INPUT_POSITION).toBe('above');
  });

  it.each(['above', 'below', 'replace'] as const)('reads an explicit %s', (position) => {
    expect(inputPositionOf({ slot: 'input', position })).toBe(position);
  });

  it.each([undefined, { slot: 'message' } as const, { slot: 'overlay', scope: 'chat' } as const])(
    'is undefined for %o',
    (placement) => {
      expect(inputPositionOf(placement)).toBeUndefined();
    },
  );
});

describe('isDismissible', () => {
  it('defaults to true', () => {
    expect(isDismissible({ slot: 'overlay', scope: 'chat' })).toBe(true);
  });

  it('is true when declared true', () => {
    expect(isDismissible({ slot: 'overlay', scope: 'page', dismissible: true })).toBe(true);
  });

  it('is false only when declared false', () => {
    expect(isDismissible({ slot: 'overlay', scope: 'page', dismissible: false })).toBe(false);
  });
});

describe('slot container attributes', () => {
  it('names the input slot and its position', () => {
    expect(inputSlotAttributes('replace')).toEqual({
      'data-nerey-slot': 'input',
      'data-nerey-position': 'replace',
    });
  });

  it('names the overlay slot and its scope', () => {
    expect(overlaySlotAttributes('page')).toEqual({
      'data-nerey-slot': 'overlay',
      'data-nerey-scope': 'page',
    });
  });
});
