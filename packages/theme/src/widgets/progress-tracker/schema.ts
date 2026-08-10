import { z } from 'zod';

import type { Placement } from '@nerey/core';

/**
 * ADR 0011 — the theme validates with Zod 4 because it is a reference implementation and already
 * ships a runtime; core, which may depend only on the Standard Schema *spec*, hand-rolls its own.
 * Nothing crosses the boundary either way: `defineWidget` takes a `StandardSchemaV1`.
 */

export const PROGRESS_TRACKER_TYPE = 'progress-tracker';
export const PROGRESS_TRACKER_VERSION = '1.0.0';

/**
 * ADR 0017 — `message`, not `input` or `overlay`. A tracker belongs to the turn that started the
 * operation: pinning it above the composer would keep it on screen after the operation ended, and
 * an overlay would cover the conversation for the entire length of a long job.
 */
export const PROGRESS_TRACKER_PLACEMENT: Placement = { slot: 'message' };

export const progressStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export type ProgressStep = z.infer<typeof progressStepSchema>;

export const progressTrackerPayloadSchema = z.object({
  label: z.string().optional(),
  steps: z.array(progressStepSchema),
  /**
   * The ZERO-BASED index of the step currently in progress. Zero-based because it is an index into
   * `steps`, and a producer holding that array writes an index without having to remember an
   * off-by-one — the conversion to "step 3 of 5" happens exactly once, in the component.
   *
   * Both ends of the range carry meaning. `-1` is queued: the operation exists and no step has
   * started, which is the normal state of a sub-agent's tracker while it waits its turn.
   * `steps.length` is finished. Neither is expressible if the value is clamped to a valid index,
   * which is why `clampStep` clamps to `[-1, total]` and not to `[0, total - 1]`.
   */
  currentStep: z.number().int(),
  /** `false` when the total is genuinely unknown. The bar then travels instead of filling. */
  determinate: z.boolean().optional(),
  /** Overrides the percentage derived from `currentStep`, for work whose steps are unequal. */
  percent: z.number().min(0).max(100).optional(),
});

export type ProgressTrackerPayload = z.infer<typeof progressTrackerPayloadSchema>;

/**
 * The tracker records nothing about the reader: it has no controls, so there is no decision to
 * persist (ADR 0016). The schema exists anyway, and it is STRICT, so a state record that arrives
 * from somewhere — a host reusing a message id, a migration that half-ran — is reported through
 * `onWidgetError` instead of being silently handed to a component that would ignore it.
 */
export const progressTrackerStateSchema = z.strictObject({}).default({});

export type ProgressTrackerState = z.infer<typeof progressTrackerStateSchema>;

export const DEFAULT_PROGRESS_LABEL = 'Progress';
export const DEFAULT_STEPS_LABEL = 'Steps';
export const DEFAULT_RUNNING_LABEL = 'In progress';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a step list out of a value that has NOT been through `progressTrackerPayloadSchema`.
 *
 * ADR 0019 — while `status === 'streaming'` the renderer skips validation, because a partial object
 * fails a complete schema by definition. A tracker streams its plan the way a task tree does: the
 * steps arrive one at a time, and the last one routinely turns up with half a label. A step with no
 * usable `id` is dropped rather than rendered as a row that will change identity on the next delta.
 */
export function readSteps(value: unknown): ProgressStep[] {
  if (!Array.isArray(value)) return [];

  const out: ProgressStep[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = raw['id'];
    if (typeof id !== 'string' || id === '') continue;
    out.push({ id, label: typeof raw['label'] === 'string' ? raw['label'] : '' });
  }
  return out;
}

/**
 * Clamps `currentStep` into `[-1, total]` — one below the first index and one above the last,
 * because those two out-of-range values are the encodings for "queued" and "finished".
 *
 * A missing or unreadable value becomes `0` rather than `-1`. A tracker that arrived at all is
 * evidence that something started; defaulting to "queued" would render a running operation as one
 * that has not begun, which is the more misleading of the two guesses.
 */
export function clampStep(value: unknown, total: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), -1), total);
}

export function clampPercent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(value, 0), 100);
}

export type StepState = 'done' | 'current' | 'pending' | 'failed';

export function stepStateAt(index: number, current: number, failed: boolean): StepState {
  if (index < current) return 'done';
  if (index > current) return 'pending';
  return failed ? 'failed' : 'current';
}

/**
 * The sentence the live region announces. Exported because it is the widget's only speech, and a
 * test that asserts on rendered markup instead of on this string is asserting on the layout.
 */
export function announcement(input: {
  steps: readonly ProgressStep[];
  current: number;
  failed: boolean;
  streaming: boolean;
}): string {
  const { steps, current, failed, streaming } = input;
  const total = steps.length;

  if (total === 0) return streaming ? 'Working out the steps.' : 'Nothing to do.';

  /**
   * The streaming branch comes first because every sentence below it states `total`, and while the
   * plan is arriving `total` is how many steps have TURNED UP, not how many there are.
   *
   * DEFECT FIXED: this used to fall straight through, so a tracker three deltas into a five-step
   * plan announced "Step 2 of 3", then "Step 2 of 4", then "Step 2 of 5". The region is `polite`
   * and `aria-atomic`, so each of those is re-read in full: a screen-reader user was told three
   * times that the run was nearly over, and twice that was wrong. Worse, `current >= total` was
   * reachable mid-stream, which announced "All 3 steps complete." for a run that had not finished.
   * The component already refuses to state this denominator as a percentage — the bar is forced
   * indeterminate while `status === 'streaming'` for exactly this reason — and the sentence has to
   * agree with the bar rather than contradict it.
   *
   * `status` is a single value, so `streaming` and `failed` are never both true.
   */
  if (streaming) {
    if (current < 0) return 'Working out the steps.';
    const index = Math.min(current, total - 1);
    return `Step ${index + 1}: ${steps[index]?.label ?? ''}`;
  }

  if (current < 0) return `Queued: ${total} steps to run.`;

  // `current` is clamped to `total`, so the last real index is one below it.
  const index = Math.min(current, total - 1);
  const label = steps[index]?.label ?? '';

  if (failed) return `Step ${index + 1} of ${total} failed: ${label}`;
  if (current >= total) return `All ${total} steps complete.`;
  return `Step ${current + 1} of ${total}: ${label}`;
}
