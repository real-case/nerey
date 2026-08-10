import type { HTMLAttributes, ReactElement, Ref } from 'react';

import { cx } from '../../internal/cx';
import styles from './separator.module.css';

/**
 * A rule between two regions, optionally with a label centred in it.
 *
 * The element is a `<div role="separator">` rather than an `<hr>`, in both forms. An `<hr>` is
 * void and cannot hold the label, so keeping it for the plain form would mean the two forms
 * produce different elements — different default `display`, different behaviour as a flex item,
 * different reset needed — for a difference the caller did not ask about.
 *
 * `aria-orientation` is written out even for `horizontal`, where it is the role's default.
 * A separator that a consumer copies into a toolbar and rotates is a separator whose implicit
 * default has quietly become wrong, and there is no cost to being explicit.
 */

export type SeparatorOrientation = 'horizontal' | 'vertical';

type NativeSeparatorProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'className' | 'style' | 'color' | 'role' | 'aria-orientation' | 'children'
>;

/**
 * The union is the point: a vertical rule has no line to centre a label in, so the combination
 * is unrepresentable rather than silently ignored at runtime.
 */
export type SeparatorProps =
  | (NativeSeparatorProps & {
      orientation?: 'horizontal';
      label?: string;
      ref?: Ref<HTMLDivElement>;
    })
  | (NativeSeparatorProps & {
      orientation: 'vertical';
      label?: never;
      ref?: Ref<HTMLDivElement>;
    });

export function Separator({ orientation = 'horizontal', label, ref, ...rest }: SeparatorProps): ReactElement {
  const className = cx(
    styles.root,
    orientation === 'vertical' ? styles.vertical : styles.horizontal,
    label !== undefined && styles.labelled,
  );

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={orientation}
      // The rule itself is drawn with `::before`/`::after`, so the label needs no wrapper and
      // the accessible name comes from the author rather than from content — `separator` is not
      // a name-from-content role, so the visible text alone would reach nobody.
      aria-label={label}
      className={className}
      {...rest}
    >
      {label}
    </div>
  );
}
