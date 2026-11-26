/**
 * `@nerey/core/testing` — the widget-authoring conformance kit (FR-38, ADR 0028).
 *
 * Kept on its own subpath rather than in the main barrel: it renders, so it pulls in `react-dom`,
 * and nothing that ships to a user's browser should carry a test harness. A consumer imports it
 * from their own test files only.
 */
export { checkWidgetConformance, expectWidgetConformance } from './conformance';
export type { ConformanceOptions, ConformanceReport, ConformanceViolation } from './conformance';

/**
 * The adapter conformance kit (ADR 0051): the conventions an SDK adapter must keep between its
 * stream and `WidgetRenderer` — no validation while streaming, one on `ready`, the tool-call id
 * round trip, `text` and `createdAt` always set, `type@version` passed through untouched.
 */
export {
  ADAPTER_PROBE_TYPE,
  ADAPTER_PROBE_VERSION,
  checkAdapterConformance,
  expectAdapterConformance,
} from './adapter-conformance';
export type {
  AdapterConformanceReport,
  AdapterDelivery,
  AdapterFrame,
  AdapterHostHarness,
  AdapterScenario,
  AdapterUnderTest,
} from './adapter-conformance';
