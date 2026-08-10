/**
 * Joins class names, dropping anything falsy.
 *
 * Nerey does not depend on `clsx`. The theme's needs are exactly this: a variadic join with
 * falsy filtering, no object syntax, no array flattening, no conditional-key form. Taking a
 * dependency for six lines puts it in every consumer's install graph and in every audit
 * report, which is a poor trade for syntax nobody here uses.
 */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    out = out ? `${out} ${part}` : part;
  }
  return out;
}
