import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { asAnyWidget, builtInWidgets, createWidgetRegistry, defineWidget, NEVER_EXPIRES } from '@nerey/core';

import { toolsFromRegistry } from './tools';

const poll = defineWidget({
  type: 'poll',
  version: '1.0.0',
  description: 'Ask a closed question.',
  component: () => null,
  placement: { slot: 'message' },
  lifecycle: NEVER_EXPIRES,
  payloadSchema: z.object({ question: z.string() }),
});

const registry = createWidgetRegistry([...builtInWidgets, asAnyWidget(poll)]);
// Confirmation's schema is a hand-written Standard Schema, so the converter handles Zod only — the
// way an application with a mixed registry writes it.
const toJsonSchema = (schema: unknown): unknown =>
  schema instanceof z.ZodType ? z.toJSONSchema(schema) : { type: 'object', description: 'opaque' };

describe('toolsFromRegistry', () => {
  it('derives one generic tool from the registry, without the built-in text widget', () => {
    const [tool, ...rest] = toolsFromRegistry(registry, { toJsonSchema });
    expect(rest).toEqual([]);
    expect(tool?.name).toBe('render_widget');
    expect(tool?.description).toContain('poll@1.0.0 — Ask a closed question.');
    expect(tool?.description).toContain('confirmation@1.0.0');
    expect(tool?.description).not.toContain('text@');
    expect(tool?.parameters).toMatchObject({
      type: 'object',
      required: ['type', 'version', 'payload'],
      properties: { type: { enum: ['confirmation', 'poll'] }, version: { enum: ['1.0.0'] } },
    });
    const variants = (tool?.parameters as { anyOf: { properties: Record<string, unknown> }[] }).anyOf;
    expect(variants[1]?.properties).toEqual({
      type: { const: 'poll' },
      version: { const: '1.0.0' },
      payload: toJsonSchema(poll.payloadSchema),
    });
  });

  it('emits one tool per table row, with the payload schema as its parameters', () => {
    const tools = toolsFromRegistry(registry, {
      toJsonSchema,
      tools: { renderWidget: false, table: { ask_poll: { type: 'poll', version: '1.0.0' } } },
    });
    expect(tools).toEqual([
      {
        name: 'ask_poll',
        description: 'Ask a closed question.',
        parameters: toJsonSchema(poll.payloadSchema),
      },
    ]);
  });

  it('falls back to an open object schema and a generated description without a converter', () => {
    const tools = toolsFromRegistry(
      createWidgetRegistry([asAnyWidget({ ...poll, description: undefined })]),
      {
        tools: { renderWidget: 'ui', table: { ask: { type: 'poll', version: '1.0.0' } } },
      },
    );
    expect(tools.map((t) => t.name)).toEqual(['ui', 'ask']);
    expect(tools[1]).toEqual({
      name: 'ask',
      description: 'Renders the `poll@1.0.0` widget.',
      parameters: { type: 'object' },
    });
  });

  it('throws when a table row names a type@version the registry does not hold — "1.0" is not "1.0.0"', () => {
    expect(() =>
      toolsFromRegistry(registry, { tools: { table: { ask_poll: { type: 'poll', version: '1.0' } } } }),
    ).toThrow(/`poll@1.0`, which the registry does not hold/);
  });

  it('offers no generic tool for a registry with nothing but text', () => {
    expect(toolsFromRegistry(createWidgetRegistry([...builtInWidgets].slice(0, 1)))).toEqual([]);
  });
});
