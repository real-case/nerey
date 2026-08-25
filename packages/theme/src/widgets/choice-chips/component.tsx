import { useState } from 'react';
import type { ReactElement } from 'react';

import { WidgetPart, WidgetRoot, useWidgetState } from '@nerey/core';
import type { NereyState, WidgetComponentProps } from '@nerey/core';

import { Button } from '../../components/button/button';
import { CheckIcon } from '../../components/icons/icons';
import { Toggle, ToggleGroup } from '../../components/toggle-group/toggle-group';
import { useNereyLabels } from '../../labels/labels';
import styles from './choice-chips.module.css';
import {
  CHOICE_CHIPS_PLACEMENT,
  CHOICE_CHIPS_TYPE,
  CHOICE_CHIPS_VERSION,
  EMPTY_CHOICE_CHIPS_STATE,
  replyFor,
  selectionValue,
} from './schema';
import type { ChoiceChipsPayload, ChoiceChipsState } from './schema';

export type ChoiceChipsWidgetProps = WidgetComponentProps<ChoiceChipsPayload, ChoiceChipsState>;

/** The single action this widget reports. `{ on: 'interact' }` catches it either way. */
const REPLY_ACTION = 'reply';

function toArray(selected: string | string[] | undefined): string[] {
  if (selected === undefined) return [];
  return typeof selected === 'string' ? [selected] : [...selected];
}

/**
 * Quick replies: the choices the assistant offers so the user does not have to type an answer it
 * already knows the shape of.
 *
 * The interesting decision is that single-select **sends on the first press**, with no Submit
 * button — which is the exact opposite of the poll's two-step commit, deliberately. A quick reply
 * is a one-word answer to a question the user has already read; making them press a chip and then
 * a button turns the thing that exists to save a keystroke into two of them. The poll defers
 * because its options are records that need comparing and a mis-pick is expensive; a chip row is
 * "Yes" / "No" / "Show me the others", where the press IS the decision.
 *
 * Multi-select does get a Send button, for the reason the poll has one: there is no press that
 * means "and that is my final answer", so without a button the widget would have to guess when the
 * user had finished choosing.
 */
export function ChoiceChipsWidget(props: ChoiceChipsWidgetProps): ReactElement {
  const { messageId, payload, state, readonly, status, onInteraction } = props;
  const labels = useNereyLabels();

  /**
   * `debounceMs: 0` — a chip row writes exactly once in its life. The default 400ms window would
   * only buy an interval during which the reply is with the agent and the store still says nothing
   * happened.
   */
  const {
    state: persisted,
    setState,
    status: saveStatus,
  } = useWidgetState<ChoiceChipsState>(messageId, state ?? EMPTY_CHOICE_CHIPS_STATE, { debounceMs: 0 });

  /**
   * While streaming, the payload is partial and deliberately unvalidated (ADR 0019), so the
   * declared type describes the terminal state rather than this render. Reaching straight for
   * `.map` would throw a half-streamed row into the error boundary.
   */
  const choices = payload.choices ?? [];
  const multiple = payload.multiple === true;

  const committed = toArray(persisted.selected);
  const answered = committed.length > 0;

  // Committed the moment a reply exists, and nothing takes it back — including a failed write
  // (ADR 0016). The reply is already in the transcript; a re-enabled row invites a duplicate.
  const locked = readonly || answered;
  const actionable = status === 'ready' && !locked;

  const [tentative, setTentative] = useState<string[]>([]);
  const selection = answered ? committed : tentative;

  const rootState: NereyState = locked
    ? 'locked'
    : status === 'error'
      ? 'error'
      : selection.length > 0
        ? 'selected'
        : 'idle';

  function reply(values: readonly string[]): void {
    if (!actionable) return;
    const first = values[0];
    if (first === undefined) return;

    const selected = selectionValue(values, multiple);

    // State first, reply second. `locked` derives from the persisted value, so this call is what
    // closes the row; doing it after `onInteraction` would leave the chips live for the width of a
    // host handler that may throw — long enough for a second press on an answer already sent.
    setState({ selected });
    onInteraction(REPLY_ACTION, { text: replyFor(payload, values), meta: { selected } });
  }

  function change(next: readonly string[]): void {
    // Re-checked rather than trusted to `disabled`, because `disabled` is a prop and this is the
    // only guard that survives someone substituting the control.
    if (!actionable) return;

    if (multiple) {
      setTentative([...next]);
      return;
    }

    // Base UI clears the group when the pressed chip is pressed again. There is nothing to reply
    // with, and a quick reply has no "unsay it", so a deselect is ignored rather than sent as an
    // empty message.
    const value = next[0];
    if (value === undefined) return;
    reply([value]);
  }

  const groupLabel = multiple ? labels.choiceChips.multipleGroup : labels.choiceChips.singleGroup;

  return (
    <WidgetRoot
      type={CHOICE_CHIPS_TYPE}
      version={CHOICE_CHIPS_VERSION}
      slot={CHOICE_CHIPS_PLACEMENT.slot}
      status={status}
      state={rootState}
      readonly={readonly}
      className={styles.root}
    >
      {payload.prompt !== undefined && (
        <WidgetPart part="prompt" render={(partProps) => <p {...partProps} className={styles.prompt} />}>
          {payload.prompt}
        </WidgetPart>
      )}

      <WidgetPart part="choices" className={styles.choices}>
        {/*
          `variant="chips"` rather than `segmented`, and the two are not interchangeable. A joined
          bar cannot wrap, and a quick-reply row in a narrow transcript column wraps by the third
          choice. `label` is required by the component precisely so this cannot be forgotten: the
          prompt when there is one, a generic name when there is not, but never nothing.
        */}
        <ToggleGroup
          label={payload.prompt ?? groupLabel}
          variant="chips"
          size="sm"
          multiple={multiple}
          value={selection}
          onValueChange={change}
          disabled={locked || status !== 'ready'}
        >
          {choices.map((choice) => (
            <Toggle key={choice.value} value={choice.value}>
              {choice.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </WidgetPart>

      {multiple && (
        <WidgetPart part="footer" className={styles.footer}>
          <Button
            size="sm"
            disabled={!actionable || selection.length === 0}
            onClick={() => {
              reply(selection);
            }}
          >
            {answered ? (
              <>
                <CheckIcon size={14} />
                {labels.choiceChips.sent}
              </>
            ) : (
              labels.choiceChips.send
            )}
          </Button>
        </WidgetPart>
      )}

      {saveStatus === 'error' && (
        /*
          `role="status"` rather than `alert`: the reply went through, so this is a note about
          durability and not an interruption — and it appears after the fact, which is when a
          polite live region is read out.
        */
        <WidgetPart
          part="notice"
          state="error"
          render={(partProps) => <p {...partProps} role="status" className={styles.notice} />}
        >
          {labels.choiceChips.saveFailed}
        </WidgetPart>
      )}
    </WidgetRoot>
  );
}
