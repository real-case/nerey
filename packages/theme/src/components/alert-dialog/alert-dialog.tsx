import { AlertDialog as Base } from '@base-ui/react/alert-dialog';
import type { ReactElement, ReactNode, Ref } from 'react';

import { cx } from '../../internal/cx';
import { Button } from '../button/button';
import type { ButtonSize, ButtonTone, ButtonVariant } from '../button/button';
import styles from './alert-dialog.module.css';

/**
 * A confirmation the reader has to answer, under Nerey's own namespace.
 *
 * ADR 0022 — Base UI is wrapped and never re-exported, and no prop below is typed through
 * `ComponentProps<typeof Base.X>`: doing that would put the behavioural library in Nerey's
 * published signature and make replacing it a breaking change for every consumer.
 *
 * The anatomy is Dialog's, and the differences are the whole component:
 *
 *   - an outside press does NOT dismiss it. That is not a prop here because Base UI's alert
 *     dialog has no prop for it either — it is always modal and always pointer-undismissable,
 *     which is what separates "are you sure you want to delete this" from "here is some
 *     information".
 *   - there is no corner ✕. A dialog needs an escape that costs nothing; an alert dialog is
 *     asking a question whose answers are both in the footer, and a third, unlabelled way out
 *     invites people to take it without reading either one.
 *   - `tone` exists, and belongs on `Popup`, where the paint is.
 *
 * Escape still closes it. That is deliberate and matches the platform: Escape is the keyboard's
 * only exit from a focus trap, and a surface that swallows it is a surface that traps.
 */

export type AlertDialogTone = 'default' | 'danger';

/**
 * A trigger and a close button are buttons, so they take Button's axes — unless the caller
 * substitutes an element, in which case they take none of them. The union makes the
 * contradiction unrepresentable rather than silently ignoring `variant` next to a `render`
 * that has already decided how the control is painted.
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

/* ── Root ──────────────────────────────────────────────────────────────────────────── */

export type AlertDialogRootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  /**
   * Narrower than Base UI's own handler, which also receives an event-details object carrying
   * the reason and a `cancel()`. Widening it later is a minor version; narrowing it back is
   * not (ADR 0029).
   */
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

export function AlertDialogRoot({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: AlertDialogRootProps): ReactElement {
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

export type AlertDialogTriggerProps = ButtonShapedProps & {
  disabled?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function AlertDialogTrigger({
  variant,
  tone,
  size,
  render,
  disabled,
  children,
  ref,
}: AlertDialogTriggerProps): ReactElement {
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

export type AlertDialogPortalProps = {
  /** Where the alert dialog is mounted. Defaults to `document.body`. */
  container?: HTMLElement | null;
  children?: ReactNode;
};

export function AlertDialogPortal({ container, children }: AlertDialogPortalProps): ReactElement {
  return <Base.Portal container={container}>{children}</Base.Portal>;
}

export type AlertDialogBackdropProps = {
  ref?: Ref<HTMLDivElement>;
};

export function AlertDialogBackdrop({ ref }: AlertDialogBackdropProps): ReactElement {
  return <Base.Backdrop ref={ref} className={styles.backdrop} />;
}

/* ── Popup ─────────────────────────────────────────────────────────────────────────── */

export type AlertDialogPopupProps = {
  tone?: AlertDialogTone;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

export function AlertDialogPopup({ tone = 'default', children, ref }: AlertDialogPopupProps): ReactElement {
  // The viewport is rendered here rather than exposed as a part: it WRAPS the popup (the
  // opposite of Popover's, which sits inside it) and it is the scroll container, so a consumer
  // who left it out would get a confirmation that cannot be scrolled to on a short window.
  return (
    <Base.Viewport className={styles.viewport}>
      <Base.Popup ref={ref} className={cx(styles.popup, tone === 'danger' && styles.toneDanger)}>
        {children}
      </Base.Popup>
    </Base.Viewport>
  );
}

/* ── Content parts ─────────────────────────────────────────────────────────────────── */

export type AlertDialogTitleProps = {
  children?: ReactNode;
  ref?: Ref<HTMLHeadingElement>;
};

export function AlertDialogTitle({ children, ref }: AlertDialogTitleProps): ReactElement {
  // Base UI points the popup's `aria-labelledby` here, so the question the reader is being
  // asked and the name the popup is announced with are the same string by construction.
  return (
    <Base.Title ref={ref} className={styles.title}>
      {children}
    </Base.Title>
  );
}

export type AlertDialogDescriptionProps = {
  children?: ReactNode;
  ref?: Ref<HTMLParagraphElement>;
};

export function AlertDialogDescription({ children, ref }: AlertDialogDescriptionProps): ReactElement {
  return (
    <Base.Description ref={ref} className={styles.description}>
      {children}
    </Base.Description>
  );
}

export type AlertDialogFooterProps = {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

export function AlertDialogFooter({ children, ref }: AlertDialogFooterProps): ReactElement {
  return (
    <div ref={ref} className={styles.footer}>
      {children}
    </div>
  );
}

/* ── Close ─────────────────────────────────────────────────────────────────────────── */

export type AlertDialogCloseProps = ButtonShapedProps & {
  disabled?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function AlertDialogClose({
  variant = 'outline',
  tone = 'neutral',
  size,
  render,
  disabled,
  children,
  ref,
}: AlertDialogCloseProps): ReactElement {
  // Both answers are Close — the destructive one closes the dialog too, and hanging the
  // action off `onClick` next to it keeps the two buttons the same kind of thing. Defaulting
  // to `outline` / `neutral` means the caller only has to say which one is the dangerous one.
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
 * The compound surface. `AlertDialog.Title` says where the element belongs in a way that
 * `AlertDialogTitle` imported on its own does not.
 */
export const AlertDialog = {
  Root: AlertDialogRoot,
  Trigger: AlertDialogTrigger,
  Portal: AlertDialogPortal,
  Backdrop: AlertDialogBackdrop,
  Popup: AlertDialogPopup,
  Title: AlertDialogTitle,
  Description: AlertDialogDescription,
  Close: AlertDialogClose,
  Footer: AlertDialogFooter,
};
