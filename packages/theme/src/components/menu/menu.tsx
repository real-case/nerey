import type { ButtonHTMLAttributes, MouseEventHandler, ReactElement, ReactNode, Ref } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';

import { cx } from '../../internal/cx';
import { CheckIcon, ChevronRightIcon } from '../icons/icons';
import styles from './menu.module.css';

/**
 * A dropdown menu, built on Base UI's headless menu.
 *
 * ADR 0022 — Base UI is wrapped, never re-exported, and no prop type below is derived from one
 * of its components. `ComponentProps<typeof BaseMenu.Item>` would compile today and would put
 * Base UI into Nerey's published type surface: every consumer's `.d.ts` would name it, and
 * swapping the headless layer would become a breaking change to a package that never mentioned
 * it. The cost is that the props are restated by hand; the benefit is that they are Nerey's.
 *
 * ADR 0028 — the compound shape is kept, because a menu's structure IS its API. Where a
 * separator falls, which items share a group, which item opens a submenu: an `items` array prop
 * would move all of that into a data format that grows a new field for every arrangement
 * somebody needs, and would still not express a submenu.
 *
 * The state contract is Base UI's and React's: `open` / `defaultOpen` / `onOpenChange`. The
 * change callback deliberately drops Base UI's second `eventDetails` argument — it carries a
 * cancellation API typed by the dependency, and re-exporting it through a Nerey signature is the
 * same leak as re-exporting the component.
 */

export type MenuTriggerVariant = 'outline' | 'ghost';
export type MenuTriggerSize = 'sm' | 'md';
export type MenuSide = 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end';
export type MenuAlign = 'start' | 'center' | 'end';

/**
 * `ref` is exposed on the parts a caller can plausibly need to reach — the trigger for focus
 * restoration, the popup and the items for scrolling one into view — and withheld from the
 * structural wrappers, where a ref would only ever be a handle on a positioning `<div>` that
 * Base UI owns and moves.
 */

/* ── Root ──────────────────────────────────────────────────────────────────────────────── */

export type MenuRootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Focus is trapped and the page behind is inert while open. Base UI's default is `true`. */
  modal?: boolean;
  disabled?: boolean;
  /** Arrow-key navigation wraps at the ends. */
  loopFocus?: boolean;
  children?: ReactNode;
};

function MenuRoot({ children, ...rest }: MenuRootProps): ReactElement {
  return <BaseMenu.Root {...rest}>{children}</BaseMenu.Root>;
}

/* ── Trigger ───────────────────────────────────────────────────────────────────────────── */

type NativeMenuTriggerProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'color'>;

export type MenuTriggerProps = NativeMenuTriggerProps & {
  variant?: MenuTriggerVariant;
  size?: MenuTriggerSize;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

/**
 * The trigger paints itself rather than delegating to `Button`. Base UI's `render` prop merges
 * its own `className` onto the element it is given, and ADR 0026 removed `className` from
 * Button's props — so `render={<Button />}` would hand Button a class it drops on the floor
 * while Button's computed class never reaches the DOM. Two components, one broken button, no
 * error message. A trigger that owns its own paint cannot fail that way.
 */
const TRIGGER_VARIANT_CLASS: Record<MenuTriggerVariant, string | undefined> = {
  outline: undefined,
  ghost: styles.triggerGhost,
};

const TRIGGER_SIZE_CLASS: Record<MenuTriggerSize, string | undefined> = {
  sm: styles.triggerSizeSm,
  md: undefined,
};

function MenuTrigger({
  variant = 'outline',
  size = 'md',
  render,
  type = 'button',
  children,
  ref,
  ...rest
}: MenuTriggerProps): ReactElement {
  return (
    <BaseMenu.Trigger
      ref={ref}
      type={type}
      className={cx(styles.trigger, TRIGGER_VARIANT_CLASS[variant], TRIGGER_SIZE_CLASS[size])}
      render={render}
      {...rest}
    >
      {children}
    </BaseMenu.Trigger>
  );
}

/* ── Portal / Positioner / Popup ───────────────────────────────────────────────────────── */

export type MenuPortalProps = {
  /** Where the popup is appended. Defaults to `document.body`. */
  container?: HTMLElement | null;
  /** Keep the popup mounted while closed, so an exit transition has something to animate. */
  keepMounted?: boolean;
  children?: ReactNode;
};

/**
 * Portal is not optional and is not a convenience: `Menu.Positioner` reads a context that only
 * `Menu.Portal` publishes, and Base UI throws `<Menu.Portal> is missing.` without it. It is a
 * part rather than something Popup wraps for you because the container is a real decision — a
 * menu inside a modal that renders to `document.body` escapes the dialog's stacking context.
 */
function MenuPortal({ children, ...rest }: MenuPortalProps): ReactElement {
  return <BaseMenu.Portal {...rest}>{children}</BaseMenu.Portal>;
}

export type MenuPositionerProps = {
  side?: MenuSide;
  align?: MenuAlign;
  /** Gap between the trigger and the popup, in pixels — Floating UI takes a number, not a length. */
  sideOffset?: number;
  alignOffset?: number;
  children?: ReactNode;
};

/**
 * Positioner carries the size constraints and nothing else. Base UI declares `--available-width`
 * / `--available-height` / `--transform-origin` HERE, not on Popup; they reach Popup only by
 * inheritance, so the element that constrains itself with them is the one they are measured for.
 * All paint is on Popup (ADR 0025).
 */
function MenuPositioner({ sideOffset = 6, children, ...rest }: MenuPositionerProps): ReactElement {
  return (
    <BaseMenu.Positioner className={styles.positioner} sideOffset={sideOffset} {...rest}>
      {children}
    </BaseMenu.Positioner>
  );
}

export type MenuPopupProps = {
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function MenuPopup({ children, ref }: MenuPopupProps): ReactElement {
  return (
    <BaseMenu.Popup ref={ref} className={styles.popup}>
      {children}
    </BaseMenu.Popup>
  );
}

/* ── Items ─────────────────────────────────────────────────────────────────────────────── */

type ItemBehaviourProps = {
  disabled?: boolean;
  /** Closes the menu when activated. */
  closeOnClick?: boolean;
  /**
   * The string typeahead matches against. Only needed when `children` is not plain text —
   * Base UI reads `textContent` otherwise, and an item whose label is an icon plus a `<span>`
   * still reads correctly, while one built from a chart does not.
   */
  label?: string;
};

export type MenuItemProps = ItemBehaviourProps & {
  onClick?: MouseEventHandler<HTMLElement>;
  /** Swap the rendered element — an item that is really a link should be an `<a>`. */
  render?: ReactElement;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
};

function MenuItem({ children, ref, ...rest }: MenuItemProps): ReactElement {
  return (
    <BaseMenu.Item ref={ref} className={styles.item} {...rest}>
      {children}
    </BaseMenu.Item>
  );
}

/**
 * The check mark is part of the component, not part of the caller's children.
 *
 * Base UI unmounts `CheckboxItemIndicator` when the item is unchecked, so an indicator placed
 * directly in a grid track would take the label's column back every time the box is cleared and
 * the whole row would shuffle sideways. Owning the anatomy lets the slot stay in the DOM while
 * only the mark inside it comes and goes — and it keeps `Menu.CheckboxItem` a single part with
 * a single child, which is what the call site actually wants to write.
 */
export type MenuCheckboxItemProps = ItemBehaviourProps & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
};

function MenuCheckboxItem({ children, ref, ...rest }: MenuCheckboxItemProps): ReactElement {
  return (
    <BaseMenu.CheckboxItem ref={ref} className={cx(styles.item, styles.selectableItem)} {...rest}>
      <span className={styles.itemIndicator}>
        <BaseMenu.CheckboxItemIndicator>
          <CheckIcon />
        </BaseMenu.CheckboxItemIndicator>
      </span>
      <span className={styles.itemLabel}>{children}</span>
    </BaseMenu.CheckboxItem>
  );
}

export type MenuRadioGroupProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children?: ReactNode;
};

function MenuRadioGroup({ children, ...rest }: MenuRadioGroupProps): ReactElement {
  return (
    <BaseMenu.RadioGroup className={styles.group} {...rest}>
      {children}
    </BaseMenu.RadioGroup>
  );
}

export type MenuRadioItemProps = ItemBehaviourProps & {
  /** The value this item contributes to its `RadioGroup`. Base UI requires it. */
  value: string;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
};

function MenuRadioItem({ children, ref, ...rest }: MenuRadioItemProps): ReactElement {
  return (
    <BaseMenu.RadioItem ref={ref} className={cx(styles.item, styles.selectableItem)} {...rest}>
      <span className={styles.itemIndicator}>
        <BaseMenu.RadioItemIndicator className={styles.radioDot} />
      </span>
      <span className={styles.itemLabel}>{children}</span>
    </BaseMenu.RadioItem>
  );
}

/* ── Structure ─────────────────────────────────────────────────────────────────────────── */

export type MenuSeparatorProps = Record<string, never>;

/**
 * Deliberately not the theme's own `Separator`. That one is a labelled page rule; this is the
 * `role="separator"` Base UI wires into the menu's own keyboard and typeahead bookkeeping, so
 * arrow keys skip it instead of landing on it.
 */
function MenuSeparator(_props: MenuSeparatorProps): ReactElement {
  return <BaseMenu.Separator className={styles.separator} />;
}

export type MenuGroupProps = {
  children?: ReactNode;
};

function MenuGroup({ children }: MenuGroupProps): ReactElement {
  return <BaseMenu.Group className={styles.group}>{children}</BaseMenu.Group>;
}

export type MenuGroupLabelProps = {
  children?: ReactNode;
};

/**
 * A group label is not decoration: Base UI points the group's `aria-labelledby` at it, which is
 * the only thing that tells a screen-reader user that the three items below belong together.
 */
function MenuGroupLabel({ children }: MenuGroupLabelProps): ReactElement {
  return <BaseMenu.GroupLabel className={styles.groupLabel}>{children}</BaseMenu.GroupLabel>;
}

/* ── Submenus ──────────────────────────────────────────────────────────────────────────── */

export type MenuSubmenuRootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
};

function MenuSubmenuRoot({ children, ...rest }: MenuSubmenuRootProps): ReactElement {
  return <BaseMenu.SubmenuRoot {...rest}>{children}</BaseMenu.SubmenuRoot>;
}

export type MenuSubmenuTriggerProps = {
  disabled?: boolean;
  label?: string;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
};

/**
 * The trailing chevron is drawn here rather than left to the caller, because it is the only
 * thing distinguishing a submenu trigger from an ordinary item and "the one call site that
 * forgot it" is a menu row that silently lies about what it does.
 */
function MenuSubmenuTrigger({ children, ref, ...rest }: MenuSubmenuTriggerProps): ReactElement {
  return (
    <BaseMenu.SubmenuTrigger ref={ref} className={cx(styles.item, styles.submenuTrigger)} {...rest}>
      <span className={styles.itemLabel}>{children}</span>
      <span className={styles.submenuChevron}>
        <ChevronRightIcon />
      </span>
    </BaseMenu.SubmenuTrigger>
  );
}

/**
 * The namespace is the export. Publishing the parts individually would let a consumer import
 * `MenuPopup` without `MenuRoot`, which type-checks and throws at runtime — the compound
 * relationship is real, and the object is what makes it visible at the import site (ADR 0028).
 */
export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Portal: MenuPortal,
  Positioner: MenuPositioner,
  Popup: MenuPopup,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  Separator: MenuSeparator,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  SubmenuRoot: MenuSubmenuRoot,
  SubmenuTrigger: MenuSubmenuTrigger,
};
