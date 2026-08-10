import type { AnyWidgetRegistryEntry, WidgetRegistry, WidgetRegistryEntry } from './types';
export type CreateRegistryOptions = {
  /**
   * Allow a later entry to replace an earlier one with the same `type@version`. Off by
   * default: a duplicate is nearly always two people registering the same widget, and
   * last-write-wins makes which one you get depend on array order.
   */
  override?: boolean;
};
export declare function createWidgetRegistry(
  entries: readonly AnyWidgetRegistryEntry[],
  options?: CreateRegistryOptions,
): WidgetRegistry;
/**
 * Merges registries left to right. Nerey's built-ins go first, a consumer's catalog after;
 * a key collision throws unless `override` is set, so extending the built-ins is a
 * deliberate act rather than an accident of ordering.
 */
export declare function composeRegistries(
  ...registries: readonly (WidgetRegistry | readonly AnyWidgetRegistryEntry[])[]
): WidgetRegistry;
export declare function composeRegistries(
  options: CreateRegistryOptions,
  ...registries: readonly (WidgetRegistry | readonly AnyWidgetRegistryEntry[])[]
): WidgetRegistry;
/** The host's default when no provider is mounted, so a widget stays unit-testable alone. */
export declare const emptyRegistry: WidgetRegistry;
/**
 * The authoring entry point. It exists purely to preserve the `<Payload, State, Event>`
 * generics end to end: written as a bare object literal, TypeScript widens the component's
 * props and a widget author loses inference on `payload`, `state` and the reducer's event.
 */
export declare function defineWidget<Payload = unknown, State = unknown, Event = unknown>(
  entry: WidgetRegistryEntry<Payload, State, Event>,
): WidgetRegistryEntry<Payload, State, Event>;
/**
 * Erases an entry's generics for storage in a heterogeneous collection. Registries hold
 * entries with mutually incompatible `Payload`/`State` types, which no single generic
 * parameter can express; the types are reasserted at the consumer end by the widget's own
 * typed component.
 */
export declare function asAnyWidget<Payload, State, Event>(
  entry: WidgetRegistryEntry<Payload, State, Event>,
): AnyWidgetRegistryEntry;
//# sourceMappingURL=registry.d.ts.map
