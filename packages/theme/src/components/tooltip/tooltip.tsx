import { Tooltip as Base } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode, Ref } from 'react';

import { Button } from '../button/button';
import type { ButtonSize, ButtonTone, ButtonVariant } from '../button/button';
import styles from './tooltip.module.css';

/**
 * A label that appears on hover or keyboard focus, under Nerey's own namespace.
 *
 * ═══ A tooltip must never be the only source of an accessible name. ═══
 *
 * This is not general advice, it is a property of what is shipped. Base UI 1.7.0 gives the
 * tooltip popup no `role="tooltip"` and wires no `aria-describedby` from the trigger to it —
 * verified in the published source, not inferred from the docs — and it suppresses tooltips
 * entirely on touch devices, because there is no way to hover a finger. So a tooltip reaches
 * exactly one audience: a sighted user with a pointer or a keyboard. Anything that only exists
 * inside one reaches nobody else.
 *
 * The consequence for every call site: the TRIGGER carries the name, and the tooltip repeats it
 * for the people who can see it. `Tooltip.Trigger render={<IconButton label="Delete booking" />}`
 * is correct — IconButton's required `label` is the accessible name, and the tooltip is a
 * visual echo of it. A bare glyph with the meaning only in the tooltip is the defect this
 * paragraph exists to prevent, and no test can catch it, because the DOM looks fine.
 *
 * Nerey does not add a `role="tooltip"` of its own to close the gap. Nothing references the
 * popup, so the role would be a claim the document cannot back up, and it would make the
 * component look wired to an audit that only checks for the attribute. When the information
 * genuinely matters, use Popover with `openOnHover` on the trigger: it survives touch, it opens
 * from the keyboard, and its content is content.
 *
 * ADR 0022 — Base UI is wrapped and never re-exported, and no prop below is typed through
 * `ComponentProps<typeof Base.X>`.
 */

/** The four physical sides. Base UI also accepts logical ones; Nerey's arrow keys off these. */
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';
export type TooltipAlign = 'start' | 'center' | 'end';

/**
 * The gap between anchor and popup, and the distance the arrow is kept from the popup's
 * corners. Pixels because Floating UI positions in JavaScript and cannot read a custom
 * property; these are the values of `--nerey-space-2` and `--nerey-space-4` at the default root
 * font size. Not props: how far a label floats off its control is paint (ADR 0026).
 */
const ANCHOR_GAP = 8;
const ARROW_PADDING = 16;

/**
 * A trigger is a button, so it takes Button's axes — unless the caller substitutes an element,
 * in which case it takes none of them. For a tooltip the `render` branch is the usual one: the
 * control being described almost always already exists.
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

/* ── Provider ──────────────────────────────────────────────────────────────────────── */

export type TooltipProviderProps = {
  /** Milliseconds a pointer must rest on a trigger before its tooltip opens. */
  delay?: number;
  /** Milliseconds before a tooltip closes once the pointer leaves. */
  closeDelay?: number;
  children?: ReactNode;
};

/**
 * Groups the tooltips underneath it so that moving along a toolbar swaps labels immediately
 * instead of re-serving the opening delay at every icon. Optional in Base UI, and optional
 * here — but a toolbar without it feels broken in a way nobody can name.
 */
export function TooltipProvider({ delay, closeDelay, children }: TooltipProviderProps): ReactElement {
  return (
    <Base.Provider delay={delay} closeDelay={closeDelay}>
      {children}
    </Base.Provider>
  );
}

/* ── Root ──────────────────────────────────────────────────────────────────────────── */

export type TooltipRootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  /**
   * Narrower than Base UI's own handler, which also receives an event-details object carrying
   * the reason and a `cancel()`. Widening it later is a minor version; narrowing it back is
   * not (ADR 0029).
   */
  onOpenChange?: (open: boolean) => void;
  /** Suppress the tooltip without unmounting the trigger it is attached to. */
  disabled?: boolean;
  children?: ReactNode;
};

export function TooltipRoot({
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  children,
}: TooltipRootProps): ReactElement {
  // Wrapped rather than forwarded, so the one-parameter signature above is true at runtime as
  // well as in the types.
  const handleOpenChange = onOpenChange ? (nextOpen: boolean) => onOpenChange(nextOpen) : undefined;

  return (
    <Base.Root open={open} defaultOpen={defaultOpen} onOpenChange={handleOpenChange} disabled={disabled}>
      {children}
    </Base.Root>
  );
}

/* ── Trigger ───────────────────────────────────────────────────────────────────────── */

export type TooltipTriggerProps = ButtonShapedProps & {
  /** Milliseconds the pointer must rest here before the tooltip opens. */
  delay?: number;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

/**
 * There is no `disabled` here, and its absence is deliberate. Base UI's own `disabled` on this
 * part means "do not open the tooltip" and explicitly does NOT disable the button — a prop that
 * means the opposite of what it means on Dialog's and Popover's triggers, one keystroke away
 * from a control a consumer thinks they turned off. Suppressing the tooltip is `Tooltip.Root`'s
 * `disabled`; disabling the control is `render={<Button disabled />}`, which disables the thing
 * that actually has an enabled state.
 */
export function TooltipTrigger({
  variant,
  tone,
  size,
  render,
  delay,
  children,
  ref,
}: TooltipTriggerProps): ReactElement {
  return (
    <Base.Trigger
      ref={ref}
      delay={delay}
      render={render ?? <Button variant={variant} tone={tone} size={size} />}
    >
      {children}
    </Base.Trigger>
  );
}

/* ── Portal ────────────────────────────────────────────────────────────────────────── */

export type TooltipPortalProps = {
  /** Where the tooltip is mounted. Defaults to `document.body`. */
  container?: HTMLElement | null;
  children?: ReactNode;
};

export function TooltipPortal({ container, children }: TooltipPortalProps): ReactElement {
  return <Base.Portal container={container}>{children}</Base.Portal>;
}

/* ── Positioner ────────────────────────────────────────────────────────────────────── */

export type TooltipPositionerProps = {
  /** Preferred side of the anchor. Base UI flips it when there is not enough room. */
  side?: TooltipSide;
  align?: TooltipAlign;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

export function TooltipPositioner({
  side = 'top',
  align = 'center',
  children,
  ref,
}: TooltipPositionerProps): ReactElement {
  // `top` by default, unlike Popover's `bottom`: a tooltip is opened by a pointer that is
  // sitting on the trigger, and a label below the anchor is a label under the cursor.
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

/* ── Popup and arrow ───────────────────────────────────────────────────────────────── */

export type TooltipPopupProps = {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

export function TooltipPopup({ children, ref }: TooltipPopupProps): ReactElement {
  return (
    <Base.Popup ref={ref} className={styles.popup}>
      {children}
    </Base.Popup>
  );
}

export type TooltipArrowProps = {
  ref?: Ref<HTMLDivElement>;
};

export function TooltipArrow({ ref }: TooltipArrowProps): ReactElement {
  // Base UI marks the arrow `aria-hidden` for us, which is right twice over here: it is
  // decoration, and it decorates something that is already visual-only.
  return <Base.Arrow ref={ref} className={styles.arrow} />;
}

/**
 * The compound surface. There is no Backdrop and no Close: a tooltip dismisses itself when the
 * pointer or focus leaves, and a scrim over the page for a label would be absurd.
 */
export const Tooltip = {
  Provider: TooltipProvider,
  Root: TooltipRoot,
  Trigger: TooltipTrigger,
  Portal: TooltipPortal,
  Positioner: TooltipPositioner,
  Popup: TooltipPopup,
  Arrow: TooltipArrow,
};
