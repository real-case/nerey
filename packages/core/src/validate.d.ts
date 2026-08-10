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
export type FlatIssue = {
  path: string;
  message: string;
};
export type ValidationOutcome<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      issues: readonly FlatIssue[];
    };
/** `["user","tags",1]` → `user.tags[1]`. Array indices read better bracketed. */
export declare function formatIssuePath(path: readonly unknown[] | undefined): string;
export declare function flattenIssues(issues: readonly StandardSchemaV1.Issue[]): FlatIssue[];
/**
 * Runs a Standard Schema synchronously and returns a discriminated outcome rather than
 * throwing. Nerey's degradation chain (ADR 0012) treats an invalid payload as an expected
 * branch, not an exception — throwing here would only mean catching one line later.
 */
export declare function validateSync<Input, Output>(
  schema: StandardSchemaV1<Input, Output>,
  value: unknown,
): ValidationOutcome<Output>;
/**
 * Validates only when a schema is present. An entry without a `payloadSchema` is trusting
 * its producer, which is a legitimate choice for a widget whose payload the same codebase
 * generates — so an absent schema passes the value through rather than failing closed.
 */
export declare function validateOptional<Output>(
  schema: StandardSchemaV1<unknown, Output> | undefined,
  value: unknown,
): ValidationOutcome<Output>;
//# sourceMappingURL=validate.d.ts.map
