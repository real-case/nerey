import { act } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { NEREY_ATTR, NEREY_STATES } from '../data-attrs';
import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { NEVER_EXPIRES } from '../lifecycle/expiry';
import { createMemoryPersistence } from '../state/memory-persistence';
import type {
  AnyWidgetRegistryEntry,
  WidgetComponent,
  WidgetHostValue,
  WidgetInteractionHandler,
} from '../types';
import { flattenIssues } from '../validate';
import type { FlatIssue } from '../validate';

/**
 * FR-38 / AC-22 — the widget-authoring conformance kit.
 *
 * Nerey's contracts are almost all *conventions a widget must keep*, not APIs it must call: emit
 * the ADR 0020 attributes, honour `readonly`, declare a reachable lifecycle, reject a payload the
 * model got wrong, perform no I/O. None of that can be enforced by a type, because a widget that
 * ignores every one of them still compiles. This module is what turns those conventions into a
 * failing test in the widget author's own repository.
 *
 * Two deliberate shapes:
 *
 * `checkWidgetConformance` returns a report and never throws for a rule failure, so a caller can
 * run the whole catalog and print one table instead of discovering violations one `expect` at a
 * time. `expectWidgetConformance` is the thin assertion on top for the common case.
 *
 * Every rule reports a *named* violation. AC-22 requires this kit to fail on a seeded violation of
 * each rule it checks (ADR 0033), and a test can only assert "this rule fired" if the rule has a
 * name — a boolean pass/fail would let a kit that only ever checks one thing look complete.
 */

export type ConformanceViolation = { rule: string; detail: string };

export type ConformanceReport = {
  /** `type@version`, as the registry would key it. */
  entry: string;
  passed: boolean;
  violations: ConformanceViolation[];
};

export type ConformanceOptions = {
  /** A payload the entry's schema must accept. */
  validPayload: unknown;
  /** Payloads the entry's schema must REJECT. Omit only if the entry has no payloadSchema. */
  invalidPayloads?: readonly unknown[];
  /** Initial state to render with. */
  state?: unknown;
  /** Source text of the widget module, for the static I/O check. */
  source?: string;
};

const CONVERSATION_ID = 'nerey-conformance';
const MESSAGE_ID = 'nerey-conformance-message';

/* ────────────────────────────────────────────────────────────────────────────────────
 * Small shared helpers
 * ──────────────────────────────────────────────────────────────────────────────────── */

type Report = (rule: string, detail: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/** Enough of a value to make a violation actionable without dumping a payload into the message. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  // Only the primitives whose `String()` form is informative are printed. A function or a plain
  // object stringifies to noise ('[object Object]', a whole source body), and a violation message
  // nobody can read is a violation nobody fixes.
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${typeof value} \`${String(value)}\``;
  }
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'symbol') return 'a symbol';
  return 'an object';
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function formatIssues(issues: readonly FlatIssue[]): string {
  if (issues.length === 0) return 'the schema returned no issue detail';
  return issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join('; ');
}

function nameOf(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value : '?';
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Rule 1 — identity
 * ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * `>=`, `^1`, `~1.2`, `*`, `1 || 2`. Any of these means the author expected the registry to
 * interpret the string; it does not (ADR 0009).
 */
const RANGE_SYNTAX = /[\^~*<>=|\s]/;

function checkIdentity(entry: AnyWidgetRegistryEntry, report: Report): void {
  const type: unknown = entry.type;
  const version: unknown = entry.version;

  if (typeof type !== 'string' || type.trim() === '') {
    report(
      'identity',
      `\`type\` must be a non-empty string; received ${describeValue(type)}. It is half of the ` +
        `registry key, so an entry without one can be registered but never resolved (ADR 0009).`,
    );
  }

  if (typeof version !== 'string' || version.trim() === '') {
    report(
      'identity',
      `\`version\` must be a non-empty string; received ${describeValue(version)}. It is the other ` +
        `half of the registry key (ADR 0009).`,
    );
    return;
  }

  if (/^v\d/i.test(version)) {
    report(
      'identity',
      `\`version\` is "${version}". Resolution compares the envelope's version to this string ` +
        `character for character (ADR 0009), so the leading \`v\` means every payload carrying ` +
        `"${version.slice(1)}" degrades to \`unknown-widget\` — which reads in the UI as a missing ` +
        `widget rather than as a version mismatch.`,
    );
  }

  if (RANGE_SYNTAX.test(version)) {
    report(
      'identity',
      `\`version\` is "${version}", which reads as a semver range. An entry declares the one ` +
        `version it implements; ranged resolution is opt-in per entry through \`acceptsVersion\` ` +
        `and is never inferred from the version string (ADR 0009).`,
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Rules 2–4 — schema
 * ──────────────────────────────────────────────────────────────────────────────────── */

type Probe =
  | { kind: 'accepted'; value: unknown }
  | { kind: 'rejected'; issues: readonly FlatIssue[] }
  | { kind: 'async' }
  | { kind: 'threw'; error: unknown };

/**
 * Runs a Standard Schema and classifies the four things that can come back.
 *
 * `validateSync` is deliberately not reused here. It collapses "validated asynchronously" into a
 * thrown TypeError, which is the right behaviour for the render path — but this kit has to tell
 * `schema-is-sync` apart from `schema-accepts-valid`, and recovering that distinction from an
 * error message would couple the kit to that message's wording.
 */
function probe(schema: StandardSchemaV1<unknown, unknown>, value: unknown): Probe {
  let result: StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>;
  try {
    result = schema['~standard'].validate(value);
  } catch (error) {
    return { kind: 'threw', error };
  }

  if (result instanceof Promise) {
    // Attached so an async schema that also *rejects* does not tear down the test run with an
    // unhandled rejection while this report is still being assembled.
    void result.catch(() => undefined);
    return { kind: 'async' };
  }

  if (result.issues) return { kind: 'rejected', issues: flattenIssues(result.issues) };
  return { kind: 'accepted', value: result.value };
}

/**
 * Returns the payload to render with: the schema's *output* when it accepted one, because that is
 * what the widget receives in production (the renderer validates before mounting), and a schema
 * that rebuilds its value key by key hands the component something different from the fixture.
 */
function checkSchemas(entry: AnyWidgetRegistryEntry, options: ConformanceOptions, report: Report): unknown {
  const payloadSchema: StandardSchemaV1<unknown, unknown> | undefined = entry.payloadSchema;
  const stateSchema: StandardSchemaV1<unknown, unknown> | undefined = entry.stateSchema;
  const invalidPayloads = options.invalidPayloads ?? [];

  /** Inputs for which some schema returned a Promise, named so the diagnostic can point at one. */
  const asyncInputs: string[] = [];
  let payload = options.validPayload;

  if (payloadSchema) {
    const valid = probe(payloadSchema, options.validPayload);
    if (valid.kind === 'accepted') payload = valid.value;
    else if (valid.kind === 'rejected') {
      report(
        'schema-accepts-valid',
        `\`payloadSchema\` rejected \`validPayload\` — ${formatIssues(valid.issues)}. The fixture ` +
          `and the schema disagree, and until they agree every other rule here is being checked ` +
          `against a payload the widget would never be handed.`,
      );
    } else if (valid.kind === 'threw') {
      report(
        'schema-accepts-valid',
        `\`payloadSchema\` threw on \`validPayload\` — ${describeError(valid.error)}. A Standard ` +
          `Schema reports failure by returning \`issues\`, never by throwing (ADR 0011); a throw ` +
          `escapes the degradation chain and takes the transcript down with it (ADR 0012).`,
      );
    } else asyncInputs.push('validPayload');

    if (invalidPayloads.length === 0) {
      report(
        'schema-rejects-invalid',
        `the entry declares a \`payloadSchema\` but no \`invalidPayloads\` were supplied, so ` +
          `nothing here proves the schema refuses anything. Supply at least one payload it must ` +
          `reject — an unproven schema and a decorative one are indistinguishable.`,
      );
    }

    invalidPayloads.forEach((candidate, index) => {
      const outcome = probe(payloadSchema, candidate);
      if (outcome.kind === 'accepted') {
        report(
          'schema-rejects-invalid',
          `\`payloadSchema\` accepted \`invalidPayloads[${index}]\` (${describeValue(candidate)}). ` +
            `A schema that accepts everything is decorative: step 2 of the degradation chain never ` +
            `fires, so malformed model output renders as a broken widget instead of readable text ` +
            `(ADR 0012).`,
        );
      } else if (outcome.kind === 'threw') {
        report(
          'schema-rejects-invalid',
          `\`payloadSchema\` threw on \`invalidPayloads[${index}]\` — ` +
            `${describeError(outcome.error)}. Rejection is a returned \`issues\` list, not an ` +
            `exception (ADR 0011).`,
        );
      } else if (outcome.kind === 'async') asyncInputs.push(`invalidPayloads[${index}]`);
    });
  }

  // The state schema runs on the same render pass as the payload schema, so it is subject to the
  // same synchronous constraint. It is only probed when there is a state to probe it with: an
  // absent `state` is a legitimate fixture, not a missing one.
  if (stateSchema && options.state !== undefined) {
    if (probe(stateSchema, options.state).kind === 'async') asyncInputs.push('state');
  }

  if (asyncInputs.length > 0) {
    report(
      'schema-is-sync',
      `validation returned a Promise for ${asyncInputs.join(', ')}. Nerey validates during React's ` +
        `render phase and cannot await (ADR 0011) — a pending Promise is not a result, and ` +
        `\`validateSync\` throws rather than letting one masquerade as success. Remove the async ` +
        `refinement or transform.`,
    );
  }

  return payload;
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Rules 5–7 — the rendered widget
 * ──────────────────────────────────────────────────────────────────────────────────── */

type SentMessage = { text: string; meta?: Record<string, unknown> };

type Mounted = {
  container: HTMLElement;
  /** Everything the widget pushed out through `onInteraction` → `sendUserMessage` (ADR 0014). */
  sent: SentMessage[];
  /** What the component threw while rendering, if anything. */
  thrown: unknown;
  unmount: () => Promise<void>;
};

/**
 * The harness a widget under test is mounted in: a real `WidgetHostProvider` over a recording
 * `sendUserMessage` and an in-memory persistence port. Nothing is stubbed with a bare object —
 * the widget must see the same context shape it sees in an application, or the kit proves the
 * widget conforms to the mock rather than to Nerey.
 */
function MockWidgetHost(props: { host: WidgetHostValue; children: ReactNode }): ReactElement {
  return <WidgetHostProvider value={props.host}>{props.children}</WidgetHostProvider>;
}

function createMockHost(sent: SentMessage[]): WidgetHostValue {
  return {
    ...DEFAULT_HOST_VALUE,
    conversationId: CONVERSATION_ID,
    sendUserMessage: (text, meta) => {
      sent.push(meta === undefined ? { text } : { text, meta });
    },
    persistence: createMemoryPersistence(),
  };
}

/**
 * `act` with a callback that returns a promise, so React flushes effects *and* drains the
 * microtask queue. Written as a promise-returning arrow rather than an `async` one because the
 * body has nothing to await — an `async` wrapper here would be a lint error with no behaviour
 * attached to it.
 */
function flush(work: () => void): Promise<void> {
  return act(() => {
    work();
    return Promise.resolve();
  });
}

const ACT_ENV = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };

async function mountWidget(
  entry: AnyWidgetRegistryEntry,
  payload: unknown,
  state: unknown,
  readonly: boolean,
): Promise<Mounted> {
  const sent: SentMessage[] = [];
  const host = createMockHost(sent);

  // The generics on `AnyWidgetRegistryEntry` are erased to `never`, which leaves the component's
  // props unassignable from outside. The renderer widens the same way (ADR 0010) — to `unknown`
  // and not `any`, because the values handed over have already been through the entry's schemas.
  const Widget = entry.component as unknown as WidgetComponent<unknown, unknown>;

  const container = document.createElement('div');
  document.body.appendChild(container);

  let thrown: unknown;
  const previousActEnv = ACT_ENV.IS_REACT_ACT_ENVIRONMENT;
  ACT_ENV.IS_REACT_ACT_ENVIRONMENT = true;

  const root = createRoot(container, {
    // React's default for an uncaught render error is to log it to `console.error` and unmount
    // the root. Both are wrong here: the kit reports the throw as the `renders` violation, and a
    // conformance run that also spews React's own error log is a run people stop reading.
    onUncaughtError: (error: unknown) => {
      thrown ??= error;
    },
    onCaughtError: (error: unknown) => {
      thrown ??= error;
    },
    onRecoverableError: () => undefined,
  });

  const onInteraction: WidgetInteractionHandler = (_action, data) => {
    // ADR 0014 — the host's whole job on an interaction is to send the text. Modelling that here
    // is what makes `readonly-is-inert` observable as "no message left the widget", which is the
    // consequence that actually matters: a second message means a second model turn.
    host.sendUserMessage(data.text, data.meta);
  };

  try {
    await flush(() => {
      root.render(
        <MockWidgetHost host={host}>
          <Widget
            messageId={MESSAGE_ID}
            payload={payload}
            state={state}
            readonly={readonly}
            status="ready"
            onInteraction={onInteraction}
          />
        </MockWidgetHost>,
      );
    });
  } catch (error) {
    thrown ??= error;
  }

  const unmount = async (): Promise<void> => {
    try {
      await flush(() => {
        root.unmount();
      });
    } catch {
      // A root React already tore down after an uncaught error rejects a second unmount. There is
      // nothing left to clean up and nothing worth reporting: the throw is already a violation.
    }
    container.remove();
    if (previousActEnv === undefined) delete ACT_ENV.IS_REACT_ACT_ENVIRONMENT;
    else ACT_ENV.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
  };

  return { container, sent, thrown, unmount };
}

const REQUIRED_ROOT_ATTRS = [
  NEREY_ATTR.widget,
  NEREY_ATTR.version,
  NEREY_ATTR.slot,
  NEREY_ATTR.status,
] as const;

function elementLabel(element: Element): string {
  const part = element.getAttribute(NEREY_ATTR.part);
  return part === null ? `<${element.localName}>` : `<${element.localName} ${NEREY_ATTR.part}="${part}">`;
}

function checkDataContract(entry: AnyWidgetRegistryEntry, container: HTMLElement, report: Report): void {
  const root = container.firstElementChild;

  if (root === null) {
    report(
      'data-contract',
      `the component rendered no element. A widget's root is the only styling seam a consumer ` +
        `gets — @nerey/core ships no CSS to make up for its absence (ADR 0020).`,
    );
    return;
  }

  const missing = REQUIRED_ROOT_ATTRS.filter((name) => {
    const value = root.getAttribute(name);
    return value === null || value === '';
  });

  if (missing.length > 0) {
    const deeper = container.querySelector(`[${NEREY_ATTR.widget}]`);
    const hint =
      deeper !== null && deeper !== root
        ? ` A node deeper in the subtree (${elementLabel(deeper)}) does carry them; they belong on ` +
          `the OUTERMOST node, because that is what a consumer's \`[${NEREY_ATTR.widget}='...']\` ` +
          `selector positions and sizes.`
        : ` Render through \`<WidgetRoot>\`, or spread \`widgetRootAttributes()\` onto your own root.`;
    report('data-contract', `the widget root ${elementLabel(root)} is missing ${missing.join(', ')}.${hint}`);
  }

  const placement: unknown = entry.placement;
  const expected: readonly [string, unknown][] = [
    [NEREY_ATTR.widget, entry.type],
    [NEREY_ATTR.version, entry.version],
    [NEREY_ATTR.slot, isRecord(placement) ? placement['slot'] : undefined],
    [NEREY_ATTR.status, 'ready'],
  ];

  for (const [name, want] of expected) {
    const got = root.getAttribute(name);
    // Only compared when both sides are actually there. An absent attribute is already reported
    // above, and an entry whose own `type` or `placement` is missing has a defect the `identity`
    // and `lifecycle-declared` rules name precisely — reporting it a second time here as a
    // "mismatch" would bury the real diagnosis under a cascade.
    if (got === null || got === '' || typeof want !== 'string' || want === '') continue;
    if (got !== want) {
      report(
        'data-contract',
        `the widget root declares ${name}="${got}" but the entry says "${String(want)}". The ` +
          `attributes are what a consumer selects on and what devtools read back; a root that ` +
          `announces coordinates the registry does not hold is a widget nobody can style by name ` +
          `(ADR 0020).`,
      );
    }
  }

  const stateful = [root, ...root.querySelectorAll(`[${NEREY_ATTR.state}]`)];
  for (const element of stateful) {
    const value = element.getAttribute(NEREY_ATTR.state);
    if (value === null) continue;
    if (!isMember(NEREY_STATES, value)) {
      report(
        'data-contract',
        `${elementLabel(element)} carries \`${NEREY_ATTR.state}="${value}"\`, which is outside the ` +
          `documented vocabulary (${NEREY_STATES.join(' | ')}). The value set is closed on purpose ` +
          `(ADR 0020): a consumer writes one selector per documented state, so an invented value ` +
          `is a state nobody can style and nobody knows exists.`,
      );
    }
  }
}

async function clickEveryButton(container: HTMLElement): Promise<void> {
  // `HTMLElement.click()` and not a hand-built MouseEvent: the HTML spec makes `click()` a no-op
  // on a disabled form control, which is exactly the affordance a read-only widget is supposed to
  // have. Dispatching the event by hand would bypass the very thing under test and turn every
  // correctly-disabled widget into a false failure.
  for (const button of Array.from(container.querySelectorAll('button'))) {
    await flush(() => {
      button.click();
    });
  }
}

async function checkRendering(
  entry: AnyWidgetRegistryEntry,
  payload: unknown,
  options: ConformanceOptions,
  report: Report,
): Promise<void> {
  const component: unknown = entry.component;
  if (typeof component !== 'function' && !isRecord(component)) {
    report('renders', `\`component\` must be a React component; received ${describeValue(component)}.`);
    return;
  }

  if (typeof document === 'undefined') {
    throw new TypeError(
      'checkWidgetConformance needs a DOM. Run it under jsdom or a browser environment — the ' +
        '`renders`, `data-contract` and `readonly-is-inert` rules all assert against real markup.',
    );
  }

  const live = await mountWidget(entry, payload, options.state, false);
  try {
    if (live.thrown !== undefined) {
      report(
        'renders',
        `the component threw while rendering — ${describeError(live.thrown)}. A widget that throws ` +
          `is caught by the error boundary and replaced with the message's plain text (ADR 0012), ` +
          `so in an application this failure is invisible except as a silently missing widget.`,
      );
      return;
    }
    checkDataContract(entry, live.container, report);
  } finally {
    await live.unmount();
  }

  const inert = await mountWidget(entry, payload, options.state, true);
  try {
    if (inert.thrown !== undefined) {
      report(
        'renders',
        `the component threw while rendering with \`readonly: true\` — ` +
          `${describeError(inert.thrown)}. Read-only is not an edge case: an expired widget ` +
          `renders that way on every reload of the transcript (ADR 0018).`,
      );
      return;
    }

    await clickEveryButton(inert.container);

    if (inert.sent.length > 0) {
      const texts = inert.sent.map((message) => JSON.stringify(message.text)).join(', ');
      report(
        'readonly-is-inert',
        `clicking the rendered buttons while \`readonly: true\` sent ${inert.sent.length} ` +
          `message(s) (${texts}). A read-only widget is a widget whose side effect has already ` +
          `happened — the reply is in the transcript and the agent has answered it — so a second ` +
          `send duplicates an answer and starts a second model turn (ADR 0018 / FR-24). Disable ` +
          `the control AND re-check \`readonly\` in the handler: \`render\` lets a consumer ` +
          `substitute their own button (ADR 0021), and a substitute that forgets \`disabled\` ` +
          `must still not be able to send.`,
      );
    }
  } finally {
    await inert.unmount();
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Rule 8 — lifecycle
 * ──────────────────────────────────────────────────────────────────────────────────── */

const PERSIST_VALUES = ['forever', 'ephemeral'] as const;
const AFTER_EXPIRY_VALUES = ['snapshot', 'fallback', 'hide'] as const;
const EXPIRY_TRIGGERS = ['interact', 'timeout', 'message', 'navigate', 'event'] as const;

function checkExpiryRule(rule: unknown, index: number, report: Report): void {
  if (!isRecord(rule) || !isMember(EXPIRY_TRIGGERS, rule['on'])) {
    report(
      'lifecycle-declared',
      `\`expiry[${index}]\` is not a recognised rule (expected \`on\` to be one of ` +
        `${EXPIRY_TRIGGERS.join(' | ')}); received ${describeValue(rule)}. An unrecognised rule ` +
        `never fires, which reads in the UI as a widget that simply stays interactive (ADR 0018).`,
    );
    return;
  }

  if (rule['on'] === 'timeout') {
    const ms = rule['ms'];
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
      report(
        'lifecycle-declared',
        `\`expiry[${index}]\` is a timeout with \`ms\` = ${describeValue(ms)}. The runtime treats a ` +
          `non-positive or non-finite deadline as already elapsed (ADR 0018), so this widget is ` +
          `born expired.`,
      );
    }
  }

  if (rule['on'] === 'event') {
    const name = rule['name'];
    if (typeof name !== 'string' || name.trim() === '') {
      report(
        'lifecycle-declared',
        `\`expiry[${index}]\` is an event rule with \`name\` = ${describeValue(name)}. The host ` +
          `fires events by name; an unnamed one can never be matched (ADR 0018).`,
      );
    }
  }
}

function checkLifecycle(entry: AnyWidgetRegistryEntry, report: Report): void {
  const lifecycle: unknown = entry.lifecycle;

  if (!isRecord(lifecycle)) {
    report(
      'lifecycle-declared',
      `\`lifecycle\` must be an object with \`persist\`, \`expiry\` and \`afterExpiry\`; received ` +
        `${describeValue(lifecycle)}. The runtime reads it on every render (ADR 0018).`,
    );
    return;
  }

  const persist = lifecycle['persist'];
  if (!isMember(PERSIST_VALUES, persist)) {
    report(
      'lifecycle-declared',
      `\`lifecycle.persist\` must be one of ${PERSIST_VALUES.join(' | ')}; received ` +
        `${describeValue(persist)} (ADR 0016).`,
    );
  }

  const afterExpiry = lifecycle['afterExpiry'];
  if (!isMember(AFTER_EXPIRY_VALUES, afterExpiry)) {
    report(
      'lifecycle-declared',
      `\`lifecycle.afterExpiry\` must be one of ${AFTER_EXPIRY_VALUES.join(' | ')}; received ` +
        `${describeValue(afterExpiry)} (ADR 0018).`,
    );
  }

  const rawExpiry: unknown = lifecycle['expiry'];
  if (!Array.isArray(rawExpiry)) {
    report(
      'lifecycle-declared',
      `\`lifecycle.expiry\` must be an array of rules (use \`[]\` for a widget that never ` +
        `expires); received ${describeValue(rawExpiry)}.`,
    );
    return;
  }

  const expiry: readonly unknown[] = rawExpiry;
  expiry.forEach((rule, index) => {
    checkExpiryRule(rule, index, report);
  });

  // `NEVER_EXPIRES` is exempt by IDENTITY, not by shape. A widget with nothing to terminate still
  // has to name an `afterExpiry`, and the shared constant answers `'snapshot'` because it is the
  // harmless one — reaching for that named constant is itself the statement that the widget never
  // expires. An inline `{ expiry: [], afterExpiry: 'snapshot' }` is what this rule is looking for:
  // it is what a copy-paste from an interactive widget leaves behind, and it is indistinguishable
  // from an author who meant to expire on interaction and forgot to say so.
  if (lifecycle !== NEVER_EXPIRES && afterExpiry === 'snapshot' && expiry.length === 0) {
    report(
      'lifecycle-declared',
      `declares \`afterExpiry: 'snapshot'\` with an empty \`expiry\`. Nothing can expire this ` +
        `widget, so the snapshot describes a state it never reaches — a copy-paste artefact. Give ` +
        `it the rule that terminates it (\`[{ on: 'interact' }]\` for anything that sends a ` +
        `message), or use the exported \`NEVER_EXPIRES\` to say the widget is permanent on purpose.`,
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Rule 9 — no I/O
 * ──────────────────────────────────────────────────────────────────────────────────── */

const IO_CALLS: readonly { pattern: RegExp; detail: string }[] = [
  {
    pattern: /\bfetch\s*\(/,
    detail:
      'calls `fetch(`. A widget performs no I/O: its only outbound channel is ' +
      '`onInteraction(action, { text })` and its only persistence channel is `useWidgetState` ' +
      '(ADR 0014 / 0015 / 0016).',
  },
  {
    pattern: /\bXMLHttpRequest\b/,
    detail: 'references `XMLHttpRequest`. A widget performs no I/O (ADR 0015).',
  },
  {
    pattern: /\bnew\s+WebSocket\b/,
    detail:
      'opens a `WebSocket`. Transport belongs to the host, not to a widget — Nerey has no ' +
      'opinion about how messages reach you (ADR 0015 / 0037).',
  },
];

const IO_MODULE = /^(axios|ofetch|@tanstack)(\/|$)/;

const IMPORT_SPECIFIER =
  /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function checkNoIo(source: string | undefined, report: Report): void {
  // Skipped rather than failed when no source was supplied. The check is a grep, and a grep this
  // kit was not given anything to run is not evidence of a violation — the honest signal is that
  // the rule did not run, and the lint boundary in `@nerey/eslint-config` covers the same ground
  // at build time regardless (ADR 0015).
  if (source === undefined) return;

  for (const { pattern, detail } of IO_CALLS) {
    const match = pattern.exec(source);
    if (match !== null) {
      report('no-io', `line ${lineOf(source, match.index)} ${detail}`);
    }
  }

  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier === undefined || !IO_MODULE.test(specifier)) continue;
    report(
      'no-io',
      `line ${lineOf(source, match.index)} imports \`${specifier}\`. A widget does not talk to a ` +
        `transport or to the server cache; persistence flows through the \`MessagePersistence\` ` +
        `port the host injects (ADR 0015 / 0016), which is what lets the same widget run in ` +
        `Storybook against an in-memory implementation with no backend at all.`,
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Entry points
 * ──────────────────────────────────────────────────────────────────────────────────── */

/** Runs every conformance rule and returns a report rather than throwing. */
export async function checkWidgetConformance(
  entry: AnyWidgetRegistryEntry,
  options: ConformanceOptions,
): Promise<ConformanceReport> {
  const violations: ConformanceViolation[] = [];
  const report: Report = (rule, detail) => {
    violations.push({ rule, detail });
  };

  checkIdentity(entry, report);
  // The payload the render rules use is whatever survived validation, so the component is mounted
  // with the value the renderer would have handed it rather than with the raw fixture.
  const payload = checkSchemas(entry, options, report);
  await checkRendering(entry, payload, options, report);
  checkLifecycle(entry, report);
  checkNoIo(options.source, report);

  return {
    entry: `${nameOf(entry.type)}@${nameOf(entry.version)}`,
    passed: violations.length === 0,
    violations,
  };
}

/** Vitest-friendly wrapper: throws with a readable multi-line message on any violation. */
export async function expectWidgetConformance(
  entry: AnyWidgetRegistryEntry,
  options: ConformanceOptions,
): Promise<void> {
  const result = await checkWidgetConformance(entry, options);
  if (result.passed) return;

  const count = result.violations.length;
  const body = result.violations.map((violation) => `  [${violation.rule}] ${violation.detail}`);

  // Every violation is listed, not just the first. A widget that fails conformance usually fails
  // it in several places at once — the same missing `<WidgetRoot>` breaks three rules — and one
  // assertion per run would turn a single fix into four red-green cycles.
  throw new Error(
    `Widget \`${result.entry}\` failed ${count} conformance ${count === 1 ? 'rule' : 'rules'}:\n\n` +
      `${body.join('\n\n')}\n`,
  );
}
