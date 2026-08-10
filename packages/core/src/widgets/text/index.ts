import { TEXT_WIDGET_TYPE, TEXT_WIDGET_VERSION } from '../../adapter';
import { NEVER_EXPIRES } from '../../lifecycle/expiry';
import { defineWidget } from '../../registry';
import { TextWidget } from './component';
import { textPayloadSchema } from './schema';
import type { TextPayload } from './schema';

/**
 * One of core's two built-in entries (ADR 0035). It introduces no markup, no styling surface and
 * no dependency core did not already require, because everything it renders goes through the
 * fallback port the degradation chain needs regardless (ADR 0012).
 *
 * `type` and `version` come from `adapter.ts` rather than being restated as literals. Every
 * message without a widget is rendered through an envelope `resolveEnvelope` synthesises with
 * those exact constants, and resolution is an exact `type@version` match (ADR 0009) — so a
 * divergence between the two would not fail a build, it would degrade every plain assistant
 * message in the transcript to `unknown-widget`.
 *
 * `NEVER_EXPIRES`: text is the one widget with nothing to expire. There is no interaction to
 * terminate and no deadline that could make prose stale, and any other lifecycle would eventually
 * stop rendering a message the transcript still needs to show.
 */
export const textWidget = defineWidget<TextPayload, Record<string, never>>({
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
export type { TextPayload } from './schema';
