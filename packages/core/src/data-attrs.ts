import type { Placement, WidgetStatus } from './types';

/**
 * ADR 0020 — the `data-*` surface is @nerey/core's PUBLIC STYLING API.
 *
 * A consumer styles Nerey entirely from their own CSS Modules by selecting on these
 * attributes; they never learn a class name, and Nerey never ships one. Because it is
 * public API, a rename here is a MAJOR version bump (ADR 0029), and
 * `src/__tests__/data-contract.test.tsx` snapshots the emitted attributes so a change
 * cannot happen by accident.
 *
 * Attribute vocabulary:
 *
 *   data-nerey-widget="<type>"      the widget type, on the widget root
 *   data-nerey-version="<version>"  the resolved entry version
 *   data-nerey-slot="<slot>"        message | input | overlay
 *   data-nerey-part="<part>"        a named region inside a widget (theme-defined)
 *   data-nerey-status               streaming | ready | error
 *   data-state                      idle | selected | submitting | locked | expired | error
 *   data-readonly                   present (empty string) when the widget is read-only
 *   data-nerey-fallback="<reason>"  on a rendered fallback, why the widget did not render
 *
 * `data-state` deliberately reuses the unprefixed name Base UI, Radix and React Aria all
 * use, so a consumer writes one selector idiom across their whole UI rather than a
 * Nerey-specific dialect.
 */

export const NEREY_ATTR = {
  widget: 'data-nerey-widget',
  version: 'data-nerey-version',
  slot: 'data-nerey-slot',
  part: 'data-nerey-part',
  status: 'data-nerey-status',
  state: 'data-state',
  readonly: 'data-readonly',
  fallback: 'data-nerey-fallback',
  theme: 'data-nerey-theme',
} as const;

/** The value set for `data-state`. Widgets outside this vocabulary fail the contract test. */
export const NEREY_STATES = ['idle', 'selected', 'submitting', 'locked', 'expired', 'error'] as const;

export type NereyState = (typeof NEREY_STATES)[number];

export type FallbackReason = 'unknown-widget' | 'invalid-payload' | 'render-error' | 'expired' | 'no-widget';

export type NereyRootAttributes = {
  'data-nerey-widget': string;
  'data-nerey-version': string;
  'data-nerey-slot': Placement['slot'];
  'data-nerey-status': WidgetStatus;
  'data-state'?: NereyState;
  'data-readonly'?: '';
};

/**
 * Builds the attribute bag for a widget root. Returned as a plain object so it spreads onto
 * any element — including one a consumer supplies through `render` (ADR 0021).
 *
 * `data-readonly` is emitted as a valueless attribute when true and omitted entirely when
 * false, so `[data-readonly]` is the selector rather than `[data-readonly='true']`.
 */
export function widgetRootAttributes(input: {
  type: string;
  version: string;
  slot: Placement['slot'];
  status: WidgetStatus;
  state?: NereyState;
  readonly?: boolean;
}): NereyRootAttributes {
  const attrs: NereyRootAttributes = {
    'data-nerey-widget': input.type,
    'data-nerey-version': input.version,
    'data-nerey-slot': input.slot,
    'data-nerey-status': input.status,
  };
  if (input.state) attrs['data-state'] = input.state;
  if (input.readonly) attrs['data-readonly'] = '';
  return attrs;
}

export function partAttributes(part: string, state?: NereyState): Record<string, string> {
  return state ? { 'data-nerey-part': part, 'data-state': state } : { 'data-nerey-part': part };
}

export function fallbackAttributes(reason: FallbackReason): Record<string, string> {
  return { 'data-nerey-fallback': reason };
}
