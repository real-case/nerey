/**
 * @nerey/theme/server — the theme's widget contracts, for React Server Components (ADR 0056).
 *
 * The main entry is a `'use client'` boundary, so on the server every widget entry it exports is a
 * client reference and its `type`, `version` and schemas cannot be read. This entry is built on its
 * own with no banner, and reaches only `zod` and `@nerey/core/server`; `server-entry.test.ts` fails
 * on anything else.
 */

export { themeWidgetContracts } from '../widgets/contracts';
export { choiceChipsContract } from '../widgets/choice-chips/contract';
export { citationsContract } from '../widgets/citations/contract';
export { confirmationContract } from '../widgets/confirmation/contract';
export { dataTableContract } from '../widgets/data-table/contract';
export { filterPanelContract } from '../widgets/filter-panel/contract';
export { formContract } from '../widgets/form/contract';
export { pollContract } from '../widgets/poll/contract';
export { progressTrackerContract } from '../widgets/progress-tracker/contract';
export { taskTreeContract } from '../widgets/task-tree/contract';
export { textContract } from '../widgets/text/contract';
export { toastNoticeContract } from '../widgets/toast-notice/contract';
