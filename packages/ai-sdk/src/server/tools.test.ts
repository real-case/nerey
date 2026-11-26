import { createWidgetRegistry, defineWidget, NEVER_EXPIRES } from '@nerey/core/server';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import { toolsFromRegistry } from './tools';

const pollSchema = z.object({ question: z.string(), options: z.array(z.string()).min(1) });
const noteSchema = z.object({ body: z.string() });

const registry = createWidgetRegistry([
  defineWidget({
    type: 'poll',
    version: '1.0.0',
    description: 'Ask a closed question.',
    component: () => null,
    placement: { slot: 'message' },
    lifecycle: NEVER_EXPIRES,
    payloadSchema: pollSchema,
  }),
  defineWidget({
    type: 'note',
    version: '2.1.0',
    component: () => null,
    placement: { slot: 'message' },
    lifecycle: NEVER_EXPIRES,
    payloadSchema: noteSchema,
  }),
]);

// The test's converter: Zod 4 ships one; any Standard Schema vendor with a converter works the same.
const toJsonSchema = (schema: StandardSchemaV1<unknown, unknown>): unknown =>
  z.toJSONSchema(schema as unknown as z.ZodType);

async function schemaOf(tool: { inputSchema: unknown } | undefined): Promise<unknown> {
  const schema = tool?.inputSchema as { jsonSchema: unknown } | undefined;
  return await schema?.jsonSchema;
}

describe('toolsFromRegistry — render-widget mode', () => {
  const tools = toolsFromRegistry(registry, { binding: { mode: 'render-widget' }, toJsonSchema });

  it('declares one tool, with no execute, so the call is answered in the browser', () => {
    expect(Object.keys(tools)).toEqual(['render_widget']);
    expect(tools.render_widget?.execute).toBeUndefined();
  });

  it('pairs each const type with its const version and payload schema, from the registry', async () => {
    const schema = (await schemaOf(tools.render_widget)) as { type: string; anyOf: unknown[] };
    expect(schema.type).toBe('object');
    expect(schema.anyOf).toEqual([
      {
        type: 'object',
        properties: {
          type: { const: 'poll' },
          version: { const: '1.0.0' },
          payload: toJsonSchema(pollSchema),
        },
        required: ['type', 'version', 'payload'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          type: { const: 'note' },
          version: { const: '2.1.0' },
          payload: toJsonSchema(noteSchema),
        },
        required: ['type', 'version', 'payload'],
        additionalProperties: false,
      },
    ]);
  });

  it('lists every widget with its exact version and description', () => {
    expect(tools.render_widget?.description).toContain('- poll (version 1.0.0): Ask a closed question.');
    expect(tools.render_widget?.description).toContain('- note (version 2.1.0)');
  });

  it('honours a custom tool name and description', () => {
    const custom = toolsFromRegistry(registry, {
      binding: { mode: 'render-widget', toolName: 'show' },
      toJsonSchema,
      description: 'Show a widget.',
    });
    expect(Object.keys(custom)).toEqual(['show']);
    expect(custom.show?.description).toBe('Show a widget.');
  });
});

describe('toolsFromRegistry — tools mode', () => {
  it('declares one tool per row, its input the entry payload schema', async () => {
    const tools = toolsFromRegistry(registry, {
      binding: { mode: 'tools', tools: { ask: { type: 'poll', version: '1.0.0' } } },
      toJsonSchema,
    });
    expect(Object.keys(tools)).toEqual(['ask']);
    expect(tools.ask?.description).toBe('Ask a closed question.');
    expect(await schemaOf(tools.ask)).toEqual(toJsonSchema(pollSchema));
  });

  it('omits the description when the entry has none', () => {
    const tools = toolsFromRegistry(registry, {
      binding: { mode: 'tools', tools: { write: { type: 'note', version: '2.1.0' } } },
      toJsonSchema,
    });
    expect(tools.write?.description).toBeUndefined();
  });

  it('fails at startup on a row whose version is not registered — no near match', () => {
    expect(() =>
      toolsFromRegistry(registry, {
        binding: { mode: 'tools', tools: { ask: { type: 'poll', version: '1.0' } } },
        toJsonSchema,
      }),
    ).toThrow(
      /`ask` is bound to `poll@1\.0`, which the registry does not contain\. Registered: poll@1\.0\.0, note@2\.1\.0/,
    );
  });
});

describe('toolsFromRegistry — converter output', () => {
  it('uses an open object schema for an entry without a payload schema', async () => {
    const bare = createWidgetRegistry([
      defineWidget({
        type: 'bare',
        version: '1.0.0',
        component: () => null,
        placement: { slot: 'message' },
        lifecycle: NEVER_EXPIRES,
      }),
    ]);
    const tools = toolsFromRegistry(bare, {
      binding: { mode: 'tools', tools: { b: { type: 'bare', version: '1.0.0' } } },
      toJsonSchema,
    });
    expect(await schemaOf(tools.b)).toEqual({ type: 'object' });
  });

  it('rejects a converter that does not return a schema object', () => {
    expect(() =>
      toolsFromRegistry(registry, { binding: { mode: 'render-widget' }, toJsonSchema: () => 'nope' }),
    ).toThrow(/toJsonSchema returned string for poll@1\.0\.0/);
  });
});
