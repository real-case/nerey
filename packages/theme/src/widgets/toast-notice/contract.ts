import { defineWidgetContract } from '@nerey/core/server';

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
 * The React-free half of `toastNoticeWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const toastNoticeContract = defineWidgetContract<ToastNoticePayload, ToastNoticeState>({
  type: TOAST_NOTICE_TYPE,
  version: TOAST_NOTICE_VERSION,
  description:
    'Announce something about the session rather than the conversation — a finished background ' +
    'job, an expiring token, a rate limit. It floats above the chat and leaves no turn behind.',
  placement: TOAST_NOTICE_PLACEMENT,
  lifecycle: TOAST_NOTICE_LIFECYCLE,
  payloadSchema: toastNoticePayloadSchema,
  stateSchema: toastNoticeStateSchema,
});
