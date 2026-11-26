import { TEXT_WIDGET_TYPE, TEXT_WIDGET_VERSION } from '../../adapter';
import { NEVER_EXPIRES } from '../../lifecycle/expiry';
import { defineWidgetContract } from '../../registry';
import { textPayloadSchema } from './schema';
import type { TextPayload } from './schema';

/** The text widget's React-free half (ADR 0056). The entry in `./index.ts` adds the component. */
export const textContract = defineWidgetContract<TextPayload, Record<string, never>>({
  type: TEXT_WIDGET_TYPE,
  version: TEXT_WIDGET_VERSION,
  description:
    'Plain assistant prose, optionally with preformatted blocks. Every message that carries no ' +
    'widget renders through this, so a producer does not normally select it explicitly.',
  placement: { slot: 'message' },
  lifecycle: NEVER_EXPIRES,
  payloadSchema: textPayloadSchema,
});
