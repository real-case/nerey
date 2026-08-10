import type { ReactElement } from 'react';

import { TEXT_WIDGET_TYPE, TEXT_WIDGET_VERSION, WidgetRoot, useWidgetHost } from '@nerey/core';
import type { WidgetComponentProps } from '@nerey/core';

import styles from './text.module.css';
import type { TextPayload, TextState } from './schema';

export type TextWidgetProps = WidgetComponentProps<TextPayload, TextState>;

/**
 * The styled replacement for core's `text@1.0.0` — the same passthrough, wearing the theme's
 * prose typography.
 *
 * What it deliberately does NOT do is render the content itself. The host's `renderFallback` is
 * the project's one text-rendering strategy (ADR 0012), and bundling a markdown pipeline here
 * would give a transcript two of them: one sanitisation policy and link policy for ordinary
 * assistant turns, another for degraded widgets, disagreeing only on the bad day. ADR 0037 says
 * the same thing from the other side — markdown is a consumer decision, and a theme that made it
 * for them would be shipping an opinion no `variant` can undo.
 *
 * So the theme's contribution is exactly the part it is allowed to have an opinion about: the
 * box the consumer's markup lands in. `text.module.css` styles that markup by element rather than
 * by class, because the elements are all this widget can know about it.
 */
export function TextWidget({ messageId, payload, readonly, status }: TextWidgetProps): ReactElement {
  const { renderFallback } = useWidgetHost();

  // ADR 0019 — while `status` is `streaming` the payload is partial and deliberately unvalidated,
  // so `content` can be missing and `payload` absent entirely, however firmly the validated type
  // says otherwise. `renderFallback` is consumer code with no contract to survive `undefined`;
  // the empty string is the honest rendering of "nothing has arrived yet".
  const content = typeof payload?.content === 'string' ? payload.content : '';

  return (
    // `className` on a core primitive is the sanctioned path, not a loophole: ADR 0021 offers it
    // precisely because core ships no CSS, and ADR 0026 withholds it from THEME components
    // because those already carry paint. The theme is the consumer here.
    //
    // No `data-state`: this widget has no state machine, and pinning it to `idle` would promise a
    // transition that never comes. The renderer's output goes straight into the root — a
    // `WidgetPart` around it would insert a box between the consumer's markup and the node they
    // style, for a selector `[data-nerey-widget='text']` already is.
    <WidgetRoot
      type={TEXT_WIDGET_TYPE}
      version={TEXT_WIDGET_VERSION}
      slot="message"
      status={status}
      readonly={readonly}
      className={styles.root}
    >
      {renderFallback(content, { messageId })}
    </WidgetRoot>
  );
}
