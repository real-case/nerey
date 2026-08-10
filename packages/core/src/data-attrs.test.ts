import { describe, expect, it } from 'vitest';

import {
  NEREY_ATTR,
  NEREY_STATES,
  fallbackAttributes,
  partAttributes,
  widgetRootAttributes,
} from './data-attrs';

/** Puts an attribute bag on a real element, so selectors can be asserted rather than reasoned about. */
function elementWith(attrs: Readonly<Record<string, string | undefined>>): HTMLElement {
  const element = document.createElement('div');
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined) element.setAttribute(name, value);
  }
  return element;
}

const ROOT = { type: 'x', version: '1.0.0', slot: 'message', status: 'ready' } as const;

describe('widgetRootAttributes', () => {
  it('emits exactly the four always-present attributes', () => {
    const attrs = widgetRootAttributes({
      type: 'confirmation',
      version: '1.0.0',
      slot: 'message',
      status: 'ready',
    });

    expect(attrs).toEqual({
      'data-nerey-widget': 'confirmation',
      'data-nerey-version': '1.0.0',
      'data-nerey-slot': 'message',
      'data-nerey-status': 'ready',
    });
    expect(Object.keys(attrs)).toEqual([
      'data-nerey-widget',
      'data-nerey-version',
      'data-nerey-slot',
      'data-nerey-status',
    ]);
  });

  it.each(['message', 'input', 'overlay'] as const)('carries the %s slot verbatim', (slot) => {
    expect(widgetRootAttributes({ ...ROOT, slot })['data-nerey-slot']).toBe(slot);
  });

  it.each(['streaming', 'ready', 'error'] as const)('carries the %s status verbatim', (status) => {
    expect(widgetRootAttributes({ ...ROOT, status })['data-nerey-status']).toBe(status);
  });

  it('adds data-state only when a state is given', () => {
    const withState = widgetRootAttributes({ ...ROOT, state: 'submitting' });
    const without = widgetRootAttributes({ ...ROOT });

    expect(withState['data-state']).toBe('submitting');
    expect(Object.hasOwn(without, 'data-state')).toBe(false);
  });

  it.each(NEREY_STATES)('emits the %s state', (state) => {
    expect(widgetRootAttributes({ ...ROOT, state })['data-state']).toBe(state);
  });

  describe('data-readonly is valueless and conditional', () => {
    it('is an empty string when readonly is true', () => {
      expect(widgetRootAttributes({ ...ROOT, readonly: true })['data-readonly']).toBe('');
    });

    it.each<[string, boolean | undefined]>([
      ['false', false],
      ['omitted', undefined],
    ])('is absent when readonly is %s', (_label, readonly) => {
      expect(Object.hasOwn(widgetRootAttributes({ ...ROOT, readonly }), 'data-readonly')).toBe(false);
    });

    it('makes [data-readonly] the selector, not [data-readonly="true"]', () => {
      // The whole point of the valueless form: a consumer writes `[data-readonly] { … }` in
      // their own CSS Module. Emitting `"true"` would silently break every one of those rules,
      // so the selector — not the object shape — is what gets asserted here.
      const element = elementWith(widgetRootAttributes({ ...ROOT, readonly: true }));

      expect(element.matches('[data-readonly]')).toBe(true);
      expect(element.getAttribute('data-readonly')).toBe('');
      expect(element.matches('[data-readonly="true"]')).toBe(false);
    });

    it('leaves the attribute off the element entirely when not readonly', () => {
      const element = elementWith(widgetRootAttributes({ ...ROOT, readonly: false }));

      expect(element.matches('[data-readonly]')).toBe(false);
      expect(element.hasAttribute('data-readonly')).toBe(false);
    });
  });

  it('is a fresh object per call, so spreading one root cannot mutate another', () => {
    expect(widgetRootAttributes({ ...ROOT })).not.toBe(widgetRootAttributes({ ...ROOT }));
  });

  it('renders every attribute onto an element under its documented name', () => {
    const element = elementWith(
      widgetRootAttributes({
        type: 'confirmation',
        version: '2.1.0',
        slot: 'overlay',
        status: 'streaming',
        state: 'locked',
        readonly: true,
      }),
    );

    expect(element.matches('[data-nerey-widget="confirmation"]')).toBe(true);
    expect(element.matches('[data-nerey-version="2.1.0"]')).toBe(true);
    expect(element.matches('[data-nerey-slot="overlay"]')).toBe(true);
    expect(element.matches('[data-nerey-status="streaming"]')).toBe(true);
    expect(element.matches('[data-state="locked"]')).toBe(true);
    expect(element.matches('[data-readonly]')).toBe(true);
  });
});

describe('partAttributes', () => {
  it('names the part and nothing else when no state is given', () => {
    expect(partAttributes('actions')).toEqual({ 'data-nerey-part': 'actions' });
  });

  it('adds the part-local state when one is given', () => {
    expect(partAttributes('actions', 'selected')).toEqual({
      'data-nerey-part': 'actions',
      'data-state': 'selected',
    });
  });

  it('uses the same unprefixed data-state name as the widget root', () => {
    // One selector idiom across the whole UI (Base UI, Radix and React Aria all use
    // `data-state`) is why the name is unprefixed — a part with its own state must not invent
    // a second vocabulary.
    expect(Object.keys(partAttributes('actions', 'error'))).toEqual([NEREY_ATTR.part, NEREY_ATTR.state]);
  });

  it('passes an unusual part name through untouched', () => {
    expect(partAttributes('trailing-icon')['data-nerey-part']).toBe('trailing-icon');
  });

  it('is selectable as [data-nerey-part="…"]', () => {
    const element = elementWith(partAttributes('actions', 'submitting'));

    expect(element.matches('[data-nerey-part="actions"][data-state="submitting"]')).toBe(true);
  });
});

describe('fallbackAttributes', () => {
  it.each(['unknown-widget', 'invalid-payload', 'render-error', 'expired', 'no-widget'] as const)(
    'marks a fallback rendered because of %s',
    (reason) => {
      expect(fallbackAttributes(reason)).toEqual({ 'data-nerey-fallback': reason });
    },
  );

  it('emits only the fallback attribute — a fallback is not a widget root', () => {
    expect(Object.keys(fallbackAttributes('expired'))).toEqual([NEREY_ATTR.fallback]);
  });
});

describe('the attribute contract (ADR 0020 / 0029)', () => {
  /**
   * These two snapshots are the public styling API in literal form. A rename here breaks every
   * consumer stylesheet in the wild and is a MAJOR bump; the snapshot exists so that the rename
   * shows up as a reviewed diff rather than as a green test run.
   */
  it('pins the attribute names', () => {
    expect(NEREY_ATTR).toMatchInlineSnapshot(`
      {
        "fallback": "data-nerey-fallback",
        "part": "data-nerey-part",
        "readonly": "data-readonly",
        "slot": "data-nerey-slot",
        "state": "data-state",
        "status": "data-nerey-status",
        "theme": "data-nerey-theme",
        "version": "data-nerey-version",
        "widget": "data-nerey-widget",
      }
    `);
  });

  it('pins the data-state vocabulary', () => {
    expect(NEREY_STATES).toMatchInlineSnapshot(`
      [
        "idle",
        "selected",
        "submitting",
        "locked",
        "expired",
        "error",
      ]
    `);
  });

  it('keeps every Nerey-owned attribute under one prefix, with two deliberate exceptions', () => {
    const names = Object.values(NEREY_ATTR);
    const unprefixed = names.filter((name) => !name.startsWith('data-nerey-'));

    expect(unprefixed).toEqual(['data-state', 'data-readonly']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists each state exactly once', () => {
    expect(new Set(NEREY_STATES).size).toBe(NEREY_STATES.length);
  });
});
