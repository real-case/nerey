import { builtInWidgets, composeRegistries, describeRegistry } from '@nerey/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { themeWidgets } from './catalog';

/**
 * ADR 0040 — what a producer is told about this catalog has to match what the registry will
 * actually resolve. The theme is where that matters most: it is the catalog a consumer adopts
 * wholesale, and two of its entries deliberately occupy the same `type@version` as core's
 * built-ins (ADR 0035), so the composed registry — not either catalog alone — is what a model
 * should be described.
 */
const composed = composeRegistries({ override: true }, builtInWidgets, themeWidgets);

describe('themeWidgets, as described to a producer', () => {
  it('describes every entry with a key the registry resolves', () => {
    const descriptors = describeRegistry(composed);

    expect(descriptors.length).toBe(composed.entries().length);
    for (const descriptor of descriptors) {
      expect(descriptor.key).toBe(`${descriptor.type}@${descriptor.version}`);
      expect(composed.get(descriptor.type, descriptor.version)).toBeDefined();
    }
  });

  /**
   * The one thing no gate can check is whether a description is *right*, so this checks the only
   * thing it can: that a widget added to the catalog was not left mute. A catalogue entry with no
   * description tells a model what a widget is called and not what it is for, which is the one
   * thing it needs in order to choose between two of them.
   */
  it('leaves no entry without a description', () => {
    const mute = describeRegistry(composed)
      .filter((descriptor) => (descriptor.description ?? '').trim() === '')
      .map((descriptor) => descriptor.key);

    expect(mute).toEqual([]);
  });

  /**
   * `text` and `confirmation` exist in both catalogs at identical coordinates. The composed
   * registry keeps ONE of each — the theme's, because it is composed last with `override` — and
   * the description a producer sees must come from the entry that will actually render.
   */
  it('describes an overridden key exactly once', () => {
    const keys = describeRegistry(composed).map((descriptor) => descriptor.key);

    expect(keys.filter((key) => key.startsWith('text@'))).toHaveLength(1);
    expect(keys.filter((key) => key.startsWith('confirmation@'))).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * The end-to-end shape of ADR 0040: a real vendor converter, a real catalog, and JSON Schema
   * coming out for every entry that declares a payload schema. If this passes, the one-line lambda
   * the record promises is genuinely all a consumer writes.
   */
  it('converts every payload schema through an injected converter', () => {
    const descriptors = describeRegistry(composed, {
      toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
    });

    const withSchema = descriptors.filter((descriptor) => descriptor.payloadSchema !== undefined);
    expect(withSchema.length).toBe(descriptors.length);
    for (const descriptor of withSchema) {
      expect(descriptor.payloadSchema).toMatchObject({ type: 'object' });
    }
  });
});
