import type { ButtonHTMLAttributes, HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible';

import { ChevronDownIcon } from '../icons/icons';
import styles from './collapsible.module.css';

/**
 * A disclosure: one trigger, one panel, height animated between them.
 *
 * ADR 0022 — the state contract is `open` / `defaultOpen` / `onOpenChange`, and `onOpenChange` is
 * narrowed to `(open: boolean) => void`. Base UI passes a second `eventDetails` argument carrying
 * `.reason`, `.event` and `.cancel()`; forwarding it would put a vendor type in Nerey's public
 * signature, which is the exact leak ADR 0022 exists to prevent — a consumer's build would then
 * resolve `@base-ui/react` types and a swap would become a major release. A handler that ignores
 * the argument is assignable to one that receives it, so dropping it costs nothing at the call
 * site.
 *
 * The chevron is not optional. A disclosure control whose only affordance is its label is one
 * people click twice because nothing told them the first click did anything, and every call site
 * that had to opt in would be one that could forget. Per-instance deviation, as everywhere else,
 * goes through the custom properties the stylesheet declares (ADR 0026).
 *
 * `Panel` renders its own inner element around `children`. The panel's block-size animates from
 * zero, so padding on the animated box would stop it ever reaching zero and leave a visible strip
 * behind — a defect the caller can only fix by adding a wrapper the API never mentioned.
 */

type NativeDivProps = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'color'>;
type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'color'>;

export type CollapsibleRootProps = NativeDivProps & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type CollapsibleTriggerProps = NativeButtonProps & {
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

export type CollapsiblePanelProps = NativeDivProps & {
  /** Keep the panel in the DOM while it is closed. Ignored when `hiddenUntilFound` is set. */
  keepMounted?: boolean;
  /** Let the browser's find-in-page open the panel. Uses `hidden="until-found"`. */
  hiddenUntilFound?: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function CollapsibleRoot({
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  children,
  ref,
  ...rest
}: CollapsibleRootProps): ReactElement {
  return (
    <BaseCollapsible.Root
      ref={ref}
      open={open}
      defaultOpen={defaultOpen}
      // Re-wrapped rather than forwarded, so the signature Nerey declares is the signature the
      // caller actually gets. Base UI calls with a second `eventDetails` argument; forwarding the
      // reference would hand a vendor object to anyone who spread their parameters — the leak of
      // ADR 0022, arriving at runtime where no type mentions it.
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
      disabled={disabled}
      className={styles.root}
      {...rest}
    >
      {children}
    </BaseCollapsible.Root>
  );
}

function CollapsibleTrigger({ children, ref, ...rest }: CollapsibleTriggerProps): ReactElement {
  return (
    <BaseCollapsible.Trigger ref={ref} className={styles.trigger} {...rest}>
      <span className={styles.triggerLabel}>{children}</span>
      {/* The glyph is already `aria-hidden`; this span exists only to give the rotation something
          to act on that is not the button itself. */}
      <span className={styles.indicator}>
        <ChevronDownIcon />
      </span>
    </BaseCollapsible.Trigger>
  );
}

function CollapsiblePanel({
  keepMounted,
  hiddenUntilFound,
  children,
  ref,
  ...rest
}: CollapsiblePanelProps): ReactElement {
  return (
    <BaseCollapsible.Panel
      ref={ref}
      keepMounted={keepMounted}
      hiddenUntilFound={hiddenUntilFound}
      className={styles.panel}
      {...rest}
    >
      <div className={styles.panelContent}>{children}</div>
    </BaseCollapsible.Panel>
  );
}

export const Collapsible = {
  Root: CollapsibleRoot,
  Trigger: CollapsibleTrigger,
  Panel: CollapsiblePanel,
} as const;
