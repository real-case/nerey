import { NEVER_EXPIRES, TEXT_WIDGET_TYPE, TEXT_WIDGET_VERSION, defineWidget } from '@nerey/core';

import { TextWidget } from './component';
import { textPayloadSchema } from './schema';
import type { TextPayload, TextState } from './schema';

/**
 * The theme's `text@1.0.0`, registered at the same coordinates as core's built-in so that
 * `composeRegistries({ override: true }, builtInWidgets, themeWidgets)` replaces it (ADR 0010).
 * That is the intended way to re-skin a built-in: one entry wins the key, nothing forks, and a
 * consumer who drops the theme falls back to the headless original rather than to nothing.
 *
 * `type` and `version` are imported rather than restated as literals — the same reason core
 * imports them from its adapter. Every message without a widget is rendered through an envelope
 * `resolveEnvelope` synthesises with exactly these constants, and resolution is an exact match
 * (ADR 0009), so a divergence here would not fail a build: it would degrade every plain assistant
 * message in the transcript to `unknown-widget`.
 *
 * `NEVER_EXPIRES` for the same reason it holds in core. Text is the one widget with nothing to
 * expire — no interaction to terminate, no deadline that could make prose stale — and any other
 * lifecycle would eventually stop rendering a message the transcript still needs to show.
 */
export const textWidget = defineWidget<TextPayload, TextState>({
  type: TEXT_WIDGET_TYPE,
  version: TEXT_WIDGET_VERSION,
  component: TextWidget,
  placement: { slot: 'message' },
  lifecycle: NEVER_EXPIRES,
  payloadSchema: textPayloadSchema,
});

export { TextWidget } from './component';
export type { TextWidgetProps } from './component';
export { textPayloadSchema } from './schema';
export type { TextPayload, TextState } from './schema';
