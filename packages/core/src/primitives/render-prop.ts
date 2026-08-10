import { cloneElement } from 'react';
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

type UnknownProps = Record<string, unknown>;

/**
 * React's event props are `on` followed by a capital. The capital is load-bearing: matching on
 * `on` alone would compose `once`, `only` or a consumer's `onboarding` prop as if it were a
 * handler, replacing the caller's value with a function.
 */
const HANDLER_NAME = /^on[A-Z]/;

type ComposableHandler = (...args: unknown[]) => void;

function isRecord(value: unknown): value is UnknownProps {
  return typeof value === 'object' && value !== null;
}

/**
 * `ReactElement`'s props are `unknown`, and an element can legitimately carry no props at all,
 * so the narrowing happens here rather than being asserted away at the call site (ADR 0003).
 */
function elementProps(element: ReactElement): UnknownProps {
  return isRecord(element.props) ? element.props : {};
}

function joinClassNames(ours: unknown, theirs: unknown): string | undefined {
  const mine = typeof ours === 'string' ? ours.trim() : '';
  const yours = typeof theirs === 'string' ? theirs.trim() : '';
  if (mine && yours) return `${mine} ${yours}`;
  // `undefined` rather than `''` so an absent class leaves no empty `class` attribute behind.
  return mine || yours || undefined;
}

function mergeStyles(ours: unknown, theirs: unknown): unknown {
  if (!isRecord(ours)) return theirs;
  if (!isRecord(theirs)) return ours;
  // Per-property, caller last: they override the declarations they name and inherit the rest.
  // Replacing the whole object would drop layout the primitive depends on with no diagnostic.
  return { ...ours, ...theirs };
}

/**
 * Both handlers run, Nerey's first. Either one alone would be a silent contract break: dropping
 * Nerey's loses the interaction the widget exists to report, dropping the caller's loses the
 * behaviour they attached the element for — and neither failure produces an error, only a
 * button that half works.
 *
 * There is deliberately no `defaultPrevented` short-circuit. `preventDefault()` is about the
 * browser's default action, not about cancelling a sibling listener, and treating it as a veto
 * would make composition depend on an unrelated call the caller made for another reason.
 */
function composeHandlers(ours: unknown, theirs: unknown): unknown {
  if (typeof ours !== 'function') return theirs;
  if (typeof theirs !== 'function') return ours;

  const first = ours as ComposableHandler;
  const second = theirs as ComposableHandler;
  return (...args: unknown[]) => {
    first(...args);
    second(...args);
  };
}

/**
 * Nerey's props are the base and the caller's element overrides them, except where dropping one
 * side would break a contract rather than express a preference — `className`, `style` and event
 * handlers.
 *
 * A caller who restates a `data-nerey-*` attribute does win, and that is intended: the ADR 0021
 * guarantee is that substituting an element cannot *silently* remove the contract, not that the
 * contract is unwritable. An explicit override is visible in the caller's own JSX, which is
 * exactly the property `asChild`'s invisible prop merging lacks.
 */
function mergeProps(ours: UnknownProps, theirs: UnknownProps): UnknownProps {
  const merged: UnknownProps = { ...ours };

  for (const key of Object.keys(theirs)) {
    const theirValue = theirs[key];

    if (key === 'className') merged[key] = joinClassNames(ours[key], theirValue);
    else if (key === 'style') merged[key] = mergeStyles(ours[key], theirValue);
    else if (HANDLER_NAME.test(key)) merged[key] = composeHandlers(ours[key], theirValue);
    else merged[key] = theirValue;
  }

  return merged;
}

/**
 * Renders `props` through the caller's `render`, or through `fallback` when they supplied none.
 *
 * The function form receives the props untouched: it has not rendered anything yet, so there is
 * nothing to merge with, and the whole point of that form is that the call site chooses what to
 * spread. The element form is cloned with the two prop bags merged by the rules above.
 */
export function renderWith<P extends Record<string, unknown>>(
  render: RenderProp<P> | undefined,
  props: P,
  fallback: (props: P) => ReactElement,
): ReactElement {
  if (render === undefined) return fallback(props);
  if (typeof render === 'function') return render(props);

  // `cloneElement` types its second argument as `Partial<P>` of the element's own props, which
  // for an element the caller supplied is `unknown` — nothing can be assigned to it. Restating
  // the element's props as the open bag they actually are is what lets the merged attributes
  // through; the merge itself is typed.
  const element = render as ReactElement<UnknownProps>;
  return cloneElement(element, mergeProps(props, elementProps(element)));
}
