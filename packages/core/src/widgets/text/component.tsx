import type { ReactElement } from 'react';

import { TEXT_WIDGET_TYPE, TEXT_WIDGET_VERSION } from '../../adapter';
import { useWidgetHost } from '../../host/host-context';
import { WidgetRoot } from '../../primitives/widget-root';
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
export function TextWidget({ messageId, payload, readonly, status }: TextWidgetProps): ReactElement {
  const { renderFallback } = useWidgetHost();

  // ADR 0019 — while `status` is `streaming` the payload is partial and deliberately not
  // validated, so `content` can be missing, or `payload` absent entirely, however firmly the
  // validated type says otherwise. `renderFallback` is consumer code with no contract to survive
  // `undefined`; the empty string is the honest rendering of "nothing has arrived yet".
  const content = typeof payload?.content === 'string' ? payload.content : '';

  return (
    // No `data-state`: this widget has no state machine, and pinning it to `idle` would promise a
    // transition that never comes. `data-readonly` is still forwarded — the host's read-only
    // decision is about the message, not about interactivity this widget never had (ADR 0020).
    //
    // The renderer's output is placed straight into the root. Wrapping it in a `WidgetPart` would
    // add a box between the consumer's own markup and the node they style, changing the layout of
    // every ordinary message to give a selector that `[data-nerey-widget='text']` already is.
    <WidgetRoot
      type={TEXT_WIDGET_TYPE}
      version={TEXT_WIDGET_VERSION}
      slot="message"
      status={status}
      readonly={readonly}
    >
      {renderFallback(content, { messageId })}
    </WidgetRoot>
  );
}
