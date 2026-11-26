/**
 * @nerey/core/server — the React-free subset of core, for React Server Components (ADR 0052).
 *
 * The client entry is a `'use client'` boundary, so a server module that imports it gets client
 * references rather than functions and cannot call `describeRegistry` to build a prompt. This entry
 * is built separately, with no banner, and holds only what never touches React at runtime.
 *
 * The rule for adding to it: a module reachable from here imports nothing from `react` or
 * `react-dom` at runtime. Type-only imports are fine. `server-entry.test.ts` loads the built file
 * and fails if its module graph reaches either.
 *
 * Everything here is also exported from `@nerey/core`, so nothing that works on the client moves.
 */

/* ── Types ─────────────────────────────────────────────────────────────────────────── */

export type {
  AnyWidgetRegistryEntry,
  ExpiryRule,
  Lifecycle,
  NereyMessage,
  NereyWidgetEnvelope,
  Placement,
  WidgetRegistry,
  WidgetRegistryEntry,
} from '../types';

/* ── Authoring and composing a registry (ADR 0009 / 0010) ──────────────────────────── */

export { composeRegistries, createWidgetRegistry, defineWidget, emptyRegistry } from '../registry';
export type { CreateRegistryOptions } from '../registry';

/* ── Describing the registry to a producer (ADR 0040) ──────────────────────────────── */

export { describeRegistry } from '../describe';
export type { DescribeRegistryOptions, WidgetDescriptor } from '../describe';

/* ── The pure lifecycle evaluator (ADR 0018 / 0046) ────────────────────────────────── */

export {
  EXPIRE_ON_INTERACT,
  NEVER_EXPIRES,
  firstFiredRule,
  isExpired,
  msUntilNextTimeout,
} from '../lifecycle/expiry';
export type { LifecycleSignals } from '../lifecycle/expiry';

/* ── Validation (ADR 0011) ─────────────────────────────────────────────────────────── */

export { flattenIssues, formatIssuePath, validateSync } from '../validate';
export type { FlatIssue, ValidationOutcome } from '../validate';
