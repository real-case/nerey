/**
 * How a tool call names a widget (ADR 0054). Both bindings are explicit, and neither ever consults
 * the registry: `type@version` is chosen by the producer and matched exactly by the registry
 * (ADR 0009). An adapter that "helpfully" maps a tool name or `"1.0"` onto a registered `1.0.0`
 * would hide the most common wiring bug in this design behind output that looks correct.
 */

/** A widget's exact coordinates. The version is required, so a table row cannot omit it. */
export type WidgetCoordinates = { type: string; version: string };

export type AgUiToolBindings = {
  /**
   * The name of the one generic tool whose arguments are `{ type, version, payload }`. Defaults to
   * `render_widget`; `false` turns the generic tool off.
   */
  renderWidget?: string | false;
  /** One tool per widget: the tool's arguments ARE the payload, and the row fixes `type@version`. */
  table?: Readonly<Record<string, WidgetCoordinates>>;
};

export const DEFAULT_RENDER_WIDGET_TOOL = 'render_widget';

/** The generic tool's name, or `undefined` when it is turned off. */
export function renderWidgetToolOf(bindings: AgUiToolBindings | undefined): string | undefined {
  const name = bindings?.renderWidget;
  if (name === false) return undefined;
  return name ?? DEFAULT_RENDER_WIDGET_TOOL;
}

/** The table row for a tool name. An own-property read, so `constructor` never matches. */
export function tableRowOf(
  bindings: AgUiToolBindings | undefined,
  toolName: string,
): WidgetCoordinates | undefined {
  const table = bindings?.table;
  if (!table || !Object.prototype.hasOwnProperty.call(table, toolName)) return undefined;
  return table[toolName];
}
