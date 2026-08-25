import { defineWidget } from '@nerey/core';

import { CitationsWidget } from './component';
import {
  CITATIONS_LIFECYCLE,
  CITATIONS_PLACEMENT,
  CITATIONS_TYPE,
  CITATIONS_VERSION,
  citationsPayloadSchema,
  citationsStateSchema,
} from './schema';
import type { CitationsPayload, CitationsState } from './schema';

/**
 * The registry entry. `defineWidget` rather than a bare object literal so the `<Payload, State>`
 * generics survive: written inline, TypeScript widens the component's props and the entry stops
 * type-checking the very thing it exists to describe (ADR 0010).
 *
 * `acceptsVersion` and `migrate` are absent on purpose. Absent `acceptsVersion` keeps resolution
 * exact (ADR 0009); absent `migrate` records that 1.0.0 is the only shape there has ever been
 * (ADR 0030). Both are load-bearing omissions rather than things nobody got round to.
 */
export const citationsWidget = defineWidget<CitationsPayload, CitationsState>({
  type: CITATIONS_TYPE,
  version: CITATIONS_VERSION,
  component: CitationsWidget,
  description:
    'Show the sources behind a claim so the user can open one or quote it back into the ' +
    'conversation. Use it when an answer rests on retrieved material.',
  placement: CITATIONS_PLACEMENT,
  lifecycle: CITATIONS_LIFECYCLE,
  payloadSchema: citationsPayloadSchema,
  stateSchema: citationsStateSchema,
});

export { CitationsWidget } from './component';
export type { CitationsWidgetProps } from './component';
export {
  CITATIONS_LIFECYCLE,
  CITATIONS_PLACEMENT,
  CITATIONS_TYPE,
  CITATIONS_VERSION,
  DEFAULT_NO_SOURCES_LABEL,
  DEFAULT_QUOTE_LABEL,
  NEW_TAB_HINT,
  QUOTE_ACTION,
  citationSourceSchema,
  citationsPayloadSchema,
  citationsStateSchema,
  displayHost,
  quoteRequest,
} from './schema';
export type { CitationSource, CitationsPayload, CitationsState } from './schema';
