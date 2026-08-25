import { createContext, useContext, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import {
  CHOICE_CHIPS_MULTIPLE_GROUP_LABEL,
  CHOICE_CHIPS_SAVE_FAILED_NOTICE,
  CHOICE_CHIPS_SENT_LABEL,
  CHOICE_CHIPS_SINGLE_GROUP_LABEL,
  DEFAULT_CHOICE_CHIPS_SEND_LABEL,
} from '../widgets/choice-chips/schema';
import { DEFAULT_NO_SOURCES_LABEL, DEFAULT_QUOTE_LABEL, NEW_TAB_HINT } from '../widgets/citations/schema';
import { DEFAULT_EMPTY_LABEL, DEFAULT_TABLE_LABEL } from '../widgets/data-table/schema';
import {
  DEFAULT_CLEAR_LABEL,
  DEFAULT_FACET_PLACEHOLDER,
  DEFAULT_SEARCH_LABEL,
  EMPTY_QUERY_HINT,
  NO_MATCHES_TEXT,
  PANEL_LABEL,
  QUERY_PREFIX,
} from '../widgets/filter-panel/schema';
import {
  DEFAULT_SELECT_PLACEHOLDER,
  DEFAULT_SUBMIT_LABEL,
  EMPTY_SUBMISSION_TEXT,
} from '../widgets/form/schema';
import {
  DEFAULT_POLL_SUBMIT_LABEL,
  POLL_ANSWERED_LABEL,
  POLL_DETAILS_LABEL,
  POLL_MULTIPLE_GROUP_LABEL,
  POLL_NONE_REPLY,
  POLL_SAVE_FAILED_NOTICE,
  POLL_SINGLE_GROUP_LABEL,
} from '../widgets/poll/schema';
import {
  DEFAULT_PROGRESS_LABEL,
  DEFAULT_RUNNING_LABEL,
  DEFAULT_STEPS_LABEL,
} from '../widgets/progress-tracker/schema';
import { DEFAULT_TASK_TREE_TITLE, TASK_STATUS_LABEL } from '../widgets/task-tree/schema';
import type { TaskStatus } from '../widgets/task-tree/schema';

/**
 * ADR 0041 — the seam Nerey's chrome strings resolve through.
 *
 * A widget cannot take a prop: its props are fixed by `WidgetComponentProps` (ADR 0008 / 0014).
 * So the strings a widget renders — and the reply text it SENDS, which the agent reads as user
 * input (ADR 0014) — had no way in at all, and a non-English deployment shipped English
 * accessible names that the WCAG gate cannot see, because axe checks that a name exists and never
 * what language it is in (ADR 0032).
 *
 * What this is NOT, deliberately: no locale detection, no plural rules, no date or number
 * formatting, no `t()` and no key lookup by string. A consumer with those needs has an i18n
 * library already, and mounts this provider with whatever it resolved. ADR 0037's non-goal holds
 * for `@nerey/core`, which gains none of this — its one unreachable string became a prop instead.
 */

/** The one form of interpolation this record has. See `NereyLabels` for why it is a function. */
export type PollDetailsContext = { title: string };
export type FacetOptionContext = { label: string; count: number };

/**
 * Every chrome string `@nerey/theme` emits, grouped by the widget that renders it.
 *
 * Two fields are functions rather than format strings. A format string needs a parser, a
 * placeholder convention and a runtime error for a missing argument; a function is checked by the
 * compiler and cannot be called wrongly. There are exactly two, and if a third ever needs plural
 * agreement that is the signal to let a consumer's i18n library own the string outright.
 */
export type NereyLabels = {
  choiceChips: {
    /** Default for the payload's `sendLabel`. */
    send: string;
    sent: string;
    singleGroup: string;
    multipleGroup: string;
    saveFailed: string;
  };
  citations: {
    /** Default for the payload's `quoteLabel`. */
    quote: string;
    noSources: string;
    /** Appended to a link's accessible name; the link itself opens in a new tab. */
    newTabHint: string;
  };
  dataTable: {
    /** Default for the payload's `label` — the table's accessible name. */
    label: string;
    empty: string;
  };
  filterPanel: {
    panel: string;
    search: string;
    clear: string;
    emptyQueryHint: string;
    facetPlaceholder: string;
    noMatches: string;
    /** Opens the sentence the widget SENDS. Reply text, not chrome (ADR 0014). */
    queryPrefix: string;
    /** The visually hidden name of one facet option, carrying its result count. */
    facetOption: (context: FacetOptionContext) => string;
  };
  form: {
    submit: string;
    selectPlaceholder: string;
    /** Reply text for a form submitted with nothing filled in. */
    emptySubmission: string;
    /** Visually hidden, for controls whose `required` cannot be expressed in ARIA. */
    requiredHint: string;
  };
  poll: {
    submit: string;
    answered: string;
    details: string;
    /**
     * Suffixed to a disclosure's accessible name so six triggers called "Details" are not six
     * identical entries in a screen reader's element list (WCAG 2.5.3). Includes its own leading
     * separator, because what separates two words is a language's business.
     */
    detailsFor: (context: PollDetailsContext) => string;
    /** Reply text for the "none of the above" choice. */
    noneReply: string;
    singleGroup: string;
    multipleGroup: string;
    saveFailed: string;
  };
  progressTracker: {
    progress: string;
    steps: string;
    running: string;
  };
  taskTree: {
    title: string;
    status: Record<TaskStatus, string>;
  };
};

/**
 * Assembled FROM the exported constants rather than restating their values. The two cannot drift,
 * every constant stays exported for a consumer who imported one, and the change ADR 0041 makes is
 * purely additive (ADR 0029 / 0038).
 */
export const defaultNereyLabels: NereyLabels = {
  choiceChips: {
    send: DEFAULT_CHOICE_CHIPS_SEND_LABEL,
    sent: CHOICE_CHIPS_SENT_LABEL,
    singleGroup: CHOICE_CHIPS_SINGLE_GROUP_LABEL,
    multipleGroup: CHOICE_CHIPS_MULTIPLE_GROUP_LABEL,
    saveFailed: CHOICE_CHIPS_SAVE_FAILED_NOTICE,
  },
  citations: {
    quote: DEFAULT_QUOTE_LABEL,
    noSources: DEFAULT_NO_SOURCES_LABEL,
    newTabHint: NEW_TAB_HINT,
  },
  dataTable: {
    label: DEFAULT_TABLE_LABEL,
    empty: DEFAULT_EMPTY_LABEL,
  },
  filterPanel: {
    panel: PANEL_LABEL,
    search: DEFAULT_SEARCH_LABEL,
    clear: DEFAULT_CLEAR_LABEL,
    emptyQueryHint: EMPTY_QUERY_HINT,
    facetPlaceholder: DEFAULT_FACET_PLACEHOLDER,
    noMatches: NO_MATCHES_TEXT,
    queryPrefix: QUERY_PREFIX,
    facetOption: ({ label, count }) => `${label}, ${String(count)} results`,
  },
  form: {
    submit: DEFAULT_SUBMIT_LABEL,
    selectPlaceholder: DEFAULT_SELECT_PLACEHOLDER,
    emptySubmission: EMPTY_SUBMISSION_TEXT,
    requiredHint: '(required)',
  },
  poll: {
    submit: DEFAULT_POLL_SUBMIT_LABEL,
    answered: POLL_ANSWERED_LABEL,
    details: POLL_DETAILS_LABEL,
    detailsFor: ({ title }) => ` for ${title}`,
    noneReply: POLL_NONE_REPLY,
    singleGroup: POLL_SINGLE_GROUP_LABEL,
    multipleGroup: POLL_MULTIPLE_GROUP_LABEL,
    saveFailed: POLL_SAVE_FAILED_NOTICE,
  },
  progressTracker: {
    progress: DEFAULT_PROGRESS_LABEL,
    steps: DEFAULT_STEPS_LABEL,
    running: DEFAULT_RUNNING_LABEL,
  },
  taskTree: {
    title: DEFAULT_TASK_TREE_TITLE,
    status: TASK_STATUS_LABEL,
  },
};

/** An override may replace any subset, at any depth, and keeps every sibling it does not name. */
export type NereyLabelOverrides = {
  [Section in keyof NereyLabels]?: {
    [Key in keyof NereyLabels[Section]]?: NereyLabels[Section][Key] extends Record<string, string>
      ? Partial<NereyLabels[Section][Key]>
      : NereyLabels[Section][Key];
  };
};

/**
 * Merges an override over the defaults, one section at a time, descending one further level for
 * the map-shaped fields (`taskTree.status`). Functions are replaced wholesale and never merged
 * into — a function is a value here, not a namespace.
 */
function mergeLabels(base: NereyLabels, overrides: NereyLabelOverrides | undefined): NereyLabels {
  if (!overrides) return base;
  const merged = { ...base } as Record<string, Record<string, unknown>>;

  for (const [section, values] of Object.entries(overrides)) {
    if (!values) continue;
    const target = { ...(merged[section] ?? {}) };
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const existing = target[key];
      // One level deeper for the map-shaped fields — today only `taskTree.status`, where a
      // consumer overriding one status must keep the other four. A function is a value here and
      // never a namespace, so `typeof === 'object'` is exactly the right test: it excludes them.
      if (typeof value === 'object' && value !== null && typeof existing === 'object' && existing !== null) {
        target[key] = { ...existing, ...value };
      } else {
        target[key] = value;
      }
    }
    merged[section] = target;
  }

  return merged as unknown as NereyLabels;
}

const LabelsContext = createContext<NereyLabels>(defaultNereyLabels);

export type NereyLabelsProviderProps = {
  /** Replaces any subset of the defaults. Omitted entirely, the defaults are used unchanged. */
  labels?: NereyLabelOverrides;
  children?: ReactNode;
};

/**
 * Supplies chrome strings to every Nerey widget below it.
 *
 * Mounting it is optional: without it, `useNereyLabels` returns the defaults, which is exactly the
 * behaviour that existed before ADR 0041. A consumer with more than one language mounts it with
 * whatever their own i18n layer resolved — Nerey does not know what a locale is.
 */
export function NereyLabelsProvider(props: NereyLabelsProviderProps): ReactElement {
  const { labels, children } = props;
  // Memoised on the override object: a fresh value every render would re-render every widget in
  // the transcript on any unrelated state change in the consumer's tree.
  const value = useMemo(() => mergeLabels(defaultNereyLabels, labels), [labels]);
  return <LabelsContext.Provider value={value}>{children}</LabelsContext.Provider>;
}

/**
 * The strings for the widget calling it. Always defined — the context defaults to
 * `defaultNereyLabels`, so a widget rendered with no provider anywhere still has every string.
 */
export function useNereyLabels(): NereyLabels {
  return useContext(LabelsContext);
}
