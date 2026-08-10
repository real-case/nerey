import type { StandardSchemaV1 } from '@standard-schema/spec';
/**
 * The whole payload of the built-in `text` widget. Nothing richer is possible here: the widget
 * hands `content` to the renderer the host injected (ADR 0012), so any structure beyond a string
 * would be a presentation decision made by a package that ships no presentation (ADR 0037).
 */
export type TextPayload = {
  content: string;
};
/**
 * A Standard Schema v1 written by hand.
 *
 * Core depends on the *spec* and never on a validator (ADR 0011), which leaves it unable to reach
 * for Zod even for its own built-ins. Implementing the interface directly costs about a dozen
 * lines, so this doubles as the worked example for a consumer in the same position: no validator
 * in the bundle, still a schema the registry and `validateSync` accept unchanged.
 *
 * What a schema has to expose, all of it under the single `~standard` key:
 *
 *   `version`   always `1`. It identifies the revision of the *spec*, not of this schema — the
 *               widget's own version lives on the registry entry (ADR 0009).
 *   `vendor`    who implemented it. Nerey quotes it verbatim in the async-schema diagnostic, so
 *               it should name something a reader can go and look at.
 *   `validate`  `(value: unknown) => { value: Output } | { issues: [...] }`. Success and failure
 *               are distinguished by the presence of `issues`, not by throwing. Returning a
 *               Promise is legal per the spec but not here: Nerey validates during React's render
 *               phase and cannot await, and `validateSync` throws a TypeError saying so.
 *   `types`     a type-only carrier that is never read at runtime. Omitted deliberately — the
 *               `StandardSchemaV1<unknown, TextPayload>` annotation on the const already gives
 *               `InferOutput` everything it needs, and a runtime `types: undefined` would only
 *               suggest the field does something.
 */
export declare const textPayloadSchema: StandardSchemaV1<unknown, TextPayload>;
//# sourceMappingURL=schema.d.ts.map
