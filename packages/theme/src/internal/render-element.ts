import { cloneElement } from 'react';
import type { ReactElement } from 'react';

import { cx } from './cx';

/**
 * Renders `props` onto the caller's `render` element, or onto `fallback` when they gave none.
 *
 * The merge rules are deliberately the same ones `renderWith` applies in @nerey/core (ADR 0021),
 * and this is a separate implementation rather than an import of that one because the layout and
 * display primitives take no dependency on the runtime. Surface, Stack and IconButton are
 * presentation and nothing else: a consumer who wants the visual layer without the widget
 * machinery — or a widget author rendering a panel outside a transcript — should not pull the
 * registry, the lifecycle and the host context in behind a `<div>`.
 *
 * `style` is not special-cased the way core's version does. Nothing here ever puts a `style` on
 * the props bag (ADR 0026 removed it from the public surface), so there is never one of ours to
 * merge with — the caller's own `style` simply arrives through the generic branch and wins.
 */

type UnknownProps = Record<string, unknown>;

/**
 * React's event props are `on` followed by a capital. The capital is load-bearing: matching on
 * `on` alone would treat a caller's `once` or `onboarding` prop as a handler and replace their
 * value with a function.
 */
const HANDLER_NAME = /^on[A-Z]/;

type ComposableHandler = (...args: unknown[]) => void;

function isRecord(value: unknown): value is UnknownProps {
  return typeof value === 'object' && value !== null;
}

/** A `ReactElement`'s props are `unknown`, and an element may legitimately carry none. */
function elementProps(element: ReactElement): UnknownProps {
  return isRecord(element.props) ? element.props : {};
}

/**
 * Both handlers run, the theme's first. Dropping either one is a silent break rather than an
 * error: ours loses the behaviour the component was built around, theirs loses the reason they
 * passed an element at all, and neither failure produces anything to read in a console.
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
 * The theme's props are the base and the caller's element overrides them, except for `className`
 * and event handlers, where dropping one side would break a contract rather than express a
 * preference. A caller who restates one of the theme's own attributes does win — substituting an
 * element must not SILENTLY discard what the component set, but it was never meant to make it
 * unwritable, and an explicit override is visible in the caller's own JSX.
 */
function mergeProps(ours: UnknownProps, theirs: UnknownProps): UnknownProps {
  const merged: UnknownProps = { ...ours };

  for (const key of Object.keys(theirs)) {
    const value = theirs[key];

    if (key === 'className') {
      merged[key] =
        cx(
          typeof ours[key] === 'string' ? ours[key] : undefined,
          typeof value === 'string' ? value : undefined,
        ) || undefined;
    } else if (HANDLER_NAME.test(key)) {
      merged[key] = composeHandlers(ours[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export function renderElement(
  render: ReactElement | undefined,
  props: UnknownProps,
  fallback: (props: UnknownProps) => ReactElement,
): ReactElement {
  if (render === undefined) return fallback(props);

  // `cloneElement` types its second argument as `Partial<P>` of the element's own props, which
  // for an element the caller supplied is `unknown` — nothing can be assigned to it. Restating
  // the element's props as the open bag they actually are is what lets the merged attributes
  // through; the merge itself is typed.
  const element = render as ReactElement<UnknownProps>;
  return cloneElement(element, mergeProps(props, elementProps(element)));
}
