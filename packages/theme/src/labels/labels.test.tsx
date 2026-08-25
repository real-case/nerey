import { WidgetRenderer, composeRegistries } from '@nerey/core';
import { MockWidgetHost, widgetMessage } from '@nerey/core/mock';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
  POLL_TYPE,
  POLL_VERSION,
} from '../widgets/poll/schema';
import {
  DEFAULT_PROGRESS_LABEL,
  DEFAULT_RUNNING_LABEL,
  DEFAULT_STEPS_LABEL,
} from '../widgets/progress-tracker/schema';
import { DEFAULT_TASK_TREE_TITLE, TASK_STATUS_LABEL } from '../widgets/task-tree/schema';
import { themeWidgets } from '../widgets/catalog';
import { NereyLabelsProvider, defaultNereyLabels, useNereyLabels } from './labels';

describe('defaultNereyLabels', () => {
  /**
   * ADR 0041 — the defaults are assembled FROM the exported constants rather than restating them,
   * and this is what keeps one string from quietly becoming two. If somebody edits
   * `POLL_DETAILS_LABEL` and forgets the record, or edits the record and forgets the constant,
   * exactly one of them moves and this fails.
   */
  it('matches the exported constant behind every string', () => {
    expect(defaultNereyLabels).toMatchObject({
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
      dataTable: { label: DEFAULT_TABLE_LABEL, empty: DEFAULT_EMPTY_LABEL },
      filterPanel: {
        panel: PANEL_LABEL,
        search: DEFAULT_SEARCH_LABEL,
        clear: DEFAULT_CLEAR_LABEL,
        emptyQueryHint: EMPTY_QUERY_HINT,
        facetPlaceholder: DEFAULT_FACET_PLACEHOLDER,
        noMatches: NO_MATCHES_TEXT,
        queryPrefix: QUERY_PREFIX,
      },
      form: {
        submit: DEFAULT_SUBMIT_LABEL,
        selectPlaceholder: DEFAULT_SELECT_PLACEHOLDER,
        emptySubmission: EMPTY_SUBMISSION_TEXT,
      },
      poll: {
        submit: DEFAULT_POLL_SUBMIT_LABEL,
        answered: POLL_ANSWERED_LABEL,
        details: POLL_DETAILS_LABEL,
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
      taskTree: { title: DEFAULT_TASK_TREE_TITLE, status: TASK_STATUS_LABEL },
    });
  });

  /** The two interpolated strings — the whole of Nerey's interpolation requirement (ADR 0041). */
  it('interpolates through typed functions, not format strings', () => {
    expect(defaultNereyLabels.poll.detailsFor({ title: 'Window seat' })).toBe(' for Window seat');
    expect(defaultNereyLabels.filterPanel.facetOption({ label: 'Cabin', count: 42 })).toBe(
      'Cabin, 42 results',
    );

    // @ts-expect-error — a function cannot be called with the wrong context, which is the whole
    // argument for functions over format strings: a missing placeholder is a compile error here
    // rather than an `undefined` in a screen reader.
    defaultNereyLabels.poll.detailsFor({ label: 'Window seat' });
  });
});

describe('NereyLabelsProvider', () => {
  const registry = composeRegistries(themeWidgets);
  const pollPayload = {
    question: 'Which seat?',
    options: [
      { value: 'window', title: 'Window' },
      { value: 'aisle', title: 'Aisle', description: 'Easier to get out.' },
    ],
  };

  function renderPoll(labels?: Parameters<typeof NereyLabelsProvider>[0]['labels']) {
    return render(
      <NereyLabelsProvider labels={labels}>
        <MockWidgetHost registry={registry}>
          <WidgetRenderer
            message={widgetMessage({
              id: 'poll-1',
              type: POLL_TYPE,
              version: POLL_VERSION,
              payload: pollPayload,
            })}
          />
        </MockWidgetHost>
      </NereyLabelsProvider>,
    );
  }

  /**
   * Rendered through `WidgetRenderer` inside `MockWidgetHost` rather than by calling the component
   * — that is what proves the whole chain reads the context, which is the thing being claimed
   * (ADR 0031).
   */
  it('reaches a widget rendered through the whole chain', () => {
    renderPoll({ poll: { details: 'Подробнее' } });

    expect(screen.getByText('Подробнее')).toBeInTheDocument();
    expect(screen.queryByText(POLL_DETAILS_LABEL)).not.toBeInTheDocument();
  });

  it('leaves the defaults in place with no provider value', () => {
    renderPoll();

    expect(screen.getByText(POLL_DETAILS_LABEL)).toBeInTheDocument();
  });

  it('keeps the siblings an override does not name', () => {
    renderPoll({ poll: { details: 'Подробнее' } });

    // The submit button still carries the default: overriding one string must not blank the rest
    // of its own section, let alone another widget's.
    expect(screen.getByRole('button', { name: DEFAULT_POLL_SUBMIT_LABEL })).toBeInTheDocument();
  });
});

describe('the override merge', () => {
  function merged(labels: Parameters<typeof NereyLabelsProvider>[0]['labels']) {
    // Reading the merge through the provider rather than exporting the merge function: what a
    // consumer can observe is what a widget receives, and that is what should be pinned.
    let seen: unknown;
    function Probe() {
      seen = useNereyLabels();
      return null;
    }
    render(
      <NereyLabelsProvider labels={labels}>
        <Probe />
      </NereyLabelsProvider>,
    );
    return seen as typeof defaultNereyLabels;
  }

  it('replaces one string and keeps every other section', () => {
    const labels = merged({ poll: { details: 'Подробнее' } });

    expect(labels.poll.details).toBe('Подробнее');
    expect(labels.poll.answered).toBe(POLL_ANSWERED_LABEL);
    expect(labels.taskTree.title).toBe(DEFAULT_TASK_TREE_TITLE);
    expect(labels.citations.quote).toBe(DEFAULT_QUOTE_LABEL);
  });

  /** One level deeper than the sections — today only `taskTree.status`. */
  it('merges a map-shaped field without dropping its other keys', () => {
    const labels = merged({ taskTree: { status: { running: 'Выполняется' } } });

    expect(labels.taskTree.status.running).toBe('Выполняется');
    expect(labels.taskTree.status.done).toBe(TASK_STATUS_LABEL.done);
    expect(labels.taskTree.status.pending).toBe(TASK_STATUS_LABEL.pending);
  });

  it('replaces an interpolating function wholesale', () => {
    const labels = merged({ poll: { detailsFor: ({ title }) => `, вариант «${title}»` } });

    expect(labels.poll.detailsFor({ title: 'Окно' })).toBe(', вариант «Окно»');
    expect(labels.poll.details).toBe(POLL_DETAILS_LABEL);
  });
});
