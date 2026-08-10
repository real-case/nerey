import type { ButtonHTMLAttributes, HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { Tabs as BaseTabs } from '@base-ui/react/tabs';

import styles from './tabs.module.css';

/**
 * A tab list and its panels, with a sliding indicator.
 *
 * ADR 0022 — the indicator is `Tabs.Indicator`, and its position comes from the `--active-tab-*`
 * custom properties Base UI writes onto that element. Nerey measures nothing. A hand-rolled
 * underline means a `ResizeObserver`, a layout read on every activation, a second one for font
 * loading, and a race with the scroll position of an overflowing list — all of it already solved
 * next door, and all of it a defect surface that would belong to this repository.
 *
 * `value` is `string | null`, and `null` genuinely means "no tab is active" rather than "not set".
 * Base UI reaches that state on its own when the selected tab is removed or disabled and no
 * enabled tab is left to fall back to, so a signature that promised `string` would be lying about
 * a case the library produces. `Tab.value` and `Panel.value` are required and are how the two
 * halves find each other.
 *
 * `onValueChange` drops Base UI's second `eventDetails` argument, for the reason given on
 * Collapsible: forwarding it would put a vendor type in Nerey's public signature.
 */

export type TabsOrientation = 'horizontal' | 'vertical';

type NativeDivProps = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'color'>;
type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'color'>;

export type TabsRootProps = Omit<NativeDivProps, 'defaultValue'> & {
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  orientation?: TabsOrientation;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type TabsListProps = Omit<NativeDivProps, 'aria-label'> & {
  /** Names the tab list. Worth setting when a view carries more than one. */
  label?: string;
  /** Select a tab as soon as arrow keys focus it, rather than on Enter or Space. */
  activateOnFocus?: boolean;
  /** Whether arrow-key focus wraps around the ends of the list. */
  loopFocus?: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type TabsTabProps = NativeButtonProps & {
  /** Matches the `value` of exactly one `Tabs.Panel`. */
  value: string;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

export type TabsIndicatorProps = Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'style' | 'color'> & {
  ref?: Ref<HTMLSpanElement>;
};

export type TabsPanelProps = NativeDivProps & {
  /** Matches the `value` of exactly one `Tabs.Tab`. */
  value: string;
  /** Keep the panel in the DOM while another tab is active. */
  keepMounted?: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function TabsRoot({
  value,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  children,
  ref,
  ...rest
}: TabsRootProps): ReactElement {
  return (
    <BaseTabs.Root
      ref={ref}
      value={value}
      defaultValue={defaultValue}
      // Re-wrapped rather than forwarded — see the note on Collapsible.Root. The narrowing is
      // real here as well as cosmetic: Base UI types the value as `any`, and this is the one
      // place it can be pinned to the `string | null` the rest of the API promises.
      onValueChange={onValueChange ? (next: string | null) => onValueChange(next) : undefined}
      orientation={orientation}
      className={styles.root}
      {...rest}
    >
      {children}
    </BaseTabs.Root>
  );
}

function TabsList({
  label,
  activateOnFocus,
  loopFocus,
  children,
  ref,
  ...rest
}: TabsListProps): ReactElement {
  return (
    <BaseTabs.List
      ref={ref}
      activateOnFocus={activateOnFocus}
      loopFocus={loopFocus}
      aria-label={label}
      className={styles.list}
      {...rest}
    >
      {children}
    </BaseTabs.List>
  );
}

function TabsTab({ value, disabled, children, ref, ...rest }: TabsTabProps): ReactElement {
  return (
    <BaseTabs.Tab ref={ref} value={value} disabled={disabled} className={styles.tab} {...rest}>
      {children}
    </BaseTabs.Tab>
  );
}

function TabsIndicator({ ref, ...rest }: TabsIndicatorProps): ReactElement {
  // `renderBeforeHydration` is deliberately left at its default. It injects an inline script that
  // positions the indicator before React hydrates, which is worth the bytes for a server-rendered
  // page and is dead weight for the client-rendered transcripts Nerey actually renders into.
  return <BaseTabs.Indicator ref={ref} className={styles.indicator} {...rest} />;
}

function TabsPanel({ value, keepMounted, children, ref, ...rest }: TabsPanelProps): ReactElement {
  return (
    <BaseTabs.Panel ref={ref} value={value} keepMounted={keepMounted} className={styles.panel} {...rest}>
      {children}
    </BaseTabs.Panel>
  );
}

export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Tab: TabsTab,
  Indicator: TabsIndicator,
  Panel: TabsPanel,
} as const;
