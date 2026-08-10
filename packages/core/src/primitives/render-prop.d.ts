import type { ReactElement } from 'react';
/**
 * ADR 0021 — element substitution goes through `render`, never through `asChild` or `as`.
 *
 * The element form (`render={<Link to="/x" />}`) covers substitution; the function form
 * (`render={(props) => <Card {...props} />}`) covers composition, because it hands the merged
 * props to the call site and lets it decide what to spread. `asChild` was rejected for failing
 * at runtime on fragments and text children, and `as` for giving the caller no say in how props
 * are merged.
 */
export type RenderProp<P> = ReactElement | ((props: P) => ReactElement);
/**
 * Renders `props` through the caller's `render`, or through `fallback` when they supplied none.
 *
 * The function form receives the props untouched: it has not rendered anything yet, so there is
 * nothing to merge with, and the whole point of that form is that the call site chooses what to
 * spread. The element form is cloned with the two prop bags merged by the rules above.
 */
export declare function renderWith<P extends Record<string, unknown>>(
  render: RenderProp<P> | undefined,
  props: P,
  fallback: (props: P) => ReactElement,
): ReactElement;
//# sourceMappingURL=render-prop.d.ts.map
