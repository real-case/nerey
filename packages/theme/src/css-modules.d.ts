/**
 * Ambient fallback for CSS Module imports.
 *
 * `npm run gen:css-types` writes a precise `<name>.module.css.d.ts` next to every stylesheet,
 * and those declarations WIN over this one because a file-specific module declaration beats a
 * wildcard. This exists so `tsc` does not fail with TS2307 in the window between adding a
 * stylesheet and running the generator — and so a fresh clone type-checks before anyone has
 * run a generator at all (ADR 0023).
 *
 * It is deliberately typed loosely. Tightening it to a known key set would defeat the
 * generated declarations, whose entire value is that `styles.typo` is a compile error.
 */
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
