import { Popover as Base } from '@base-ui/react/popover';
import type { ReactElement, ReactNode, Ref } from 'react';

import { Button } from '../button/button';
import type { ButtonSize, ButtonTone, ButtonVariant } from '../button/button';
import styles from './popover.module.css';

/**
 * A surface anchored to the control that opened it, under Nerey's own namespace.
 *
 * ADR 0022 — Base UI is wrapped and never re-exported, and no prop below is typed through
 * `ComponentProps<typeof Base.X>`; that would put the behavioural library into Nerey's
 * published signature and make swapping it a breaking change for every consumer.
 *
 * The floating anatomy is Root → Portal → Positioner → Popup → (Arrow, content), and both
 * middle layers are parts rather than hidden, because they are two genuinely different jobs.
 * The Positioner is the box Floating UI moves and the only one that knows how much room is
 * left; the Popup is the box a reader sees. Base UI publishes its measurements as custom
 * properties on the POSITIONER — `--available-width`, `--available-height`,
 * `--transform-origin` — which reach the popup only by inheritance, so this theme puts every
 * constraint on the one and every stroke of paint on the other.
 *
 * `Portal` is a part because Base UI throws `<Popover.Portal> is missing.` without it.
 */

/** The four physical sides. Base UI also accepts logical ones; Nerey's arrow keys off these. */
export type PopoverSide = 'top' | 'right' | 'bottom' | 'left';
export type PopoverAlign = 'start' | 'center' | 'end';

/**
 * The gap between anchor and popup, and the distance the arrow is kept from the popup's
 * corners. Both are pixels because Floating UI positions in JavaScript and cannot read a custom
 * property — these are the only two lengths in the theme written as numbers, and they are the
 * pixel values of `--nerey-space-2` and `--nerey-space-4` at the default root font size.
 *
 * They are not props. Where a popup sits relative to its anchor is placement, which a caller
 * owns through `side` and `align`; how far it floats off the surface is paint, which ADR 0026
 * says the theme owns.
 */
const ANCHOR_GAP = 8;
const ARROW_PADDING = 16;

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

export type PopoverRootProps = {
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

export function PopoverRoot({ open, defaultOpen, onOpenChange, children }: PopoverRootProps): ReactElement {
  // Wrapped rather than forwarded, so the one-parameter signature above is true at runtime as
  // well as in the types.
  const handleOpenChange = onOpenChange ? (nextOpen: boolean) => onOpenChange(nextOpen) : undefined;

  return (
    <Base.Root open={open} defaultOpen={defaultOpen} onOpenChange={handleOpenChange}>
      {children}
    </Base.Root>
  );
}

/* ── Trigger ───────────────────────────────────────────────────────────────────────── */

export type PopoverTriggerProps = ButtonShapedProps & {
  /**
   * Open on hover as well as on press. This is the accessible way to build an info affordance:
   * unlike a tooltip it survives touch, it can be opened from the keyboard, and its content is
   * reachable by a screen reader.
   */
  openOnHover?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function PopoverTrigger({
  variant,
  tone,
  size,
  render,
  openOnHover,
  disabled,
  children,
  ref,
}: PopoverTriggerProps): ReactElement {
  // Base UI outside, Button inside: the library clones the element it is given and merges its
  // own props into it — the open state, `aria-haspopup`, `aria-expanded`, the id tying trigger
  // and popup together — so composing this way round keeps that wiring on the element that is
  // actually in the document.
  return (
    <Base.Trigger
      ref={ref}
      disabled={disabled}
      openOnHover={openOnHover}
      render={render ?? <Button variant={variant} tone={tone} size={size} />}
    >
      {children}
    </Base.Trigger>
  );
}

/* ── Portal ────────────────────────────────────────────────────────────────────────── */

export type PopoverPortalProps = {
  /** Where the popover is mounted. Defaults to `document.body`. */
  container?: HTMLElement | null;
  children?: ReactNode;
};

export function PopoverPortal({ container, children }: PopoverPortalProps): ReactElement {
  return <Base.Portal container={container}>{children}</Base.Portal>;
}

/* ── Positioner ────────────────────────────────────────────────────────────────────── */

export type PopoverPositionerProps = {
  /** Preferred side of the anchor. Base UI flips it when there is not enough room. */
  side?: PopoverSide;
  align?: PopoverAlign;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

export function PopoverPositioner({
  side = 'bottom',
  align = 'center',
  children,
  ref,
}: PopoverPositionerProps): ReactElement {
  return (
    <Base.Positioner
      ref={ref}
      className={styles.positioner}
      side={side}
      align={align}
      sideOffset={ANCHOR_GAP}
      arrowPadding={ARROW_PADDING}
    >
      {children}
    </Base.Positioner>
  );
}

/* ── Popup ─────────────────────────────────────────────────────────────────────────── */

export type PopoverPopupProps = {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

export function PopoverPopup({ children, ref }: PopoverPopupProps): ReactElement {
  return (
    <Base.Popup ref={ref} className={styles.popup}>
      {children}
    </Base.Popup>
  );
}

export type PopoverArrowProps = {
  ref?: Ref<HTMLDivElement>;
};

export function PopoverArrow({ ref }: PopoverArrowProps): ReactElement {
  // Base UI marks the arrow `aria-hidden` for us — it is a pointer at a relationship the
  // accessibility tree already describes through `aria-controls` on the trigger.
  return <Base.Arrow ref={ref} className={styles.arrow} />;
}

/* ── Content parts ─────────────────────────────────────────────────────────────────── */

export type PopoverTitleProps = {
  children?: ReactNode;
  ref?: Ref<HTMLHeadingElement>;
};

export function PopoverTitle({ children, ref }: PopoverTitleProps): ReactElement {
  // Base UI points the popup's `aria-labelledby` at whatever this renders, so a popover with a
  // title is announced by that title instead of as an anonymous group of text.
  return (
    <Base.Title ref={ref} className={styles.title}>
      {children}
    </Base.Title>
  );
}

export type PopoverDescriptionProps = {
  children?: ReactNode;
  ref?: Ref<HTMLParagraphElement>;
};

export function PopoverDescription({ children, ref }: PopoverDescriptionProps): ReactElement {
  return (
    <Base.Description ref={ref} className={styles.description}>
      {children}
    </Base.Description>
  );
}

/* ── Close ─────────────────────────────────────────────────────────────────────────── */

export type PopoverCloseProps = ButtonShapedProps & {
  disabled?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function PopoverClose({
  variant = 'ghost',
  tone = 'neutral',
  size = 'sm',
  render,
  disabled,
  children,
  ref,
}: PopoverCloseProps): ReactElement {
  // Quieter than Dialog's close by default. A popover already closes on Escape and on an
  // outside press, so its explicit close is a convenience rather than the way out, and a
  // heavier button would out-rank the content it sits under.
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
 * The compound surface. `Popover.Positioner` says where the element belongs in a way that
 * `PopoverPositioner` imported on its own does not.
 */
export const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Portal: PopoverPortal,
  Positioner: PopoverPositioner,
  Popup: PopoverPopup,
  Arrow: PopoverArrow,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: PopoverClose,
};
