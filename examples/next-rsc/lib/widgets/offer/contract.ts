import { defineWidgetContract } from '@nerey/core/server';
import { z } from 'zod';

/**
 * An application's own widget, split the way ADR 0056 splits the shipped ones: this module is
 * React-free, so the server describes it, and `./entry.tsx` adds the component on the client.
 *
 * It exists in the example because no shipped widget expires on a `timeout` and snapshots, and that
 * is the case the smoke test needs: a widget whose deadline passed before the page was requested
 * must arrive from the server render already read-only.
 */
export const OFFER_TIMEOUT_MS = 60_000;

export const offerPayloadSchema = z.object({
  title: z.string().min(1),
  acceptLabel: z.string().min(1),
});

export type OfferPayload = z.infer<typeof offerPayloadSchema>;

export const offerContract = defineWidgetContract<OfferPayload, Record<string, never>>({
  type: 'offer',
  version: '1.0.0',
  description:
    'Make the user a time-limited offer they can accept with one press. It stops accepting once ' +
    'its minute is up.',
  placement: { slot: 'message' },
  lifecycle: {
    persist: 'forever',
    expiry: [{ on: 'timeout', ms: OFFER_TIMEOUT_MS }, { on: 'interact' }],
    afterExpiry: 'snapshot',
  },
  payloadSchema: offerPayloadSchema,
});
