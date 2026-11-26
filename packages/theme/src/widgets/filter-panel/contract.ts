import { defineWidgetContract } from '@nerey/core/server';

import {
  FILTER_PANEL_PLACEMENT,
  FILTER_PANEL_TYPE,
  FILTER_PANEL_VERSION,
  filterPanelPayloadSchema,
  filterPanelStateSchema,
} from './schema';
import type { FilterPanelPayload, FilterPanelState } from './schema';

/**
 * The React-free half of `filterPanelWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const filterPanelContract = defineWidgetContract<FilterPanelPayload, FilterPanelState>({
  type: FILTER_PANEL_TYPE,
  version: FILTER_PANEL_VERSION,
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
