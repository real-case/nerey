/**
 * `@nerey/core/testing` — the widget-authoring conformance kit (FR-38, ADR 0028).
 *
 * Kept on its own subpath rather than in the main barrel: it renders, so it pulls in `react-dom`,
 * and nothing that ships to a user's browser should carry a test harness. A consumer imports it
 * from their own test files only.
 */
export { checkWidgetConformance, expectWidgetConformance } from './conformance';
export type { ConformanceOptions, ConformanceReport, ConformanceViolation } from './conformance';
