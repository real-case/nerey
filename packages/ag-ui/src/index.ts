/**
 * @nerey/ag-ui — the AG-UI protocol adapter for @nerey/core (ADR 0051 / 0054).
 *
 * The only entry point. Everything reachable here is public API (ADR 0028).
 */

export { DEFAULT_RENDER_WIDGET_TOOL } from './bindings';
export type { AgUiToolBindings, WidgetCoordinates } from './bindings';

export { createAgUiTranscript, defaultFallbackText } from './transcript';
export type {
  AgUiFrame,
  AgUiTranscript,
  AgUiTranscriptOptions,
  AgUiWidgetCall,
  FallbackText,
} from './transcript';

export { createAgUiHost, hydrateWidgetStates, subscribeTranscript } from './host';
export type { AgUiAgent, AgUiEventSource, AgUiHostValue, CreateAgUiHostOptions } from './host';

export { toolsFromRegistry } from './tools';
export type { ToolsFromRegistryOptions } from './tools';

export { useAgUiFrames } from './use-ag-ui-frames';
