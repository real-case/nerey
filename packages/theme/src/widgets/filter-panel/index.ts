import { defineWidget } from '@nerey/core';

import { FilterPanelWidget } from './component';
import {
  FILTER_PANEL_PLACEMENT,
  FILTER_PANEL_TYPE,
  FILTER_PANEL_VERSION,
  filterPanelPayloadSchema,
  filterPanelStateSchema,
} from './schema';
import type { FilterPanelPayload, FilterPanelState } from './schema';

/**
 * The composer-attached widget. Every line of the lifecycle differs from the form's, and each
 * difference follows from the placement rather than from taste.
 *
 * `persist: 'ephemeral'` — a half-built filter is not a fact about the conversation. It is worth
 * keeping across a reload of the same turn, which is why the widget still writes through the
 * persistence port (the only channel it has, ADR 0016), but a host is free to drop the record
 * once the turn is over and nothing is lost.
 *
 * `expiry: [{ on: 'interact', action: 'search' }, { on: 'message' }]` — the search ends it, and
 * so does any later message. The second rule is the one ADR 0017 asks input-slot entries to
 * declare: two widgets competing for the composer is a bug on the producing side, and the slot
 * host resolves it by rendering only the most recent — so a panel that never expires is a panel
 * that silently displaces its successor, or gets displaced and leaves no trace.
 *
 * `afterExpiry: 'hide'` — and NOT `snapshot`, which is the right default everywhere else
 * (ADR 0018 / FR-24). "Disabled, not removed" protects the transcript: an answered confirmation
 * must keep showing which button was pressed, because that exchange is history. This widget was
 * never in the transcript. Its output is the message the user sent, which the transcript already
 * holds; leaving a dead filter panel wedged above the composer would preserve nothing and would
 * cost the user the space their next message is written in.
 */
export const filterPanelWidget = defineWidget<FilterPanelPayload, FilterPanelState>({
  type: FILTER_PANEL_TYPE,
  version: FILTER_PANEL_VERSION,
  component: FilterPanelWidget,
  description:
    'Let the user narrow a result set along the facets you list. It renders above the composer ' +
    'and its reply is a sentence stating the chosen filters.',
  placement: FILTER_PANEL_PLACEMENT,
  lifecycle: {
    persist: 'ephemeral',
    expiry: [{ on: 'interact', action: 'search' }, { on: 'message' }],
    afterExpiry: 'hide',
  },
  payloadSchema: filterPanelPayloadSchema,
  stateSchema: filterPanelStateSchema,
});

export { FilterPanelWidget } from './component';
export type { FilterPanelWidgetProps } from './component';
export {
  CHIP_LIMIT,
  DEFAULT_CLEAR_LABEL,
  DEFAULT_FACET_PLACEHOLDER,
  DEFAULT_SEARCH_LABEL,
  EMPTY_QUERY_HINT,
  FILTER_PANEL_PLACEMENT,
  FILTER_PANEL_TYPE,
  FILTER_PANEL_VERSION,
  NO_MATCHES_TEXT,
  PANEL_LABEL,
  QUERY_PREFIX,
  composeQuery,
  filterPanelPayloadSchema,
  filterPanelStateSchema,
  hasSelection,
  selectionFor,
  usesCombobox,
} from './schema';
export type { Facet, FilterOption, FilterPanelPayload, FilterPanelState, FilterSelection } from './schema';
