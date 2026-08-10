import { useMemo } from 'react';
import type { ReactElement } from 'react';

import { WidgetPart, WidgetRoot } from '@nerey/core';
import type { NereyState, WidgetComponentProps } from '@nerey/core';

import { AlertCircleIcon, CheckIcon, DotsHorizontalIcon, SpinnerArcIcon } from '../../components/icons/icons';
import { Progress } from '../../components/progress/progress';
import { Spinner } from '../../components/spinner/spinner';
import { cx } from '../../internal/cx';
import {
  DEFAULT_PROGRESS_LABEL,
  DEFAULT_RUNNING_LABEL,
  DEFAULT_STEPS_LABEL,
  PROGRESS_TRACKER_PLACEMENT,
  PROGRESS_TRACKER_TYPE,
  PROGRESS_TRACKER_VERSION,
  announcement,
  clampPercent,
  clampStep,
  readSteps,
  stepStateAt,
} from './schema';
import type { ProgressTrackerPayload, ProgressTrackerState, StepState } from './schema';
import styles from './progress-tracker.module.css';

export type ProgressTrackerWidgetProps = WidgetComponentProps<ProgressTrackerPayload, ProgressTrackerState>;

/**
 * A linear multi-step operation: one bar, one sentence, one list.
 *
 * ## Why the announcement is `polite` and never `assertive`
 *
 * `assertive` empties the screen reader's queue and interrupts whatever is being spoken — including
 * the sentence the user is halfway through. A tracker fires on every step, so an assertive region
 * would interrupt the reader once per step for the whole length of the operation, and the thing it
 * interrupts is usually the agent's own answer. Progress is not an emergency: nothing is lost by
 * hearing "step 3 of 5" a few seconds late, and a great deal is lost by never hearing the end of a
 * sentence. `assertive` is for content that invalidates what the user is currently doing — a
 * session about to expire, a destructive action that already happened. This is neither.
 *
 * The failure case does NOT promote to assertive either. A failed step is announced politely and
 * shown loudly: the bar turns, the step gets an alert glyph, and the sentence says "failed". A
 * screen-reader user is not served by having their place taken away; they are served by the failure
 * still being there when they arrive at it.
 *
 * ## What it does not do
 *
 * It sends nothing and it stores nothing. A tracker reports on work that is already happening, and
 * the only widget button anyone would want on it — "cancel" — is a capability the payload cannot
 * describe and the host has no way to honour (ADR 0014 / 0015).
 */

const STEP_CLASS: Record<StepState, string | undefined> = {
  done: styles.stepDone,
  current: styles.stepCurrent,
  pending: undefined,
  failed: styles.stepFailed,
};

/** The glyph size that sits level with `--nerey-font-size-md` text without dominating the row. */
const MARKER_SIZE = 14;

type StepMarkerProps = { state: StepState; frozen: boolean };

/**
 * `frozen` is the read-only case, and it is what `SpinnerArcIcon` is in the icon set for. A replay
 * of a tracker that keeps spinning asserts that work is happening right now — a claim the replay
 * cannot possibly support. The static arc says "this was in progress" and stops there.
 */
function StepMarker({ state, frozen }: StepMarkerProps): ReactElement {
  if (state === 'done') return <CheckIcon size={MARKER_SIZE} />;
  if (state === 'failed') return <AlertCircleIcon size={MARKER_SIZE} />;
  if (state === 'pending') return <DotsHorizontalIcon size={MARKER_SIZE} />;
  return frozen ? (
    <SpinnerArcIcon size={MARKER_SIZE} />
  ) : (
    // The label never reaches anyone — the marker slot around this is `aria-hidden`, because the
    // live region above already says which step is running and a `role="status"` per step would
    // announce the same fact once more per step. It is passed anyway, so that removing the wrapper
    // some day produces a named spinner rather than a silent one.
    <Spinner size="sm" label={DEFAULT_RUNNING_LABEL} />
  );
}

export function ProgressTrackerWidget(props: ProgressTrackerWidgetProps): ReactElement {
  const { payload, readonly, status } = props;

  // `payload?.` rather than `payload.`: while streaming the value has been through no schema at all
  // (ADR 0019), so the declared type is a promise about the finished object, not about this render.
  const steps = useMemo(() => readSteps(payload?.steps), [payload]);
  const total = steps.length;

  const failed = status === 'error';
  const current = clampStep(payload?.currentStep, total);
  const complete = !failed && total > 0 && current >= total;

  /**
   * Indeterminate while the plan is still arriving, whatever `determinate` says. A denominator that
   * is still growing makes every percentage a lie that has to be taken back: the bar would read 60%
   * of three steps and then slide down to 30% when the other three turned up. A bar that admits it
   * does not know the total is more useful than one that guesses and revises.
   */
  const indeterminate = status === 'streaming' || payload?.determinate === false || total === 0;

  // `Math.max(current, 0)` because `-1` means queued, and a queued operation is 0% done rather
  // than -20% done. `total` is non-zero on this branch: `total === 0` forces `indeterminate`.
  const finished = Math.max(current, 0);
  const percent = clampPercent(payload?.percent);
  const value = indeterminate ? null : (percent ?? Math.round((finished / total) * 100));

  const label = payload?.label ?? DEFAULT_PROGRESS_LABEL;
  const tone = failed ? 'danger' : complete ? 'success' : 'accent';

  const sentence = announcement({ steps, current, failed, streaming: status === 'streaming' });

  /**
   * `error` for a failed run, `locked` for one the host has closed. Note that "complete" is NOT a
   * state here: the ADR 0020 vocabulary has no value for it, and `locked` would be a lie — a
   * finished operation was never disabled, it just ran out of work.
   */
  const rootState: NereyState = failed ? 'error' : readonly ? 'locked' : 'idle';

  return (
    <WidgetRoot
      type={PROGRESS_TRACKER_TYPE}
      version={PROGRESS_TRACKER_VERSION}
      slot={PROGRESS_TRACKER_PLACEMENT.slot}
      status={status}
      state={rootState}
      readonly={readonly}
      className={styles.root}
      /*
       * `WidgetRoot` forwards a fixed prop list with no `{...rest}` (ADR 0021), so ARIA that belongs
       * to this widget alone is attached here. `role="group"` on a `<div>` rather than a named
       * `<section>`: a widget dropped into someone else's transcript must not add a landmark to a
       * page whose structure it cannot see.
       */
      render={(rootProps) => <div {...rootProps} role="group" aria-label={label} />}
    >
      <WidgetPart part="progress">
        <Progress.Root value={value} label={label} tone={tone}>
          <Progress.Label>{label}</Progress.Label>
          {/*
           * The caption counts steps rather than repeating the bar as a percentage. The bar already
           * IS the percentage — including the `percent` override, which is what moves the fill —
           * and "3 of 5" answers the question a stepped operation actually raises.
           */}
          <Progress.Value>
            {() => (total > 0 ? `${Math.min(finished, total)} of ${total}` : null)}
          </Progress.Value>
          <Progress.Track>
            <Progress.Indicator />
          </Progress.Track>
        </Progress.Root>
      </WidgetPart>

      <WidgetPart
        part="announcement"
        className={cx(styles.announcement, failed && styles.announcementDanger)}
        /*
         * `role="status"` already implies `aria-live="polite"`; both are written because the role
         * carries the semantics for assistive technology that maps roles, and the explicit
         * attribute is what a reader of this file sees. `aria-atomic` makes the whole sentence the
         * announcement — without it, a change from "Step 2 of 5" to "Step 3 of 5" can be read out
         * as the single word that differs.
         */
        render={(partProps) => <p {...partProps} role="status" aria-live="polite" aria-atomic="true" />}
      >
        {sentence}
      </WidgetPart>

      {total > 0 && (
        <WidgetPart
          part="steps"
          className={styles.steps}
          /*
           * `role="list"` is redundant with `<ol>` — until the stylesheet sets `list-style: none`,
           * which is when Safari drops the list semantics and VoiceOver stops announcing "list, 5
           * items". Stating the role keeps the count, which is the part of a step list that carries
           * the most information per word.
           */
          render={(partProps) => <ol {...partProps} role="list" aria-label={DEFAULT_STEPS_LABEL} />}
        >
          {steps.map((step, index) => {
            const state = complete ? 'done' : stepStateAt(index, current, failed);
            return (
              <WidgetPart
                key={step.id}
                part="step"
                state={state === 'failed' ? 'error' : undefined}
                className={cx(styles.step, STEP_CLASS[state])}
                /*
                 * `aria-current="step"` is how a screen reader is told which row is the one in
                 * progress. It is set on the failed step too: a run that stopped there is still
                 * "where we are", and moving the marker off it would leave the list with no
                 * current row at the exact moment the reader is looking for one.
                 */
                render={(partProps) => (
                  <li
                    {...partProps}
                    aria-current={state === 'current' || state === 'failed' ? 'step' : undefined}
                  />
                )}
              >
                <span className={styles.marker} aria-hidden="true">
                  <StepMarker state={state} frozen={readonly} />
                </span>
                <span className={styles.stepLabel}>{step.label}</span>
              </WidgetPart>
            );
          })}
        </WidgetPart>
      )}

      {total === 0 && status !== 'streaming' && (
        <WidgetPart part="empty" as="p" className={styles.empty}>
          This operation reported no steps.
        </WidgetPart>
      )}
    </WidgetRoot>
  );
}
