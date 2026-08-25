import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { AnyWidgetRegistryEntry, Placement, WidgetRegistry } from './types';

/**
 * ADR 0040 — the registry describing itself to the producer that will fill it.
 *
 * FR-11 gives a widget's schema a dual role: prompt-side constraint for the model, runtime
 * validation at the boundary. Only the second half existed. Without this, a consumer writes the
 * constraint a second time by hand, and two lists have to agree forever with nothing checking
 * that they do — which fails as FR-10 describes: a payload carrying `"1.0"` against an entry
 * registered as `"1.0.0"` silently never matches and renders as text, indistinguishable from a
 * model that simply chose not to use a widget.
 *
 * What comes out is DATA, not a call. Core emits no provider tool format — an LLM SDK binding is
 * a non-goal by name (ADR 0037) and those formats churn faster than this library should — so the
 * consumer shapes a descriptor into whatever their provider wants.
 */
export type WidgetDescriptor = {
  /** The exact string a payload's `type` must carry. */
  type: string;
  /** The exact string a payload's `version` must carry. Never a range (ADR 0009). */
  version: string;
  /**
   * `type@version` — the registry's own lookup key, emitted so a producer building a prompt
   * cannot assemble it wrongly. This field is the whole point of the record: nobody should be
   * typing `1.0.0` when the registry says `1.0`.
   */
  key: string;
  /** What the widget is FOR. Absent when the entry did not declare one. */
  description?: string;
  /** Where it renders. A model choosing between an inline question and an overlay needs this. */
  placement: Placement;
  /**
   * Present only when the entry has a `payloadSchema` AND a converter was supplied. Absent
   * rather than `undefined`, because an undefined value serialises into a prompt as noise.
   */
  payloadSchema?: unknown;
};

export type DescribeRegistryOptions = {
  /**
   * Converts one Standard Schema into JSON Schema. Injected rather than imported: core depends on
   * the Standard Schema *spec*, which has no conversion in it, and taking a converter as a
   * dependency would reintroduce exactly the validator ADR 0011 removed — `check:core-purity`
   * fails the build on it by name.
   *
   * It is a one-line lambda in every vendor a consumer might be on:
   *
   *     describeRegistry(registry, { toJsonSchema: (schema) => z.toJSONSchema(schema) })
   *
   * A converter that throws is left to propagate. A schema it cannot express is a wiring problem
   * in the entry, and swallowing it would hand the model a widget with no constraints at all —
   * the failure this function exists to prevent, arrived at from the other side.
   */
  toJsonSchema?: (schema: StandardSchemaV1<unknown, unknown>) => unknown;
};

function describeEntry(entry: AnyWidgetRegistryEntry, options: DescribeRegistryOptions): WidgetDescriptor {
  const descriptor: WidgetDescriptor = {
    type: entry.type,
    version: entry.version,
    key: `${entry.type}@${entry.version}`,
    placement: entry.placement,
  };

  // Assigned conditionally rather than always: `exactOptionalPropertyTypes` is off in this
  // repository, so `description: undefined` would type-check and then reach a prompt as a null
  // field somebody has to explain to a model.
  if (entry.description !== undefined) descriptor.description = entry.description;
  if (entry.payloadSchema && options.toJsonSchema) {
    descriptor.payloadSchema = options.toJsonSchema(entry.payloadSchema);
  }

  return descriptor;
}

/**
 * Describes every entry a registry will resolve, in registration order.
 *
 * Deliberately absent from the output, because both would mislead the reader they are aimed at:
 *
 *   `stateSchema`  state is what the USER did to the widget, never what the model produces
 *                  (ADR 0014 / 0016). Emitting it invites a model to pre-fill the answer to its
 *                  own question.
 *   `lifecycle`    it governs what happens after the model's turn is over — expiry, read-only,
 *                  snapshotting (ADR 0018). A model reasoning about it is reasoning about
 *                  something it cannot influence.
 */
export function describeRegistry(
  registry: WidgetRegistry,
  options: DescribeRegistryOptions = {},
): readonly WidgetDescriptor[] {
  return registry.entries().map((entry) => describeEntry(entry, options));
}
