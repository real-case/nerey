import type { ReactElement } from 'react';

import { fallbackAttributes } from '../data-attrs';
import type { FallbackReason } from '../data-attrs';
import { useWidgetHost } from '../host/host-context';

export type FallbackProps = { text: string; messageId: string | number; reason: FallbackReason };

/**
 * The terminal step of the degradation chain (ADR 0012) and the one guarantee Nerey makes
 * unconditionally: whatever went wrong, the message stays readable.
 *
 * The text goes through the host's injected `renderFallback` rather than through anything Nerey
 * owns, because the consumer's markdown pipeline already encodes their sanitisation and link
 * policy — shipping a second one would make a security decision on behalf of an application core
 * knows nothing about (ADR 0012 / FR-14).
 *
 * `reason` is emitted rather than inferred so a consumer's CSS and a bug report can tell an
 * unknown widget from a bad payload from an expired one without reading the error stream
 * (ADR 0020). No error is emitted from here: whichever step routed here has already reported.
 */
export function WidgetFallback(props: FallbackProps): ReactElement {
  const { renderFallback } = useWidgetHost();

  // `WidgetHostValue` types `renderFallback` as required, so this guard can only fire for a host
  // assembled in untyped JavaScript — which is exactly step 4's case (ADR 0012). Plain text is a
  // degraded reading experience and never a data loss, whereas calling `undefined` here would
  // throw *outside* the widget's error boundary and take the transcript with it.
  const body =
    typeof renderFallback === 'function'
      ? renderFallback(props.text, { messageId: props.messageId })
      : props.text;

  return <div {...fallbackAttributes(props.reason)}>{body}</div>;
}
