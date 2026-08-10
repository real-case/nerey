import { useId } from 'react';
import type { ReactElement } from 'react';

import type { NereyState } from '../../data-attrs';
import { WidgetPart } from '../../primitives/widget-part';
import { WidgetRoot } from '../../primitives/widget-root';
import { useWidgetState } from '../../state/use-widget-state';
import type { WidgetComponentProps } from '../../types';
import {
  CONFIRMATION_PLACEMENT,
  CONFIRMATION_TYPE,
  CONFIRMATION_VERSION,
  DEFAULT_CANCEL_LABEL,
  DEFAULT_CONFIRM_LABEL,
} from './schema';
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
 * ADR 0035 — the minimum interactive widget, and core's executable specification of its own
 * contracts: `onInteraction` as the only outbound channel (ADR 0014), `useWidgetState` as the only
 * persistence channel (ADR 0015 / 0016), `readonly` from the lifecycle runtime (ADR 0018), and the
 * `data-*` surface as the only styling seam (ADR 0020). It ships no CSS and no layout — two
 * buttons, a title, an optional description, and the attributes a consumer selects on.
 *
 * ARIA is written by hand, deliberately. ADR 0022 reverses the origin codebase's "never author
 * `aria-*`" convention: that rule made sense when a component library supplied the roles, and it is
 * actively harmful here, because nothing else is going to. A consumer cannot reach inside this
 * component to add a labelling relationship, so if the group is not named and described from here
 * it is not named and described at all, and the WCAG 2.2 AA gate (ADR 0032) would fail with no
 * legitimate way to pass.
 */
export function ConfirmationWidget(props: ConfirmationWidgetProps): ReactElement {
  const { messageId, payload, state, readonly, status, onInteraction } = props;

  /**
   * `debounceMs: 0` because a confirmation writes exactly once in its entire life. Debouncing
   * exists to coalesce a burst — a slider, a text field — and there is no burst here; all the
   * default window would buy is 400ms during which the decision is on screen, the reply is already
   * with the agent, and the store still says nothing happened.
   *
   * `state` is the already-validated, already-migrated envelope state (ADR 0011 / 0030); the hook
   * never reads, so this is the only hydration path. The `??` covers a host that mounts the widget
   * with nothing at all rather than with `{}` — cheaper than a crash inside render.
   */
  const { state: persisted, setState } = useWidgetState<ConfirmationState>(messageId, state ?? EMPTY_STATE, {
    debounceMs: 0,
  });

  const decision = persisted.decision;
  const decided = decision !== undefined;

  /**
   * The lock is committed the moment a decision exists, and nothing takes it back. A failed write
   * must not re-enable these buttons: the reply is already in the transcript, so a second press
   * would send the same answer twice and start a second model turn (FR-20, ADR 0016).
   */
  const locked = readonly || decided;

  // A payload that is still streaming is not a question yet, and one that arrived as an error is
  // not a question at all (ADR 0019). Neither is answerable, and both are still worth rendering —
  // the transcript stays legible either way.
  const actionable = status === 'ready' && !locked;

  /**
   * ADR 0035 describes an `idle → submitting → locked` progression. The middle step is deliberately
   * not rendered on the root: `locked` here means "this widget is closed", and that became true at
   * the click, not when the write settled. Deriving it from the write would make the closed state
   * of the widget depend on something that must never be able to reopen it. A consumer who wants a
   * saving hint has `status` from `useWidgetState` in their own widget; core's built-in does not
   * invent chrome for it.
   */
  const rootState: NereyState = locked ? 'locked' : status === 'error' ? 'error' : 'idle';

  const scope = useId();
  const titleId = `${scope}title`;
  const descriptionId = `${scope}description`;
  const describedBy = payload.description === undefined ? undefined : descriptionId;

  const confirmLabel = payload.confirmLabel ?? DEFAULT_CONFIRM_LABEL;
  const cancelLabel = payload.cancelLabel ?? DEFAULT_CANCEL_LABEL;

  // `payload.tone` is validated and deliberately not rendered. It is a presentation hint, the
  // ADR 0020 vocabulary has no attribute for one, and inventing `data-tone` here would quietly
  // extend a contract whose whole value is that it is fixed and enumerable. A confirmation that
  // must *look* dangerous is a design decision, and design decisions live in `@nerey/theme`
  // (ADR 0035) — where the tone is still on the payload, waiting to be read.

  function decide(action: ConfirmationAction, text: string): void {
    // Re-checked rather than trusted to `disabled`. `render` lets a consumer substitute the button
    // for their own component (ADR 0021), and a substitute that forgets `disabled` must still not
    // be able to send a second reply.
    if (!actionable) return;

    const value = DECISION_BY_ACTION[action];

    // State first, reply second. If the host's handler throws, the widget is already locked; a
    // widget left enabled by someone else's exception invites the press that duplicates a reply
    // the host may well have sent before it threw. Never answering twice outranks never getting
    // stuck (FR-20).
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
      // `render` rather than props on `WidgetRoot`: the primitive forwards a fixed prop list with
      // no `{...rest}` (ADR 0021), so ARIA that belongs to this widget alone is attached here
      // instead of widening every widget root with attributes most of them cannot fill in.
      render={(rootProps) => (
        <div {...rootProps} role="group" aria-labelledby={titleId} aria-describedby={describedBy} />
      )}
    >
      <WidgetPart part="title" render={(partProps) => <p {...partProps} id={titleId} />}>
        {payload.title}
      </WidgetPart>

      {payload.description !== undefined && (
        <WidgetPart part="description" render={(partProps) => <p {...partProps} id={descriptionId} />}>
          {payload.description}
        </WidgetPart>
      )}

      <WidgetPart
        part="confirm"
        state={decision === 'confirmed' ? 'selected' : undefined}
        render={(partProps) => (
          <button
            {...partProps}
            type="button"
            disabled={!actionable}
            onClick={() => {
              decide('confirm', confirmLabel);
            }}
          />
        )}
      >
        {confirmLabel}
      </WidgetPart>

      <WidgetPart
        part="cancel"
        state={decision === 'cancelled' ? 'selected' : undefined}
        render={(partProps) => (
          <button
            {...partProps}
            type="button"
            disabled={!actionable}
            onClick={() => {
              decide('cancel', cancelLabel);
            }}
          />
        )}
      >
        {cancelLabel}
      </WidgetPart>
    </WidgetRoot>
  );
}
