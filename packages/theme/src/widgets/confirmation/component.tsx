import { useId } from 'react';
import type { ReactElement } from 'react';

import {
  CONFIRMATION_PLACEMENT,
  CONFIRMATION_TYPE,
  CONFIRMATION_VERSION,
  DEFAULT_CANCEL_LABEL,
  DEFAULT_CONFIRM_LABEL,
  WidgetPart,
  WidgetRoot,
  useWidgetState,
} from '@nerey/core';
import type { NereyState, WidgetComponentProps } from '@nerey/core';

import { Button } from '../../components/button/button';
import { AlertTriangleIcon } from '../../components/icons/icons';
import { Stack } from '../../components/stack/stack';
import { Surface } from '../../components/surface/surface';
import { Text } from '../../components/text/text';
import { cx } from '../../internal/cx';
import styles from './confirmation.module.css';
import type { ConfirmationDecision, ConfirmationPayload, ConfirmationState } from './schema';

export type ConfirmationWidgetProps = WidgetComponentProps<ConfirmationPayload, ConfirmationState>;

/** The two actions this widget can report, and the decision each one records. */
const DECISION_BY_ACTION = {
  confirm: 'confirmed',
  cancel: 'cancelled',
} as const satisfies Record<string, ConfirmationDecision>;

type ConfirmationAction = keyof typeof DECISION_BY_ACTION;

/**
 * Shared and frozen. A fresh `{}` per render would be a new `initial` identity for
 * `useWidgetState` on every pass, and freezing turns a widget that mutates its own state object
 * into a loud failure here rather than a silent divergence from what the port stored.
 */
const EMPTY_STATE: ConfirmationState = Object.freeze({});

/**
 * The styled `confirmation@1.0.0` — core's headless built-in with the theme's paint on it
 * (ADR 0035). The behaviour is deliberately identical, because the two entries share a key: a
 * consumer who swaps the theme in must get the same answers sent, the same state persisted and
 * the same transcript on replay, differing only in how it looks.
 *
 * What the theme adds is what core had no standing to decide. `tone: 'danger'` becomes a red
 * confirm button, a warning glyph and a red panel edge; the panel is a `Surface`; the buttons are
 * `Button`s; the actions read left-to-right as cancel-then-confirm, which is the convention on
 * the web and puts the destructive choice where a pointer is least likely to land on it by
 * accident. DOM order and visual order match, so keyboard order is that order too.
 *
 * ARIA is hand-written, as it is in core (ADR 0022 reverses the origin repo's "never author
 * `aria-*`" rule). Nothing else is going to name this group: a consumer cannot reach inside the
 * component to add the labelling relationship, so if it is not established here the widget ships
 * an unnamed `role="group"` and the WCAG 2.2 AA gate fails with no legitimate way to pass.
 */
export function ConfirmationWidget(props: ConfirmationWidgetProps): ReactElement {
  const { messageId, payload, state, readonly, status, onInteraction } = props;

  /**
   * `debounceMs: 0` because a confirmation writes exactly once in its entire life. Debouncing
   * coalesces a burst — a slider, a text field — and there is no burst here; all the default
   * window would buy is 400ms during which the decision is on screen, the reply is already with
   * the agent, and the store still says nothing happened.
   */
  const { state: persisted, setState } = useWidgetState<ConfirmationState>(messageId, state ?? EMPTY_STATE, {
    debounceMs: 0,
  });

  const decision = persisted.decision;
  const decided = decision !== undefined;

  /**
   * Committed the moment a decision exists, and nothing takes it back. A failed write must not
   * re-enable these buttons: the reply is already in the transcript, so a second press would send
   * the same answer twice and start a second model turn (FR-20, ADR 0016).
   */
  const locked = readonly || decided;

  // A payload that is still streaming is not a question yet, and one that arrived as an error is
  // not a question at all (ADR 0019). Neither is answerable, and both are still worth rendering.
  const actionable = status === 'ready' && !locked;

  const rootState: NereyState = locked ? 'locked' : status === 'error' ? 'error' : 'idle';

  const scope = useId();
  const titleId = `${scope}title`;
  const descriptionId = `${scope}description`;
  const describedBy = payload.description === undefined ? undefined : descriptionId;

  const confirmLabel = payload.confirmLabel ?? DEFAULT_CONFIRM_LABEL;
  const cancelLabel = payload.cancelLabel ?? DEFAULT_CANCEL_LABEL;
  const danger = payload.tone === 'danger';

  function decide(action: ConfirmationAction, text: string): void {
    // Re-checked rather than trusted to `disabled`. `render` lets a caller substitute the button
    // (ADR 0021), and a substitute that forgets `disabled` must still not send a second reply.
    if (!actionable) return;

    const value = DECISION_BY_ACTION[action];

    // State first, reply second. If the host's handler throws, the widget is already locked; a
    // widget left enabled by someone else's exception invites the press that duplicates a reply
    // the host may well have sent before it threw (FR-20).
    //
    // The text is the button's own label, because that is what the user "said" — the agent reads
    // this as user input, and `Archive` is a thing a person types where `{"decision":1}` is not.
    setState({ decision: value });
    onInteraction(action, { text, meta: { decision: value } });
  }

  return (
    <WidgetRoot
      type={CONFIRMATION_TYPE}
      version={CONFIRMATION_VERSION}
      slot={CONFIRMATION_PLACEMENT.slot}
      status={status}
      state={rootState}
      readonly={readonly}
      // `className` on a core primitive is the sanctioned path (ADR 0021): core ships no CSS, so
      // there is nothing here for the theme's class to fight with. The opposite rule governs the
      // components below, which is why none of them takes one (ADR 0026).
      className={cx(styles.root, danger && styles.toneDanger)}
      // The function form composes rather than substitutes: the widget root IS the panel, so the
      // attributes, the Surface's paint and this widget's ARIA all land on one element. Nesting a
      // Surface inside instead would leave the node a consumer selects — the one carrying
      // `data-nerey-widget` — as an unstyled box wrapped around the visible one.
      render={(rootProps) => (
        <Surface
          variant="raised"
          padding="md"
          radius="lg"
          render={
            <div {...rootProps} role="group" aria-labelledby={titleId} aria-describedby={describedBy} />
          }
        />
      )}
    >
      <Stack gap={3}>
        <Stack direction="row" gap={2} align="start">
          {/* Decorative and additive: the glyph repeats what the danger tone already says through
              the confirm button's colour, so it is never the only carrier of that meaning. The
              span exists because Icons take no className (ADR 0026) and the colour belongs to
              this widget's tone, not to the glyph. */}
          {danger && (
            <span className={styles.icon}>
              <AlertTriangleIcon />
            </span>
          )}

          <Stack gap={1}>
            <WidgetPart part="title" render={<Text as="p" size="lg" weight="semibold" id={titleId} />}>
              {payload.title}
            </WidgetPart>

            {payload.description !== undefined && (
              <WidgetPart part="description" render={<Text as="p" tone="secondary" id={descriptionId} />}>
                {payload.description}
              </WidgetPart>
            )}
          </Stack>
        </Stack>

        {/* `wrap` because the two labels are model-authored: "Keep the original file" next to
            "Replace it permanently" overflows a narrow transcript, and a button row that pushes
            its container wide is worse than one that takes two lines. */}
        <WidgetPart part="actions" render={<Stack direction="row" gap={2} justify="end" wrap />}>
          <WidgetPart
            part="cancel"
            state={decision === 'cancelled' ? 'selected' : undefined}
            render={
              <Button
                variant="outline"
                tone="neutral"
                disabled={!actionable}
                onClick={() => {
                  decide('cancel', cancelLabel);
                }}
              />
            }
          >
            {cancelLabel}
          </WidgetPart>

          <WidgetPart
            part="confirm"
            state={decision === 'confirmed' ? 'selected' : undefined}
            render={
              <Button
                variant="solid"
                tone={danger ? 'danger' : 'accent'}
                disabled={!actionable}
                onClick={() => {
                  decide('confirm', confirmLabel);
                }}
              />
            }
          >
            {confirmLabel}
          </WidgetPart>
        </WidgetPart>
      </Stack>
    </WidgetRoot>
  );
}
