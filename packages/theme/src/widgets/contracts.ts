import type { AnyWidgetContract } from '@nerey/core/server';

import { choiceChipsContract } from './choice-chips/contract';
import { citationsContract } from './citations/contract';
import { confirmationContract } from './confirmation/contract';
import { dataTableContract } from './data-table/contract';
import { filterPanelContract } from './filter-panel/contract';
import { formContract } from './form/contract';
import { pollContract } from './poll/contract';
import { progressTrackerContract } from './progress-tracker/contract';
import { taskTreeContract } from './task-tree/contract';
import { textContract } from './text/contract';
import { toastNoticeContract } from './toast-notice/contract';

/**
 * The contracts of `themeWidgets`, in the same order (ADR 0056). A server describes the theme's
 * catalog with these, because the entries themselves are client references there. Compose them the
 * way the entries are composed — core's first, the theme's after, later wins on a shared key:
 *
 *   describeRegistry(themeWidgetContracts, { toJsonSchema })
 *
 * The theme's list already holds its own `text` and `confirmation`, at core's coordinates, so it
 * describes the composed catalog on its own. `catalog.test.ts` holds this list and `themeWidgets`
 * together field by field.
 */
export const themeWidgetContracts: readonly AnyWidgetContract[] = [
  textContract,
  confirmationContract,
  choiceChipsContract,
  citationsContract,
  dataTableContract,
  filterPanelContract,
  formContract,
  pollContract,
  progressTrackerContract,
  taskTreeContract,
  toastNoticeContract,
];
