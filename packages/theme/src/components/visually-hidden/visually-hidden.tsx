import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import styles from './visually-hidden.module.css';

/**
 * Text that is removed from the layout and kept in the accessibility tree.
 *
 * The two obvious ways to hide something are both wrong here, and wrong in the same way:
 * `display: none` and `visibility: hidden` remove the element from the accessibility tree as
 * well as from the page, which deletes exactly the thing this component exists to deliver. So
 * does `hidden`, and so does an empty `<span>` with `aria-label` on it — a name with no content
 * is not announced when the surrounding live region updates.
 *
 * Clipping a one-pixel box is the only technique that separates the two. The details are load
 * bearing and are explained in the stylesheet.
 */

type NativeVisuallyHiddenProps = Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'style' | 'color'>;

export type VisuallyHiddenProps = NativeVisuallyHiddenProps & {
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
};

export function VisuallyHidden({ children, ref, ...rest }: VisuallyHiddenProps): ReactElement {
  return (
    <span ref={ref} className={styles.root} {...rest}>
      {children}
    </span>
  );
}
