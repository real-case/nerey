import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * ADR 0011 — validation goes through Standard Schema v1, so `@nerey/core` depends on the
 * *spec* (a types-only package, zero runtime bytes) rather than on a validator. A consumer
 * brings Zod 4, Valibot, ArkType or anything else that implements v1.
 *
 * Validation here is deliberately **synchronous**. A widget renders during React's render
 * phase; there is no point at which Nerey could await a schema without either suspending or
 * flashing a fallback. A schema that validates asynchronously is a configuration error, and
 * this module says so in as many words rather than silently treating the pending Promise as
 * a successful result — which is what a naive `if (result.issues)` check would do.
 */

export type FlatIssue = { path: string; message: string };

export type ValidationOutcome<T> = { ok: true; value: T } | { ok: false; issues: readonly FlatIssue[] };

/**
 * A path segment is `PropertyKey | { key: PropertyKey }` — Zod and ArkType emit raw keys,
 * Valibot emits objects carrying `.key` plus vendor extras. Both forms are part of the spec,
 * so both are handled; anything else degrades to its string form rather than throwing inside
 * an error path.
 */
function segmentToString(segment: unknown): string {
  if (typeof segment === 'string') return segment;
  if (typeof segment === 'number') return String(segment);
  if (typeof segment === 'symbol') return segment.description ?? String(segment);
  if (segment && typeof segment === 'object' && 'key' in segment) {
    return segmentToString(segment.key);
  }
  return String(segment);
}

/** `["user","tags",1]` → `user.tags[1]`. Array indices read better bracketed. */
export function formatIssuePath(path: readonly unknown[] | undefined): string {
  if (!path || path.length === 0) return '';
  let out = '';
  for (const raw of path) {
    const segment = segmentToString(raw);
    if (/^\d+$/.test(segment)) out += `[${segment}]`;
    else out += out ? `.${segment}` : segment;
  }
  return out;
}

export function flattenIssues(issues: readonly StandardSchemaV1.Issue[]): FlatIssue[] {
  return issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
  }));
}

/**
 * Runs a Standard Schema synchronously and returns a discriminated outcome rather than
 * throwing. Nerey's degradation chain (ADR 0012) treats an invalid payload as an expected
 * branch, not an exception — throwing here would only mean catching one line later.
 */
export function validateSync<Input, Output>(
  schema: StandardSchemaV1<Input, Output>,
  value: unknown,
): ValidationOutcome<Output> {
  const result = schema['~standard'].validate(value);

  if (result instanceof Promise) {
    // Not a validation failure — a wiring mistake. Surfacing it as `issues` would let it
    // masquerade as bad model output and quietly render the fallback forever.
    throw new TypeError(
      `Schema from vendor "${schema['~standard'].vendor}" validated asynchronously. Nerey ` +
        `validates during render and cannot await. Remove the async refinement or transform ` +
        `from the schema (ADR 0011).`,
    );
  }

  if (result.issues) {
    return { ok: false, issues: flattenIssues(result.issues) };
  }

  return { ok: true, value: result.value };
}

/**
 * Validates only when a schema is present. An entry without a `payloadSchema` is trusting
 * its producer, which is a legitimate choice for a widget whose payload the same codebase
 * generates — so an absent schema passes the value through rather than failing closed.
 */
export function validateOptional<Output>(
  schema: StandardSchemaV1<unknown, Output> | undefined,
  value: unknown,
): ValidationOutcome<Output> {
  if (!schema) return { ok: true, value: value as Output };
  return validateSync(schema, value);
}
