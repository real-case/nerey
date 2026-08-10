import { z } from 'zod';

import type { Lifecycle, Placement } from '@nerey/core';

/**
 * ADR 0011 — validation happens at the boundary, through Standard Schema. Zod is used here and
 * never in core: core depends on the *spec* so a consumer can bring their own validator, while a
 * theme widget is a reference implementation someone copies, and copying a hand-rolled validator
 * teaches the wrong lesson.
 */

export const CITATIONS_TYPE = 'citations';
export const CITATIONS_VERSION = '1.0.0';
export const CITATIONS_PLACEMENT: Placement = { slot: 'message' };

/**
 * Nothing expires a citation list (ADR 0018). Every other rule in the vocabulary was considered
 * and rejected for the same reason: a source is worth checking precisely when the reader has
 * stopped trusting the answer, which is usually several turns after it was given. `{ on: 'message' }`
 * would take the evidence away at the moment doubt arrives, and `{ on: 'interact' }` would let
 * checking one source close the other four.
 */
export const CITATIONS_LIFECYCLE: Lifecycle = {
  persist: 'forever',
  expiry: [],
  afterExpiry: 'snapshot',
};

/**
 * `z.url()` alone accepts `javascript:alert(1)`: it parses with `URL`, which has no opinion about
 * schemes. This value is model output on its way into an `href`, so the scheme is a security
 * boundary and is checked at the boundary — not with a guard at the JSX, which the next person to
 * add a link would not know to repeat.
 */
const WEB_PROTOCOL = /^https?$/;

export const citationSourceSchema = z.object({
  /** Stable within the payload. It keys React reconciliation and the persisted `asked` list. */
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.url({ protocol: WEB_PROTOCOL }),
  snippet: z.string().optional(),
  /**
   * A display string, not a date. Rendering a `Date` needs a locale and a time zone the widget
   * does not have, and reading the clock during render is exactly the non-determinism ADR 0031
   * rules out of a story — so the producer supplies the words it wants shown.
   */
  publishedAt: z.string().optional(),
});

export const citationsPayloadSchema = z.object({
  claim: z.string().optional(),
  /**
   * An empty list is valid and is deliberately not an error. A claim with nothing behind it is a
   * fact about the answer worth stating out loud, and degrading it to plain text would hide the
   * one thing the reader most needs to know.
   */
  sources: z.array(citationSourceSchema),
});

/**
 * `.nullish()` before the transform because the renderer hands `undefined` to the state schema for
 * a widget nobody has touched (ADR 0012), and a bare `z.object` rejects `undefined` — which would
 * report a validation failure on every first render.
 */
export const citationsStateSchema = z
  .object({
    /** Source ids the reader has already asked the agent to substantiate. */
    asked: z.array(z.string()).optional(),
  })
  .nullish()
  .transform((value) => value ?? {});

export type CitationSource = z.infer<typeof citationSourceSchema>;
export type CitationsPayload = z.infer<typeof citationsPayloadSchema>;
export type CitationsState = z.infer<typeof citationsStateSchema>;

/** The action reported through `onInteraction`. */
export const QUOTE_ACTION = 'quote-source';

export const DEFAULT_QUOTE_LABEL = 'Quote this source';

/** Shown in place of the markers when the payload cites nothing. */
export const DEFAULT_NO_SOURCES_LABEL = 'No sources were cited for this claim.';

/**
 * Appended to every outbound link's accessible name. English and not overridable for the same
 * reason `DEFAULT_DISMISS_LABEL` is in core: a payload cannot carry it, and a link that changes
 * context without warning is a WCAG 3.2.5 failure — a stated limitation until the theme grows an
 * i18n seam, not an oversight.
 */
export const NEW_TAB_HINT = 'opens in a new tab';

/**
 * The message the widget sends when the reader asks for the passage behind a claim.
 *
 * ADR 0014 — the agent reads this as user input, so it has to be a sentence a person would
 * plausibly have typed. `{"action":"quote","sourceId":"s2"}` would be answered as if the user had
 * pasted JSON, which is what it is.
 */
export function quoteRequest(source: CitationSource): string {
  return `Quote the passage from "${source.title}" that supports this.`;
}

/**
 * The visible text of a source's link: the host, because "is this nature.com or is it a blog that
 * copied nature.com" is the question a reader opens a citation to answer.
 *
 * The schema has already parsed the URL, so the failure branch is unreachable in practice; it
 * exists because a widget that throws during render costs the whole message its rendering
 * (ADR 0012), and a raw URL on screen is a far cheaper outcome than a fallback.
 */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
