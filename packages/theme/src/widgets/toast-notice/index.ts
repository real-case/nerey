import { defineWidget } from '@nerey/core';

import { ToastNoticeWidget } from './component';
import {
  TOAST_NOTICE_LIFECYCLE,
  TOAST_NOTICE_PLACEMENT,
  TOAST_NOTICE_TYPE,
  TOAST_NOTICE_VERSION,
  toastNoticePayloadSchema,
  toastNoticeStateSchema,
} from './schema';
import type { ToastNoticePayload, ToastNoticeState } from './schema';

/**
 * The registry entry (ADR 0010). The interesting field is `placement`: it is what routes this
 * widget to `OverlaySlotHost` instead of into the transcript, and it is read by the host rather
 * than by the component — so a widget that renders correctly and is placed wrongly looks like a
 * widget that does not render at all (ADR 0017).
 *
 * `acceptsVersion` and `migrate` are absent on purpose: exact resolution (ADR 0009), and 1.0.0 is
 * the only shape there has ever been (ADR 0030). A migration would be particularly pointless here —
 * the lifecycle is `ephemeral`, so no notice ever outlives the schema that produced it.
 */
export const toastNoticeWidget = defineWidget<ToastNoticePayload, ToastNoticeState>({
  type: TOAST_NOTICE_TYPE,
  version: TOAST_NOTICE_VERSION,
  component: ToastNoticeWidget,
  placement: TOAST_NOTICE_PLACEMENT,
  lifecycle: TOAST_NOTICE_LIFECYCLE,
  payloadSchema: toastNoticePayloadSchema,
  stateSchema: toastNoticeStateSchema,
});

export { ToastNoticeWidget } from './component';
export type { ToastNoticeWidgetProps } from './component';
export {
  NOTICE_ACTION,
  NOTICE_TIMEOUT_MS,
  TOAST_NOTICE_LIFECYCLE,
  TOAST_NOTICE_PLACEMENT,
  TOAST_NOTICE_TYPE,
  TOAST_NOTICE_VERSION,
  toastNoticeActionSchema,
  toastNoticePayloadSchema,
  toastNoticeStateSchema,
  toastNoticeToneSchema,
} from './schema';
export type { ToastNoticeAction, ToastNoticePayload, ToastNoticeState, ToastNoticeTone } from './schema';
