import { describe, expect, it, vi } from 'vitest';

import type {
  AnyWidgetRegistryEntry,
  Lifecycle,
  WidgetComponent,
  WidgetRegistry,
  WidgetRegistryEntry,
} from './types';

import {
  asAnyWidget,
  composeRegistries,
  createWidgetRegistry,
  defineWidget,
  emptyRegistry,
} from './registry';

const LIFECYCLE: Lifecycle = { persist: 'forever', expiry: [], afterExpiry: 'snapshot' };

const Stub: WidgetComponent = () => null;

/**
 * Entries are compared by identity throughout this file, never by shape: every assertion about
 * override and ordering is about *which object* came back, and two structurally equal stubs
 * would let a wrong-entry bug pass a `toEqual`.
 */
function makeEntry(
  type: string,
  version: string,
  extra: Partial<AnyWidgetRegistryEntry> = {},
): AnyWidgetRegistryEntry {
  return {
    type,
    version,
    component: Stub,
    placement: { slot: 'message' },
    lifecycle: LIFECYCLE,
    ...extra,
  };
}

describe('createWidgetRegistry — exact resolution (ADR 0009)', () => {
  it('resolves an entry on an exact type@version match', () => {
    const chart = makeEntry('chart', '1.0.0');
    const registry = createWidgetRegistry([chart]);

    expect(registry.get('chart', '1.0.0')).toBe(chart);
    expect(registry.has('chart', '1.0.0')).toBe(true);
  });

  it.each([
    ['a different version', 'chart', '1.0.1'],
    ['a version that only differs in precision', 'chart', '1.0'],
    ['a different type', 'graph', '1.0.0'],
    ['an empty version', 'chart', ''],
  ])('returns undefined for %s', (_label, type, version) => {
    const registry = createWidgetRegistry([makeEntry('chart', '1.0.0')]);

    expect(registry.get(type, version)).toBeUndefined();
    expect(registry.has(type, version)).toBe(false);
  });

  it('keeps two versions of one type side by side', () => {
    const v1 = makeEntry('chart', '1.0.0');
    const v2 = makeEntry('chart', '2.0.0');
    const registry = createWidgetRegistry([v1, v2]);

    expect(registry.get('chart', '1.0.0')).toBe(v1);
    expect(registry.get('chart', '2.0.0')).toBe(v2);
  });
});

describe('createWidgetRegistry — duplicates', () => {
  it('throws while constructing, not on the first lookup', () => {
    const first = makeEntry('chart', '1.0.0');
    const second = makeEntry('chart', '1.0.0');
    let registry: WidgetRegistry | undefined;

    expect(() => {
      registry = createWidgetRegistry([first, second]);
    }).toThrow(/Duplicate widget registration: chart@1\.0\.0/);

    // No registry object was ever produced, so the throw cannot have come from a lookup —
    // a duplicate is a wiring mistake and must surface at startup, not on the unlucky render.
    expect(registry).toBeUndefined();
  });

  it('names the escape hatch in the message', () => {
    const entries = [makeEntry('chart', '1.0.0'), makeEntry('chart', '1.0.0')];

    expect(() => createWidgetRegistry(entries)).toThrow(/\{ override: true \}/);
  });

  it('does not treat the same type at different versions as a duplicate', () => {
    expect(() =>
      createWidgetRegistry([makeEntry('chart', '1.0.0'), makeEntry('chart', '1.0.1')]),
    ).not.toThrow();
  });

  it('replaces the earlier entry when override is set', () => {
    const first = makeEntry('chart', '1.0.0');
    const second = makeEntry('chart', '1.0.0');
    const registry = createWidgetRegistry([first, second], { override: true });

    expect(registry.get('chart', '1.0.0')).toBe(second);
  });
});

describe('createWidgetRegistry — entries()', () => {
  it('preserves registration order', () => {
    const a = makeEntry('a', '1.0.0');
    const b = makeEntry('b', '1.0.0');
    const c = makeEntry('c', '1.0.0');
    const registry = createWidgetRegistry([a, b, c]);

    expect([...registry.entries()]).toEqual([a, b, c]);
    expect(registry.entries()[0]).toBe(a);
    expect(registry.entries()[2]).toBe(c);
  });

  it('is empty for an empty registration list', () => {
    expect(createWidgetRegistry([]).entries()).toEqual([]);
  });

  it('reflects an override in place rather than appending it', () => {
    const a = makeEntry('a', '1.0.0');
    const b = makeEntry('b', '1.0.0');
    const aReplacement = makeEntry('a', '1.0.0');
    const registry = createWidgetRegistry([a, b, aReplacement], { override: true });

    // The overriding entry inherits the overridden one's slot: appending it would reorder the
    // catalog every time a consumer replaced a built-in, which devtools and the conformance
    // kit both read positionally.
    const listed = registry.entries();
    expect(listed).toHaveLength(2);
    expect(listed[0]).toBe(aReplacement);
    expect(listed[1]).toBe(b);
  });
});

describe('createWidgetRegistry — malformed entries', () => {
  it.each([
    ['an empty type', makeEntry('', '1.0.0'), /missing a `type`/],
    ['an empty version', makeEntry('chart', ''), /Widget `chart` is missing a `version`/],
  ])('throws for %s', (_label, entry, pattern) => {
    expect(() => createWidgetRegistry([entry])).toThrow(pattern);
  });

  it('throws for a missing version even with override set', () => {
    // `override` licenses replacement, not an unaddressable entry.
    expect(() => createWidgetRegistry([makeEntry('chart', '')], { override: true })).toThrow(
      /missing a `version`/,
    );
  });
});

describe('createWidgetRegistry — acceptsVersion (opt-in ranged resolution)', () => {
  it('is not consulted when the exact key hits', () => {
    const acceptsVersion = vi.fn(() => true);
    const chart = makeEntry('chart', '1.0.0', { acceptsVersion });
    const registry = createWidgetRegistry([chart]);

    expect(registry.get('chart', '1.0.0')).toBe(chart);
    expect(acceptsVersion).not.toHaveBeenCalled();
  });

  it('is consulted only after an exact miss', () => {
    const acceptsVersion = vi.fn((requested: string) => requested.startsWith('1.'));
    const chart = makeEntry('chart', '1.0.0', { acceptsVersion });
    const registry = createWidgetRegistry([chart]);

    expect(registry.get('chart', '1.4.0')).toBe(chart);
    expect(acceptsVersion).toHaveBeenCalledWith('1.4.0');
    expect(registry.get('chart', '2.0.0')).toBeUndefined();
  });

  it('loses to an exact entry at the requested version', () => {
    const ranged = makeEntry('chart', '1.0.0', { acceptsVersion: () => true });
    const exact = makeEntry('chart', '2.0.0');
    const registry = createWidgetRegistry([ranged, exact]);

    expect(registry.get('chart', '2.0.0')).toBe(exact);
  });

  it('never answers for another type, however permissive the predicate', () => {
    const ranged = makeEntry('chart', '1.0.0', { acceptsVersion: () => true });
    const registry = createWidgetRegistry([ranged]);

    expect(registry.get('graph', '1.0.0')).toBeUndefined();
  });

  it('ignores a predicate that returns a truthy non-true value', () => {
    // The lookup compares `=== true`, so a predicate written to return a string or a number
    // fails closed rather than resolving a version nobody vetted.
    const sloppy = makeEntry('chart', '1.0.0', {
      acceptsVersion: () => 'yes' as unknown as boolean,
    });
    const registry = createWidgetRegistry([sloppy]);

    expect(registry.get('chart', '9.9.9')).toBeUndefined();
  });

  it('is off by default — an entry without the predicate stays exact', () => {
    const registry = createWidgetRegistry([makeEntry('chart', '1.0.0')]);

    expect(registry.get('chart', '1.0.1')).toBeUndefined();
  });

  it('reports a ranged hit through has() too', () => {
    const registry = createWidgetRegistry([makeEntry('chart', '1.0.0', { acceptsVersion: () => true })]);

    expect(registry.has('chart', '3.1.4')).toBe(true);
  });
});

describe('composeRegistries', () => {
  it('mixes array and registry sources', () => {
    const builtIn = createWidgetRegistry([makeEntry('text', '1.0.0')]);
    const custom = makeEntry('chart', '1.0.0');
    const composed = composeRegistries(builtIn, [custom]);

    expect(composed.get('text', '1.0.0')).toBe(builtIn.get('text', '1.0.0'));
    expect(composed.get('chart', '1.0.0')).toBe(custom);
  });

  it('flattens sources left to right', () => {
    const a = makeEntry('a', '1.0.0');
    const b = makeEntry('b', '1.0.0');
    const c = makeEntry('c', '1.0.0');
    const composed = composeRegistries([a], createWidgetRegistry([b, c]));

    expect([...composed.entries()]).toEqual([a, b, c]);
  });

  it('throws on a collision between two sources', () => {
    const builtIn = createWidgetRegistry([makeEntry('chart', '1.0.0')]);

    expect(() => composeRegistries(builtIn, [makeEntry('chart', '1.0.0')])).toThrow(
      /Duplicate widget registration: chart@1\.0\.0/,
    );
  });

  it('lets a later source win the key when override is set, keeping the earlier position', () => {
    const builtInChart = makeEntry('chart', '1.0.0');
    const builtInText = makeEntry('text', '1.0.0');
    const consumerChart = makeEntry('chart', '1.0.0');
    const composed = composeRegistries({ override: true }, [builtInChart, builtInText], [consumerChart]);

    expect(composed.get('chart', '1.0.0')).toBe(consumerChart);
    expect([...composed.entries()]).toEqual([consumerChart, builtInText]);
  });

  it('distinguishes the options object from a registry argument', () => {
    // A registry is recognised by its `entries` member; anything else in first position is
    // options. Get this wrong and `composeRegistries(builtIns, mine)` silently drops the
    // built-ins — the exact failure this overload has to be pinned against.
    const first = createWidgetRegistry([makeEntry('a', '1.0.0')]);
    const second = createWidgetRegistry([makeEntry('b', '1.0.0')]);
    const composed = composeRegistries(first, second);

    expect(composed.entries().map((entry) => entry.type)).toEqual(['a', 'b']);
    expect(composed.has('a', '1.0.0')).toBe(true);
  });

  it('does not swallow a leading registry as options — a collision after it still throws', () => {
    const first = createWidgetRegistry([makeEntry('a', '1.0.0')]);

    expect(() => composeRegistries(first, [makeEntry('a', '1.0.0')])).toThrow(/Duplicate/);
  });

  it('applies the options object to every source, not just the first', () => {
    const one = makeEntry('a', '1.0.0');
    const two = makeEntry('a', '1.0.0');
    const three = makeEntry('a', '1.0.0');

    expect(composeRegistries({ override: true }, [one], [two], [three]).get('a', '1.0.0')).toBe(three);
  });

  it('composes an empty registry from no sources at all', () => {
    expect(composeRegistries().entries()).toEqual([]);
    expect(composeRegistries({ override: true }).entries()).toEqual([]);
  });

  it('carries acceptsVersion across composition', () => {
    const ranged = makeEntry('chart', '1.0.0', { acceptsVersion: (v) => v.startsWith('1.') });
    const composed = composeRegistries([ranged]);

    expect(composed.get('chart', '1.9.0')).toBe(ranged);
  });
});

describe('emptyRegistry', () => {
  it('resolves nothing and lists nothing', () => {
    expect(emptyRegistry.get('text', '1.0.0')).toBeUndefined();
    expect(emptyRegistry.has('text', '1.0.0')).toBe(false);
    expect(emptyRegistry.entries()).toEqual([]);
  });
});

/* ── defineWidget / asAnyWidget ─────────────────────────────────────────────────────── */

type CounterPayload = { count: number };
type CounterState = { bumped: boolean };
type CounterEvent = { kind: 'bump' };

const CounterComponent: WidgetComponent<CounterPayload, CounterState> = () => null;
const MismatchedComponent: WidgetComponent<{ label: string }, CounterState> = () => null;

function counterEntry(
  component: WidgetComponent<CounterPayload, CounterState>,
): WidgetRegistryEntry<CounterPayload, CounterState, CounterEvent> {
  return defineWidget<CounterPayload, CounterState, CounterEvent>({
    type: 'counter',
    version: '1.0.0',
    component,
    placement: { slot: 'message' },
    lifecycle: LIFECYCLE,
    // Inference on both reducer parameters is the point of the helper: written as a bare
    // object literal these widen and the widget author loses the event type.
    reducer: (previous, event) => (event.kind === 'bump' ? { bumped: true } : previous),
  });
}

describe('defineWidget', () => {
  it('returns the entry it was given, unchanged and by identity', () => {
    const entry: WidgetRegistryEntry<CounterPayload, CounterState, CounterEvent> = {
      type: 'counter',
      version: '1.0.0',
      component: CounterComponent,
      placement: { slot: 'message' },
      lifecycle: LIFECYCLE,
    };

    expect(defineWidget(entry)).toBe(entry);
  });

  it('preserves the generics through the reducer', () => {
    const entry = counterEntry(CounterComponent);

    expect(entry.reducer?.({ bumped: false }, { kind: 'bump' })).toEqual({ bumped: true });
  });

  it('rejects a component whose payload prop contradicts the declared generic', () => {
    const entry = defineWidget<CounterPayload, CounterState, CounterEvent>({
      type: 'counter',
      version: '1.0.0',
      // @ts-expect-error — a component typed for a different payload must not satisfy the
      // entry's `Payload` generic. This directive failing to error is itself the regression:
      // it would mean `defineWidget` had widened its props and stopped checking anything.
      component: MismatchedComponent,
      placement: { slot: 'message' },
      lifecycle: LIFECYCLE,
    });

    // `defineWidget` is identity at runtime; the assertion above is a compile-time one, and
    // `npm run typecheck` is where it fires.
    expect(entry.type).toBe('counter');
  });
});

describe('asAnyWidget', () => {
  it('erases the generics without touching the value', () => {
    const entry = counterEntry(CounterComponent);
    const erased = asAnyWidget(entry);

    expect(erased).toBe(entry);
    expect(createWidgetRegistry([erased]).get('counter', '1.0.0')).toBe(erased);
  });
});
