import { describeRegistry } from '@nerey/core/server';
import type { DescribeRegistryOptions, WidgetDescriptor } from '@nerey/core/server';
import { jsonSchema, tool } from 'ai';
import type { JSONSchema7, Tool, ToolSet } from 'ai';

import { renderWidgetToolName } from '../binding';
import type { AiSdkBinding } from '../binding';

/**
 * Registry → AI SDK tools (ADR 0040 / 0055). The model is told exactly the `type@version` strings
 * the registry will accept, because both come from the same entries; nothing here is retyped.
 *
 * The tools have no `execute`. A widget call is answered in the browser, by the person, through
 * `addToolOutput`; a server-side `execute` would answer it before anyone saw the widget.
 */

export type ToolsFromRegistryOptions = {
  binding: AiSdkBinding;
  /** Converts an entry's Standard Schema to JSON Schema. Core has no converter (ADR 0011). */
  toJsonSchema: NonNullable<DescribeRegistryOptions['toJsonSchema']>;
  /** Overrides the single tool's description in `render-widget` mode. */
  description?: string;
};

const ANY_OBJECT: JSONSchema7 = { type: 'object' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The converter's output, accepted only when it is a JSON Schema object (or boolean schema). */
function asJsonSchema(value: unknown, key: string): JSONSchema7 {
  if (value === undefined) return ANY_OBJECT;
  if (isRecord(value)) return value;
  throw new TypeError(`toJsonSchema returned ${typeof value} for ${key}; expected a JSON Schema object.`);
}

function describeAll(descriptors: readonly WidgetDescriptor[]): string {
  return descriptors
    .map(
      (descriptor) =>
        `- ${descriptor.type} (version ${descriptor.version})${descriptor.description ? `: ${descriptor.description}` : ''}`,
    )
    .join('\n');
}

/**
 * `render-widget`: one tool whose input is one of the registry's `{ type, version, payload }`
 * shapes. `type` and `version` are `const` per variant, so the schema itself pairs each version with
 * its payload; a model that sends any other pair produces `unknown-widget` on the client.
 */
function renderWidgetTool(descriptors: readonly WidgetDescriptor[], description: string | undefined): Tool {
  const variants: JSONSchema7[] = descriptors.map((descriptor) => ({
    type: 'object',
    properties: {
      type: { const: descriptor.type },
      version: { const: descriptor.version },
      payload: asJsonSchema(descriptor.payloadSchema, descriptor.key),
    },
    required: ['type', 'version', 'payload'],
    additionalProperties: false,
  }));

  return tool({
    description:
      description ??
      'Show the user an interactive widget. Pick one of these and fill its payload; copy `type` and ' +
        `\`version\` exactly:\n${describeAll(descriptors)}`,
    inputSchema: jsonSchema({ type: 'object', anyOf: variants }),
  });
}

/** `tools`: one tool per table row, its input the entry's payload schema. */
function tableTools(
  descriptors: readonly WidgetDescriptor[],
  tools: Extract<AiSdkBinding, { mode: 'tools' }>['tools'],
): ToolSet {
  const byKey = new Map(descriptors.map((descriptor) => [descriptor.key, descriptor]));
  const set: ToolSet = {};
  for (const [name, ref] of Object.entries(tools)) {
    const key = `${ref.type}@${ref.version}`;
    const descriptor = byKey.get(key);
    // A table row with no entry is a wiring bug that would otherwise surface as a widget that never
    // renders. Failing at startup, on the server, is the cheapest place to find it.
    if (!descriptor) {
      throw new Error(
        `toolsFromRegistry: tool \`${name}\` is bound to \`${key}\`, which the registry does not contain. ` +
          `Registered: ${descriptors.map((entry) => entry.key).join(', ') || 'nothing'}.`,
      );
    }
    set[name] = tool({
      ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
      inputSchema: jsonSchema(asJsonSchema(descriptor.payloadSchema, key)),
    });
  }
  return set;
}

/**
 * Whatever `describeRegistry` accepts: a registry, and wherever core's server entry lets a server
 * describe widgets without their components, those too. Derived rather than restated, so this
 * helper accepts exactly what core can describe and never drifts from it.
 */
export type ToolsSource = Parameters<typeof describeRegistry>[0];

/** The AI SDK `ToolSet` for `streamText({ tools })`, derived from the registry. */
export function toolsFromRegistry(source: ToolsSource, options: ToolsFromRegistryOptions): ToolSet {
  const descriptors = describeRegistry(source, { toJsonSchema: options.toJsonSchema });
  const { binding } = options;
  if (binding.mode === 'tools') return tableTools(descriptors, binding.tools);
  return { [renderWidgetToolName(binding)]: renderWidgetTool(descriptors, options.description) };
}
