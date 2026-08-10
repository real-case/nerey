import type { ReactElement } from 'react';
import type { NereyMessage, WidgetStatus } from '../types';
export type WidgetRendererProps = {
  message: NereyMessage;
  status?: WidgetStatus;
  /** Forces read-only regardless of lifecycle — a replayed transcript, a disabled conversation. */
  readonly?: boolean;
};
/**
 * Renders one message: envelope → registry → migration → validation → lifecycle → widget, with a
 * legible fallback at every step that can fail (ADR 0012).
 *
 * Every hook runs before the first conditional return, so the order is stable across all of those
 * outcomes — a chain that returned early would change its hook count between a valid payload and
 * an invalid one, which is the one bug in here React would not merely render wrong but crash on.
 */
export declare function WidgetRenderer(props: WidgetRendererProps): ReactElement;
//# sourceMappingURL=widget-renderer.d.ts.map
