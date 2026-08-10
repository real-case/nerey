/**
 * The theme's widget surface, re-exported one directory per widget.
 *
 * ADR 0028 — nothing here is reachable by a deep import once the package is published, so this
 * file is the whole contract. What each widget exports is its registry ENTRY and the payload and
 * state types that describe its envelope: the entry is what a consumer composes into a registry
 * (ADR 0010), and the two types are what their producer — a tool schema, a prompt, a fixture —
 * has to satisfy.
 *
 * The widget COMPONENTS are deliberately not re-exported here. A widget is not used by rendering
 * its component; it is resolved out of a registry by `type@version` and rendered through
 * `WidgetRenderer`, which is what applies migration, validation, the lifecycle and the error
 * boundary (ADR 0009 / 0012). Exporting the components would advertise a second way in that
 * skips all of it, and the first bug it produces is a widget rendered with an unvalidated
 * payload. Each widget's own directory still exports its component for the story files and for
 * anyone who genuinely needs it.
 *
 * `themeWidgets` is the composed catalog, and it lives in `catalog.ts` for the same reason core's
 * does: exactly one file knows the composition, and adding a widget is one line in it.
 */

export { themeWidgets } from './catalog';

export { choiceChipsWidget } from './choice-chips';
export type { Choice, ChoiceChipsPayload, ChoiceChipsState } from './choice-chips';

export { citationsWidget } from './citations';
export type { CitationSource, CitationsPayload, CitationsState } from './citations';

export { confirmationWidget } from './confirmation';
export type {
  ConfirmationDecision,
  ConfirmationPayload,
  ConfirmationState,
  ConfirmationTone,
} from './confirmation';

export { dataTableWidget } from './data-table';
export type {
  DataTableCell,
  DataTableColumn,
  DataTablePayload,
  DataTableRow,
  DataTableSortDirection,
  DataTableState,
} from './data-table';

export { filterPanelWidget } from './filter-panel';
export type {
  Facet,
  FilterOption,
  FilterPanelPayload,
  FilterPanelState,
  FilterSelection,
} from './filter-panel';

export { formWidget } from './form';
export type { FormField, FormFieldKind, FormFieldOption, FormPayload, FormState, FormValue } from './form';

export { pollWidget } from './poll';
export type { PollOption, PollPayload, PollState } from './poll';

export { progressTrackerWidget } from './progress-tracker';
export type { ProgressStep, ProgressTrackerPayload, ProgressTrackerState } from './progress-tracker';

export { taskTreeWidget } from './task-tree';
export type { Task, TaskStatus, TaskTreePayload, TaskTreeState } from './task-tree';

export { textWidget } from './text';
export type { TextPayload, TextState } from './text';

export { toastNoticeWidget } from './toast-notice';
export type {
  ToastNoticeAction,
  ToastNoticePayload,
  ToastNoticeState,
  ToastNoticeTone,
} from './toast-notice';
