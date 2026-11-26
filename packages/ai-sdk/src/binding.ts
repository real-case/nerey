/**
 * How AI SDK tool calls map onto registry entries (ADR 0055). Nothing in this module looks a tool
 * name up in a registry or "nearly" matches a version: it only reads what the consumer declared and
 * what the model sent, and the registry's exact `type@version` match decides (ADR 0009).
 */

/** The default name of the single tool in `render-widget` mode. */
export const RENDER_WIDGET_TOOL = 'render_widget';

/** A registry coordinate. The version is required and is never padded, stripped or ranged. */
export type WidgetRef = { type: string; version: string };

/**
 * - `render-widget`: one tool whose input is `{ type, version, payload }`. The model names the
 *   version, and it reaches the registry as sent.
 * - `tools`: one tool per widget, whose input is the payload, bound through an explicit table.
 *
 * A tool call that matches neither is not a widget, and the adapter leaves it alone.
 */
export type AiSdkBinding =
  | { mode: 'render-widget'; toolName?: string }
  | { mode: 'tools'; tools: Readonly<Record<string, WidgetRef>> };

/** What a tool call resolves to: the coordinates and payload the envelope will carry. */
export type BoundCall = { type: string | undefined; version: string | undefined; payload: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The single tool's name in `render-widget` mode. */
export function renderWidgetToolName(binding: Extract<AiSdkBinding, { mode: 'render-widget' }>): string {
  return binding.toolName ?? RENDER_WIDGET_TOOL;
}

/**
 * Resolves a tool call against the binding, or `undefined` when the tool is not a widget.
 *
 * In `render-widget` mode a streaming input may not have its `type` or `version` yet; they come
 * back `undefined` and the caller decides. A non-string value is passed on as its string form
 * rather than dropped, so a model that sends `version: 1` gets an `unknown-widget` error naming
 * `1`, not a silently missing widget.
 */
export function bindCall(binding: AiSdkBinding, toolName: string, input: unknown): BoundCall | undefined {
  if (binding.mode === 'tools') {
    const ref = Object.hasOwn(binding.tools, toolName) ? binding.tools[toolName] : undefined;
    if (!ref) return undefined;
    return { type: ref.type, version: ref.version, payload: input };
  }

  if (toolName !== renderWidgetToolName(binding)) return undefined;
  const record = isRecord(input) ? input : {};
  return {
    type: coordinate(record.type),
    version: coordinate(record.version),
    payload: record.payload,
  };
}

function coordinate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}
