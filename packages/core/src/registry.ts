import type { AnyWidgetRegistryEntry, WidgetRegistry, WidgetRegistryEntry } from './types';

/**
 * ADR 0010 — a registry is built by explicit composition. There is no module-level mutable
 * map and no `registerWidget()` side effect at import time, because a registry assembled by
 * import order is a registry whose contents depend on bundler decisions: tree-shaking a
 * "unused" widget module silently unregisters it, and test isolation requires a reset hook
 * that production never wants.
 *
 * ADR 0009 — lookup is an exact match on `type@version`. An entry may opt into ranged
 * resolution with `acceptsVersion`, but never by default: an implicit range turns a version
 * mismatch into a silent fallback that looks exactly like a missing widget.
 */

function keyOf(type: string, version: string): string {
  return `${type}@${version}`;
}

export type CreateRegistryOptions = {
  /**
   * Allow a later entry to replace an earlier one with the same `type@version`. Off by
   * default: a duplicate is nearly always two people registering the same widget, and
   * last-write-wins makes which one you get depend on array order.
   */
  override?: boolean;
};

export function createWidgetRegistry(
  entries: readonly AnyWidgetRegistryEntry[],
  options: CreateRegistryOptions = {},
): WidgetRegistry {
  const exact = new Map<string, AnyWidgetRegistryEntry>();
  const ordered: AnyWidgetRegistryEntry[] = [];
  /** Entries that opted into ranged resolution, checked only after an exact miss. */
  const ranged: AnyWidgetRegistryEntry[] = [];

  for (const entry of entries) {
    if (!entry.type) {
      throw new Error('Widget registration is missing a `type`.');
    }
    if (!entry.version) {
      throw new Error(`Widget \`${entry.type}\` is missing a \`version\`.`);
    }

    const key = keyOf(entry.type, entry.version);
    if (exact.has(key) && !options.override) {
      throw new Error(
        `Duplicate widget registration: ${key}. Pass \`{ override: true }\` to createWidgetRegistry ` +
          `or composeRegistries if replacing an entry is intended.`,
      );
    }
    const replaced = exact.get(key);
    if (!replaced) ordered.push(entry);
    else ordered.splice(ordered.indexOf(replaced), 1, entry);

    // The replaced entry has to leave `ranged` too. Leaving it there produced a genuinely
    // confusing split brain: `get('chart', '1.0.0')` returned the replacement while
    // `get('chart', '9.9.9')` still resolved through the OLD entry's `acceptsVersion` — an
    // override that only half took effect, and only on the path nobody tests first.
    if (replaced) {
      const stale = ranged.indexOf(replaced);
      if (stale !== -1) ranged.splice(stale, 1);
    }

    exact.set(key, entry);
    if (entry.acceptsVersion && !ranged.includes(entry)) ranged.push(entry);
  }

  function get(type: string, version: string): AnyWidgetRegistryEntry | undefined {
    const hit = exact.get(keyOf(type, version));
    if (hit) return hit;
    // Ranged fallback is opt-in per entry. Scanning is fine: registries hold tens of
    // entries, and this path only runs on an exact miss.
    return ranged.find((entry) => entry.type === type && entry.acceptsVersion?.(version) === true);
  }

  return {
    get,
    has: (type, version) => get(type, version) !== undefined,
    entries: () => ordered,
  };
}

/**
 * Merges registries left to right. Nerey's built-ins go first, a consumer's catalog after;
 * a key collision throws unless `override` is set, so extending the built-ins is a
 * deliberate act rather than an accident of ordering.
 */
export function composeRegistries(
  ...registries: readonly (WidgetRegistry | readonly AnyWidgetRegistryEntry[])[]
): WidgetRegistry;
export function composeRegistries(
  options: CreateRegistryOptions,
  ...registries: readonly (WidgetRegistry | readonly AnyWidgetRegistryEntry[])[]
): WidgetRegistry;
export function composeRegistries(...args: readonly unknown[]): WidgetRegistry {
  let options: CreateRegistryOptions = {};
  let rest = args;

  const first = args[0];
  if (first && typeof first === 'object' && !Array.isArray(first) && !('entries' in first)) {
    options = first;
    rest = args.slice(1);
  }

  const flattened = rest.flatMap((source) => {
    if (Array.isArray(source)) return source as AnyWidgetRegistryEntry[];
    return [...(source as WidgetRegistry).entries()];
  });

  return createWidgetRegistry(flattened, options);
}

/** The host's default when no provider is mounted, so a widget stays unit-testable alone. */
export const emptyRegistry: WidgetRegistry = {
  get: () => undefined,
  has: () => false,
  entries: () => [],
};

/**
 * The authoring entry point. It exists purely to preserve the `<Payload, State, Event>`
 * generics end to end: written as a bare object literal, TypeScript widens the component's
 * props and a widget author loses inference on `payload`, `state` and the reducer's event.
 */
export function defineWidget<Payload = unknown, State = unknown, Event = unknown>(
  entry: WidgetRegistryEntry<Payload, State, Event>,
): WidgetRegistryEntry<Payload, State, Event> {
  return entry;
}

/**
 * Erases an entry's generics for storage in a heterogeneous collection. Registries hold
 * entries with mutually incompatible `Payload`/`State` types, which no single generic
 * parameter can express; the types are reasserted at the consumer end by the widget's own
 * typed component.
 */
export function asAnyWidget<Payload, State, Event>(
  entry: WidgetRegistryEntry<Payload, State, Event>,
): AnyWidgetRegistryEntry {
  // No cast: `AnyWidgetRegistryEntry` already erases the generics (see its definition in
  // types.ts). This function survives as a documented, greppable marker at the point where a
  // typed entry enters a heterogeneous collection — a bare assignment would be silent.
  return entry;
}
