/**
 * @nerey/theme — the reference visual layer for @nerey/core.
 *
 * ADR 0028: this is the only JavaScript entry point. The two stylesheets are separate exports
 * because they are separately useful — a Storybook preview or a design-token audit wants
 * `tokens.css` alone, and a consumer who has written their own components against the `data-*`
 * contract (ADR 0020) may want neither:
 *
 *     import '@nerey/theme/tokens.css';   // the --nerey-* surface
 *     import '@nerey/theme/theme.css';    // the compiled component styles
 *
 * Order matters only in one direction: `theme.css` reads tokens through `var(--nerey-x, …)` with
 * a mandatory inline fallback, so loading it alone yields a plain but correct component rather
 * than an invisible one (ADR 0024).
 */

/* ── Components ────────────────────────────────────────────────────────────────────── */

export * from './components/index';

/* ── Chrome strings (ADR 0041) ─────────────────────────────────────────────────────── */

/**
 * The seam every chrome string resolves through. A widget cannot take a prop — its props are
 * fixed by `WidgetComponentProps` (ADR 0008 / 0014) — so the strings it renders, and the reply
 * text it sends, reach it through context instead. Mounting the provider is optional; without it
 * the defaults are used, which is the behaviour that existed before the record.
 */
export { defaultNereyLabels, NereyLabelsProvider, useNereyLabels } from './labels/labels';
export type {
  FacetOptionContext,
  NereyLabelOverrides,
  NereyLabels,
  NereyLabelsProviderProps,
  PollDetailsContext,
} from './labels/labels';

/* ── Widgets ───────────────────────────────────────────────────────────────────────── */

export * from './widgets/index';

/* ── Tokens ────────────────────────────────────────────────────────────────────────── */

/**
 * The generated token union. Useful for typing a consumer's own override map so a typo in a
 * custom-property name is a compile error rather than a rule that silently does nothing —
 * which is the failure mode CSS custom properties are worst at surfacing.
 */
export type { NereySemanticToken, NereyToken } from './tokens.generated';
export { NEREY_SEMANTIC_TOKENS, NEREY_TOKENS } from './tokens.generated';
