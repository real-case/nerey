import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { describeRegistry } from './describe';
import { asAnyWidget, createWidgetRegistry, defineWidget } from './registry';
import type { AnyWidgetRegistryEntry } from './types';
import { builtInWidgets } from './widgets/catalog';

const Noop = () => null;

function entry(
  type: string,
  version: string,
  extra: Partial<AnyWidgetRegistryEntry> = {},
): AnyWidgetRegistryEntry {
  return asAnyWidget(
    defineWidget({
      type,
      version,
      component: Noop,
      placement: { slot: 'message' },
      lifecycle: { persist: 'ephemeral', expiry: [], afterExpiry: 'snapshot' },
      ...extra,
    }),
  );
}

describe('describeRegistry', () => {
  /**
   * The fitness function of ADR 0040. Everything else here is detail; this is the property the
   * record exists to establish — a catalogue that names a string the registry would not accept is
   * worse than no catalogue, because the failure it produces renders as plain text and looks like
   * a model that chose not to use a widget (FR-10, ADR 0009).
   */
  it('emits only keys the registry itself resolves', () => {
    const registry = createWidgetRegistry([
      entry('poll', '1.0'),
      entry('poll', '1.0.0'),
      entry('confirmation', '2.1.3'),
    ]);

    const descriptors = describeRegistry(registry);
    expect(descriptors).toHaveLength(3);

    for (const descriptor of descriptors) {
      expect(descriptor.key).toBe(`${descriptor.type}@${descriptor.version}`);
      expect(registry.get(descriptor.type, descriptor.version)).toBeDefined();
    }

    // The two `poll` entries differ only in how the version is spelled, which is exactly the
    // confusion FR-10 describes. Both are described, separately, with the spelling that resolves.
    expect(descriptors.map((d) => d.key)).toEqual(['poll@1.0', 'poll@1.0.0', 'confirmation@2.1.3']);
  });

  it('describes every built-in exactly once, in registration order', () => {
    const registry = createWidgetRegistry(builtInWidgets);
    const descriptors = describeRegistry(registry);

    expect(descriptors.map((d) => d.key)).toEqual(
      builtInWidgets.map((widget) => `${widget.type}@${widget.version}`),
    );
    expect(new Set(descriptors.map((d) => d.key)).size).toBe(builtInWidgets.length);
  });

  it('carries the placement through unchanged', () => {
    const registry = createWidgetRegistry([
      entry('notice', '1.0.0', { placement: { slot: 'overlay', scope: 'chat', dismissible: true } }),
    ]);

    expect(describeRegistry(registry)[0]?.placement).toEqual({
      slot: 'overlay',
      scope: 'chat',
      dismissible: true,
    });
  });

  describe('description', () => {
    it('is emitted when the entry declares one', () => {
      const registry = createWidgetRegistry([
        entry('poll', '1.0', { description: 'Ask the user to choose between listed options.' }),
      ]);

      expect(describeRegistry(registry)[0]?.description).toBe(
        'Ask the user to choose between listed options.',
      );
    });

    /**
     * Absent, not `undefined`. The descriptor is destined for a prompt, and `"description": null`
     * is a field somebody has to explain to a model.
     */
    it('is absent — not undefined — when the entry declares none', () => {
      const registry = createWidgetRegistry([entry('poll', '1.0')]);
      const [descriptor] = describeRegistry(registry);

      expect(descriptor).toBeDefined();
      expect('description' in (descriptor ?? {})).toBe(false);
    });
  });

  describe('payloadSchema', () => {
    const schema = z.object({ question: z.string(), options: z.array(z.string()) });

    it('is converted by the injected converter', () => {
      const registry = createWidgetRegistry([entry('poll', '1.0', { payloadSchema: schema })]);
      const descriptors = describeRegistry(registry, {
        toJsonSchema: (candidate) => z.toJSONSchema(candidate as z.ZodType),
      });

      // A real vendor conversion rather than a stub: the point of ADR 0040 is that the one-line
      // lambda a consumer already has is enough, and a stub would not prove that.
      expect(descriptors[0]?.payloadSchema).toMatchObject({
        type: 'object',
        properties: { question: { type: 'string' } },
      });
    });

    it('receives the entry’s own schema object', () => {
      const toJsonSchema = vi.fn(() => ({ converted: true }));
      const registry = createWidgetRegistry([entry('poll', '1.0', { payloadSchema: schema })]);

      describeRegistry(registry, { toJsonSchema });

      expect(toJsonSchema).toHaveBeenCalledTimes(1);
      expect(toJsonSchema).toHaveBeenCalledWith(schema);
    });

    /**
     * The documented degenerate case. A consumer who forgets the converter gets a catalogue with
     * no constraints in it and no error — so the behaviour is pinned here rather than left to be
     * discovered when a model starts inventing payload shapes.
     */
    it('is absent entirely when no converter is supplied', () => {
      const registry = createWidgetRegistry([entry('poll', '1.0', { payloadSchema: schema })]);
      const [descriptor] = describeRegistry(registry);

      expect(descriptor).toBeDefined();
      expect('payloadSchema' in (descriptor ?? {})).toBe(false);
    });

    it('is absent when the entry has no schema, even with a converter', () => {
      const toJsonSchema = vi.fn(() => ({ converted: true }));
      const registry = createWidgetRegistry([entry('poll', '1.0')]);
      const [descriptor] = describeRegistry(registry, { toJsonSchema });

      expect('payloadSchema' in (descriptor ?? {})).toBe(false);
      expect(toJsonSchema).not.toHaveBeenCalled();
    });

    /**
     * A converter that cannot express a schema is a wiring problem in the entry. Swallowing it
     * would hand the model a widget with no constraints at all — the failure this whole module
     * exists to prevent, arrived at from the other side.
     */
    it('lets a failing converter propagate', () => {
      const registry = createWidgetRegistry([entry('poll', '1.0', { payloadSchema: schema })]);

      expect(() =>
        describeRegistry(registry, {
          toJsonSchema: () => {
            throw new TypeError('cannot express a transform');
          },
        }),
      ).toThrow('cannot express a transform');
    });
  });

  /**
   * Both of these are the kind of field somebody adds later out of helpfulness, so both are
   * asserted absent rather than merely left out of the type.
   */
  it('emits neither state nor lifecycle', () => {
    const stateSchema: StandardSchemaV1<unknown, unknown> = {
      '~standard': { version: 1, vendor: 'handmade', validate: (value) => ({ value }) },
    };
    const registry = createWidgetRegistry([
      entry('poll', '1.0', {
        stateSchema,
        lifecycle: { persist: 'forever', expiry: [{ on: 'interact' }], afterExpiry: 'snapshot' },
      }),
    ]);

    const [descriptor] = describeRegistry(registry, { toJsonSchema: () => ({}) });

    expect(descriptor).toBeDefined();
    expect(Object.keys(descriptor ?? {}).sort()).toEqual(['key', 'placement', 'type', 'version']);
  });

  it('describes an empty registry as an empty list', () => {
    expect(describeRegistry(createWidgetRegistry([]))).toEqual([]);
  });
});
