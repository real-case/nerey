import { useId, useState } from 'react';
import type { ReactElement } from 'react';

import { WidgetPart, WidgetRoot, useWidgetState } from '@nerey/core';
import type { NereyState, WidgetComponentProps } from '@nerey/core';

import { Button } from '../../components/button/button';
import { Checkbox, CheckboxGroup } from '../../components/checkbox/checkbox';
import { Collapsible } from '../../components/collapsible/collapsible';
import { CheckIcon } from '../../components/icons/icons';
import { Radio, RadioGroup } from '../../components/radio-group/radio-group';
import { VisuallyHidden } from '../../components/visually-hidden/visually-hidden';
import { useNereyLabels } from '../../labels/labels';
import styles from './poll.module.css';
import {
  EMPTY_POLL_STATE,
  POLL_PLACEMENT,
  POLL_TYPE,
  POLL_VERSION,
  replyFor,
  selectionValue,
} from './schema';
import type { PollOption, PollPayload, PollState } from './schema';

export type PollWidgetProps = WidgetComponentProps<PollPayload, PollState>;

/**
 * The action this widget reports. Named, because the registry's expiry rule targets it by name —
 * `{ on: 'interact', action: 'submit' }` — and a typo there is a poll that never expires.
 */
const SUBMIT_ACTION = 'submit';

/**
 * A controlled `RadioGroup` needs a defined value or Base UI treats it as uncontrolled and starts
 * keeping a second copy of the selection. No option may have an empty value (the schema forbids
 * it), so the empty string is unambiguously "nothing is chosen".
 */
const NO_SELECTION = '';

function toArray(selected: string | string[] | undefined): string[] {
  if (selected === undefined) return [];
  return typeof selected === 'string' ? [selected] : [...selected];
}

type OptionControlProps = {
  value: string;
  multiple: boolean;
  readOnly: boolean;
};

/**
 * The tick box or the dot, whichever the poll's mode calls for.
 *
 * The round/square distinction is not decoration: it is the only thing that tells a user, before
 * they click, whether choosing this one unchooses the last one. That is also why `multiple` picks
 * a genuinely different control rather than relaxing a rule on the same one.
 */
function OptionControl({ value, multiple, readOnly }: OptionControlProps): ReactElement {
  if (multiple) {
    return (
      <Checkbox.Root value={value} readOnly={readOnly}>
        <Checkbox.Indicator />
      </Checkbox.Root>
    );
  }
  return (
    <Radio.Root value={value} readOnly={readOnly}>
      <Radio.Indicator />
    </Radio.Root>
  );
}

type OptionRowProps = {
  option: PollOption;
  multiple: boolean;
  selected: boolean;
  readOnly: boolean;
};

function OptionRow({ option, multiple, selected, readOnly }: OptionRowProps): ReactElement {
  const labels = useNereyLabels();
  return (
    <WidgetPart part="option" state={selected ? 'selected' : undefined} className={styles.optionRow}>
      {/*
        A wrapping `<label>` rather than an `aria-labelledby` we write ourselves. Base UI renders
        a hidden `<input>` beside the control and derives the control's accessible name from
        whichever label owns that input, so this is the association it already understands — and
        it makes the whole title row a hit target, which an `aria-labelledby` does not.

        `Field.Item` + `Field.Label` is the other way, and it is what the component-level stories
        use. It is rejected here because it brings the validity machine and form registration with
        it: a poll has no form, submits nothing, and a widget dropped inside a consumer's `<form>`
        must not start registering fields in it.
      */}
      <label className={styles.optionLabel}>
        <OptionControl value={option.value} multiple={multiple} readOnly={readOnly} />
        <span className={styles.optionTitle}>{option.title}</span>
      </label>

      {option.description !== undefined && (
        /*
          Outside the label, deliberately. Inside it, every click on the disclosure would also
          toggle the option — the control the label names — so opening a description would answer
          the question.
        */
        <Collapsible.Root>
          <Collapsible.Trigger>
            {labels.poll.details}
            {/*
              Six triggers all called "Details" are six identical entries in a screen reader's
              element list. The suffix is hidden from the page and present in the accessible name,
              which keeps the visible label a prefix of it — what WCAG 2.5.3 asks for.
            */}
            <VisuallyHidden>{labels.poll.detailsFor({ title: option.title })}</VisuallyHidden>
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <p className={styles.optionDescription}>{option.description}</p>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </WidgetPart>
  );
}

/**
 * The reference widget. Everything Nerey claims about widgets is visible here at once:
 * `onInteraction` as the only outbound channel (ADR 0014), `useWidgetState` as the only
 * persistence channel (ADR 0015 / 0016), `readonly` from the lifecycle runtime (ADR 0018), and
 * the `data-*` surface as the styling seam (ADR 0020).
 *
 * The behaviour that is easy to get wrong, and was got wrong in production before it was got
 * right here:
 *
 * **Selection is two-step.** Clicking an option sets a tentative highlight and sends nothing; a
 * Submit button commits. A poll that replied on the first click meant every mis-click became a
 * message in the transcript and a model turn spent answering it, and there was no way back
 * because the reply had already been read.
 *
 * **A failed write does not unlock the poll.** By the time the write runs, the reply is already
 * with the agent. Re-enabling the options would invite the second press that sends the same
 * answer twice, and a duplicate reply is far less recoverable than a lost state record — see the
 * long note in `useWidgetState`, which is where this rule is enforced rather than merely
 * honoured (ADR 0016).
 */
export function PollWidget(props: PollWidgetProps): ReactElement {
  const { messageId, payload, state, readonly, status, onInteraction } = props;
  const labels = useNereyLabels();

  /**
   * `debounceMs: 0` because a poll writes exactly once in its entire life. Debouncing exists to
   * coalesce a burst — a slider, a text field — and there is no burst here; all the default
   * window would buy is 400ms during which the answer is on screen, the reply is with the agent,
   * and the store still says nothing happened.
   */
  const {
    state: persisted,
    setState,
    status: saveStatus,
  } = useWidgetState<PollState>(messageId, state ?? EMPTY_POLL_STATE, { debounceMs: 0 });

  /**
   * While streaming, the payload is partial and deliberately unvalidated (ADR 0019), so the
   * declared type is a promise about the terminal state rather than about this render. Reaching
   * straight for `.map` would throw into the error boundary halfway through a stream and replace
   * a half-built poll with a render-error fallback.
   */
  const options = payload.options ?? [];
  const multiple = payload.multiple === true;

  const committed = toArray(persisted.selected);
  const answered = committed.length > 0;

  /**
   * Committed the moment an answer exists, and nothing takes it back — not a failed write, not a
   * re-render, not a remount against the same persisted record.
   */
  const locked = readonly || answered;

  // A payload that is still streaming is not a question yet, and one that arrived as an error is
  // not a question at all (ADR 0019). Neither is answerable, and both are still worth rendering.
  const actionable = status === 'ready' && !locked;

  const [tentative, setTentative] = useState<string[]>([]);
  const selection = answered ? committed : tentative;

  const scope = useId();
  const questionId = `${scope}question`;
  const groupLabel = multiple ? labels.poll.multipleGroup : labels.poll.singleGroup;
  const labelledBy = payload.question === undefined ? undefined : questionId;
  const ariaLabel = payload.question === undefined ? groupLabel : undefined;

  const rootState: NereyState = locked
    ? 'locked'
    : status === 'error'
      ? 'error'
      : selection.length > 0
        ? 'selected'
        : 'idle';

  function choose(next: readonly string[]): void {
    // Re-checked rather than trusted to `readOnly`. A tentative highlight is free to move as
    // often as the user likes, but only while the poll is still open.
    if (!actionable) return;
    setTentative([...next]);
  }

  function submit(): void {
    if (!actionable) return;
    const first = tentative[0];
    if (first === undefined) return;

    const selected = selectionValue(tentative, multiple);

    // State first, reply second. `locked` is derived from the persisted value, so this call is
    // what closes the poll — doing it after `onInteraction` would leave the options live for the
    // width of a host handler that may well throw, which is exactly long enough for a second
    // click on an answer that has already been sent.
    setState({ selected });
    onInteraction(SUBMIT_ACTION, {
      text: replyFor(payload, tentative, { noneReply: labels.poll.noneReply }),
      meta: { selected },
    });
  }

  const rows = options.map((option) => (
    <OptionRow
      key={option.value}
      option={option}
      multiple={multiple}
      selected={selection.includes(option.value)}
      readOnly={locked}
    />
  ));

  const noneOption = payload.noneOption;
  const noneRow =
    noneOption === undefined ? null : (
      <WidgetPart
        part="none-option"
        state={selection.includes(noneOption.value) ? 'selected' : undefined}
        className={styles.noneRow}
      >
        {/*
        Set apart, and never given a description even if a producer invents one for it. "None of
        these" is not a thing to read more about; it is the exit from a list, and it reads as one
        only when it does not look like another entry in it.
      */}
        <label className={styles.optionLabel}>
          <OptionControl value={noneOption.value} multiple={multiple} readOnly={locked} />
          <span className={styles.optionTitle}>{noneOption.label}</span>
        </label>
      </WidgetPart>
    );

  return (
    <WidgetRoot
      type={POLL_TYPE}
      version={POLL_VERSION}
      slot={POLL_PLACEMENT.slot}
      status={status}
      state={rootState}
      readonly={readonly}
      className={styles.root}
    >
      {payload.question !== undefined && (
        <WidgetPart
          part="question"
          render={(partProps) => <p {...partProps} id={questionId} className={styles.question} />}
        >
          {payload.question}
        </WidgetPart>
      )}

      {multiple ? (
        /*
          Base UI supplies `role="group"` here and `role="radiogroup"` below, but it only fills in
          `aria-labelledby` from a surrounding `Field.Root` — which this widget does not use,
          because a poll's question is not a form label and a Field would put a second labelling
          relationship in play. So the name is written from here, and it is not optional: an
          unnamed group is announced as a container full of unrelated controls (ADR 0032).
        */
        <CheckboxGroup
          aria-labelledby={labelledBy}
          aria-label={ariaLabel}
          value={selection}
          onValueChange={choose}
          disabled={status !== 'ready'}
        >
          {rows}
          {noneRow}
        </CheckboxGroup>
      ) : (
        /*
          `readOnly` rather than `disabled` for the locked state. A disabled group drops out of the
          tab order, so the answer a user just gave becomes unreachable by keyboard; read-only
          keeps it focusable and announced, which is what a snapshot of an answered question is
          for (ADR 0018).
        */
        <RadioGroup
          aria-labelledby={labelledBy}
          aria-label={ariaLabel}
          value={selection[0] ?? NO_SELECTION}
          onValueChange={(value) => {
            choose([value]);
          }}
          readOnly={locked}
          disabled={status !== 'ready'}
        >
          {rows}
          {noneRow}
        </RadioGroup>
      )}

      <WidgetPart part="footer" className={styles.footer}>
        <Button size="sm" disabled={!actionable || selection.length === 0} onClick={submit}>
          {answered ? (
            <>
              <CheckIcon size={14} />
              {labels.poll.answered}
            </>
          ) : (
            labels.poll.submit
          )}
        </Button>
      </WidgetPart>

      {saveStatus === 'error' && (
        /*
          The one piece of chrome this widget grows for a failure it cannot fix. `role="status"`
          rather than `alert`: the answer went through, so this is a note about durability, not an
          interruption — and it appears after the fact, which is when a polite live region is read.
        */
        <WidgetPart
          part="notice"
          state="error"
          render={(partProps) => <p {...partProps} role="status" className={styles.notice} />}
        >
          {labels.poll.saveFailed}
        </WidgetPart>
      )}
    </WidgetRoot>
  );
}
