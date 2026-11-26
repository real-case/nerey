import type { Tool } from '@ag-ui/core';
import { TEXT_WIDGET_TYPE, describeRegistry } from '@nerey/core';
import type { DescribeRegistryOptions, WidgetDescriptor, WidgetRegistry } from '@nerey/core';

import { renderWidgetToolOf } from './bindings';
import type { AgUiToolBindings } from './bindings';

export type ToolsFromRegistryOptions = DescribeRegistryOptions & {
  /** The same bindings the transcript is given, so the tools offered and the calls read agree. */
  tools?: AgUiToolBindings;
};

const ANY_OBJECT = { type: 'object' } as const;

function describeGeneric(name: string, descriptors: readonly WidgetDescriptor[]): Tool {
  const keys = descriptors.map((d) => (d.description ? `${d.key} — ${d.description}` : d.key));
  return {
    name,
    description:
      'Renders an interactive widget in the conversation. `type` and `version` must be copied exactly ' +
      `from one of: ${keys.join('; ')}.`,
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...new Set(descriptors.map((d) => d.type))] },
        version: { type: 'string', enum: [...new Set(descriptors.map((d) => d.version))] },
        payload: ANY_OBJECT,
      },
      required: ['type', 'version', 'payload'],
      additionalProperties: false,
      // Each variant pins its own `type@version` to its own payload schema, so a validator that
      // reads JSON Schema rejects a poll payload labelled `confirmation` before the model sends it.
      anyOf: descriptors.map((d) => ({
        properties: {
          type: { const: d.type },
          version: { const: d.version },
          payload: d.payloadSchema ?? ANY_OBJECT,
        },
      })),
    },
  };
}

/**
 * The AG-UI tool definitions for a registry (ADR 0040 / 0054), derived through `describeRegistry`
 * and never written by hand, so the strings the model is told and the strings the registry
 * resolves cannot drift.
 *
 * The generic tool lists every entry except the built-in `text` widget, which is what a plain
 * assistant message already is. A table row naming a `type@version` the registry does not hold
 * throws: that call could only ever render as a fallback, and the place to learn it is startup.
 */
export function toolsFromRegistry(registry: WidgetRegistry, options: ToolsFromRegistryOptions = {}): Tool[] {
  const describeOptions: DescribeRegistryOptions = {};
  if (options.toJsonSchema) describeOptions.toJsonSchema = options.toJsonSchema;
  const descriptors = describeRegistry(registry, describeOptions);
  const byKey = new Map(descriptors.map((d) => [d.key, d]));
  const out: Tool[] = [];

  const generic = renderWidgetToolOf(options.tools);
  const offered = descriptors.filter((d) => d.type !== TEXT_WIDGET_TYPE);
  if (generic !== undefined && offered.length > 0) out.push(describeGeneric(generic, offered));

  for (const [name, row] of Object.entries(options.tools?.table ?? {})) {
    const key = `${row.type}@${row.version}`;
    const descriptor = byKey.get(key);
    if (!descriptor) {
      throw new Error(
        `@nerey/ag-ui: tool \`${name}\` is bound to \`${key}\`, which the registry does not hold. ` +
          `Registered: ${descriptors.map((d) => d.key).join(', ') || '(none)'}. Lookup is exact (ADR 0009).`,
      );
    }
    out.push({
      name,
      description: descriptor.description ?? `Renders the \`${key}\` widget.`,
      parameters: descriptor.payloadSchema ?? ANY_OBJECT,
    });
  }

  return out;
}
