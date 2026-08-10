import type { ReactElement } from 'react';
import type { WidgetComponentProps } from '../../types';
import type { TextPayload } from './schema';
/** The `text` widget holds nothing the user can change, so its state type is uninhabited. */
export type TextWidgetProps = WidgetComponentProps<TextPayload, Record<string, never>>;
/**
 * The terminal step of the degradation chain, made addressable as a widget type (ADR 0035).
 *
 * Routing the content through the host's `renderFallback` is the point of the widget, not a
 * shortcut around writing one. The injected renderer *is* the project's text-rendering strategy
 * (ADR 0012), so a consumer who wires markdown once gets markdown for ordinary assistant turns
 * and for every degraded widget, from the same component with the same sanitisation and link
 * policy. Rendering `content` directly here would give a transcript two text renderers that
 * disagree, and the disagreement would only be visible on the bad day.
 *
 * It also keeps the fallback port exercised continuously: every plain message in the transcript
 * arrives as a synthesised `text` envelope (`resolveEnvelope`), so a broken `renderFallback` is
 * discovered on the first render rather than the first widget failure.
 */
export declare function TextWidget({ messageId, payload, readonly, status }: TextWidgetProps): ReactElement;
//# sourceMappingURL=component.d.ts.map
