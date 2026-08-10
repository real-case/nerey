import { Dialog as Base } from '@base-ui/react/dialog';
import type { ReactElement, ReactNode, Ref } from 'react';

import { cx } from '../../internal/cx';
import { Button } from '../button/button';
import type { ButtonSize, ButtonTone, ButtonVariant } from '../button/button';
import { IconButton } from '../icon-button/icon-button';
import { CloseIcon } from '../icons/icons';
import styles from './dialog.module.css';

/**
 * A modal dialog, under Nerey's own namespace.
 *
 * ADR 0022 — Base UI is wrapped and never re-exported. Nothing below leaks a Base UI type into
 * a prop signature: `ComponentProps<typeof Base.Popup>` would compile, and would then make the
 * behavioural library part of Nerey's published API, so replacing it would be a major version
 * for every consumer instead of a patch for this package. Every prop here is declared.
 *
 * The anatomy stays compound rather than collapsing into a `<Dialog title=… footer=… />` with
 * fifteen props. A dialog's content is arbitrary — a form, a table, a nested widget — and the
 * flat version answers that with an escape hatch that is worse than the composition it
 * replaced.
 *
 * Two pieces of the Base UI anatomy are NOT parts here, on purpose:
 *
 *   - `Dialog.Viewport` is rendered by `Dialog.Popup`, which is why `Popup` is the part that
 *     takes `size`. Viewport WRAPS Popup (the opposite of Popover's, which sits inside it), it
 *     is the scroll container, and a consumer who omits it gets a dialog that silently cannot
 *     be scrolled to on a short window. That is not a design decision worth exposing.
 *   - the corner dismiss control is rendered by `Popup` too. `Dialog.Close` is the labelled
 *     action for the footer; the ✕ is what makes a modal escapable by pointer, and a dialog
 *     that forgot it is a dialog some users cannot leave.
 *
 * `Dialog.Portal` IS a part, because Base UI throws `<Dialog.Portal> is missing.` without one
 * and because `container` is a real host concern. `Dialog.Backdrop` belongs INSIDE it, as a
 * sibling of the popup.
 */

export type DialogSize = 'sm' | 'md' | 'lg' | 'fullscreen';

/** Used when a caller gives the corner dismiss control no label of its own. */
export const DEFAULT_DIALOG_DISMISS_LABEL = 'Close';

/**
 * A trigger and a close button are buttons, so they take Button's axes — unless the caller
 * substitutes an element, in which case they take none of them. The union makes the
 * contradiction unrepresentable instead of silently ignoring `variant` next to a `render` that
 * already decided how the control is painted (the same shape Separator uses for its label).
 */
type ButtonShapedProps =
  | { variant?: ButtonVariant; tone?: ButtonTone; size?: ButtonSize; render?: never }
  | {
      /** Substitute the whole control — an IconButton, a link, a card. */
      render: ReactElement;
      variant?: never;
      tone?: never;
      size?: never;
    };

const SIZE_CLASS: Record<DialogSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
  lg: styles.sizeLg,
  fullscreen: styles.sizeFullscreen,
};

/* ── Root ──────────────────────────────────────────────────────────────────────────── */

export type DialogRootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  /**
   * Narrower than Base UI's own handler, which also receives an event-details object carrying
   * the reason and a `cancel()`. Widening it later is a minor version; narrowing it back is
   * not, so the extra argument stays out until something needs it (ADR 0029).
   */
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

/**
 * Base UI's `modal` prop is deliberately not forwarded. `Dialog.Popup` renders the scroll
 * viewport, which is a full-window layer by construction, so a non-modal dialog here would be
 * a surface that promises not to block the page while covering every pixel of it. A panel that
 * accompanies the page rather than interrupting it is a Popover, and it is anchored, which is
 * what a non-modal surface actually needs to be.
 */
export function DialogRoot({ open, defaultOpen, onOpenChange, children }: DialogRootProps): ReactElement {
  // Wrapped rather than forwarded, so the one-parameter signature above is true at runtime as
  // well as in the types. Handing Base UI's handler straight through would give a JavaScript
  // consumer a second argument the declaration says they will not get, and taking it away
  // again later would break them (ADR 0029).
  const handleOpenChange = onOpenChange ? (nextOpen: boolean) => onOpenChange(nextOpen) : undefined;

  return (
    <Base.Root open={open} defaultOpen={defaultOpen} onOpenChange={handleOpenChange}>
      {children}
    </Base.Root>
  );
}

/* ── Trigger ───────────────────────────────────────────────────────────────────────── */

export type DialogTriggerProps = ButtonShapedProps & {
  disabled?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function DialogTrigger({
  variant,
  tone,
  size,
  render,
  disabled,
  children,
  ref,
}: DialogTriggerProps): ReactElement {
  // Base UI clones the element it is given and merges its own props into it — the open state,
  // `aria-haspopup`, `aria-expanded`, the id that ties the two together. Composing that way
  // round (Base UI outside, Button inside) is what keeps the accessibility wiring on the
  // element that is actually in the document.
  return (
    <Base.Trigger
      ref={ref}
      disabled={disabled}
      render={render ?? <Button variant={variant} tone={tone} size={size} />}
    >
      {children}
    </Base.Trigger>
  );
}

/* ── Portal and backdrop ───────────────────────────────────────────────────────────── */

export type DialogPortalProps = {
  /** Where the dialog is mounted. Defaults to `document.body`. */
  container?: HTMLElement | null;
  children?: ReactNode;
};

export function DialogPortal({ container, children }: DialogPortalProps): ReactElement {
  return <Base.Portal container={container}>{children}</Base.Portal>;
}

export type DialogBackdropProps = {
  ref?: Ref<HTMLDivElement>;
};

export function DialogBackdrop({ ref }: DialogBackdropProps): ReactElement {
  return <Base.Backdrop ref={ref} className={styles.backdrop} />;
}

/* ── Popup ─────────────────────────────────────────────────────────────────────────── */

export type DialogPopupProps = {
  size?: DialogSize;
  /**
   * Accessible name of the corner dismiss control. A prop rather than a constant because it
   * is user-visible text, and a theme that hard-codes English is a theme nobody can ship.
   */
  dismissLabel?: string;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

export function DialogPopup({
  size = 'md',
  dismissLabel = DEFAULT_DIALOG_DISMISS_LABEL,
  children,
  ref,
}: DialogPopupProps): ReactElement {
  return (
    <Base.Viewport className={cx(styles.viewport, size === 'fullscreen' && styles.viewportFullscreen)}>
      <Base.Popup ref={ref} className={cx(styles.popup, SIZE_CLASS[size])}>
        {/* Inside the popup, not beside it: with a focus trap running, a control outside the
            popup is a control a touch screen reader cannot reach, which would leave the
            dialog with no pointer escape at all. */}
        <div className={styles.dismiss}>
          <Base.Close
            render={
              <IconButton label={dismissLabel} size="sm">
                <CloseIcon />
              </IconButton>
            }
          />
        </div>
        {children}
      </Base.Popup>
    </Base.Viewport>
  );
}

/* ── Content parts ─────────────────────────────────────────────────────────────────── */

export type DialogTitleProps = {
  children?: ReactNode;
  ref?: Ref<HTMLHeadingElement>;
};

export function DialogTitle({ children, ref }: DialogTitleProps): ReactElement {
  // Base UI points the popup's `aria-labelledby` at whatever this renders, so the dialog's
  // accessible name comes from the visible heading rather than from a duplicated string that
  // can drift away from it.
  return (
    <Base.Title ref={ref} className={styles.title}>
      {children}
    </Base.Title>
  );
}

export type DialogDescriptionProps = {
  children?: ReactNode;
  ref?: Ref<HTMLParagraphElement>;
};

export function DialogDescription({ children, ref }: DialogDescriptionProps): ReactElement {
  return (
    <Base.Description ref={ref} className={styles.description}>
      {children}
    </Base.Description>
  );
}

export type DialogFooterProps = {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

export function DialogFooter({ children, ref }: DialogFooterProps): ReactElement {
  return (
    <div ref={ref} className={styles.footer}>
      {children}
    </div>
  );
}

/* ── Close ─────────────────────────────────────────────────────────────────────────── */

export type DialogCloseProps = ButtonShapedProps & {
  disabled?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function DialogClose({
  variant = 'outline',
  tone = 'neutral',
  size,
  render,
  disabled,
  children,
  ref,
}: DialogCloseProps): ReactElement {
  // `outline` / `neutral` rather than Button's `solid` / `accent`: the button that dismisses
  // is almost never the one the dialog is asking about, and a teal Cancel sitting next to the
  // real action is a misdirection the caller then has to undo at every call site.
  return (
    <Base.Close
      ref={ref}
      disabled={disabled}
      render={render ?? <Button variant={variant} tone={tone} size={size} />}
    >
      {children}
    </Base.Close>
  );
}

/**
 * The compound surface. Grouping the parts under one object is what makes the anatomy
 * readable at a call site — `Dialog.Title` says where the element belongs, `DialogTitle`
 * imported on its own does not.
 */
export const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
  Footer: DialogFooter,
};
