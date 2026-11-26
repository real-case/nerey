import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { NEREY_ATTR } from '../data-attrs';
import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { NEVER_EXPIRES } from '../lifecycle/expiry';
import { createWidgetRegistry } from '../registry';
import { WidgetRenderer } from '../render/widget-renderer';
import { createMemoryPersistence } from '../state/memory-persistence';
import type {
  AnyWidgetRegistryEntry,
  NereyErrorLike,
  NereyMessage,
  WidgetComponentProps,
  WidgetHostValue,
  WidgetRegistry,
  WidgetStatus,
} from '../types';
import type { ConformanceViolation } from './conformance';

/**
 * The adapter conformance kit (ADR 0051, production-ready plan Ф4).
 *
 * An adapter is the code between an SDK's own stream and Nerey's renderer: it turns tool-call
 * events into `NereyMessage`s with a status, and turns a widget's answer back into the SDK's
 * native reply. Every guarantee core makes about streaming and replies holds only if the adapter
 * keeps a handful of conventions, and none of them is visible in a type:
 *
 * - a partial payload is labelled `streaming`, so it is never validated (ADR 0019);
 * - the payload is validated exactly once, on the transition to `ready`;
 * - the tool call's id survives the round trip, so the answer reaches the call it answers (ADR 0048);
 * - `text` is always present, so a widget that cannot render still leaves a readable transcript;
 * - `createdAt` is set and does not move, so a `timeout` deadline does not restart (ADR 0046);
 * - `type@version` is passed through untouched, so the registry's exact match decides (ADR 0009).
 *   An adapter that "helpfully" maps a tool name or `"1.0"` onto a registered `1.0.0` is the most
 *   tempting bug in this design, and the kit plants exactly that payload to catch it.
 *
 * The adapter under test is expressed as an event feed and a projection, not as a particular SDK
 * call, so an adapter that maps whole message snapshots (the AI SDK's `UIMessage`) and one that
 * folds a protocol's event stream (AG-UI) fit the same harness.
 */

/** One rendered state of the tool call under test: what the adapter hands `WidgetRenderer`. */
export type AdapterFrame = { message: NereyMessage; status: WidgetStatus };

/**
 * What the kit asks the adapter to script. The adapter turns it into its own SDK's events: the
 * partial payloads as streaming deltas, then the complete one as the call becoming available.
 */
export type AdapterScenario = {
  /** The SDK's tool-call id. Must come back as `envelope.correlationId` and through `respond`. */
  correlationId: string;
  type: string;
  version: string;
  /** Successive partial payloads, in stream order. Each one fails the probe's schema on purpose. */
  partialPayloads: readonly unknown[];
  /** The complete payload, delivered as the call's input becoming available. */
  payload: unknown;
  /** Epoch ms the SDK reports for the message. An adapter that has no SDK timestamp may ignore it. */
  createdAt: number;
};

/** One reply as it reached the SDK, decoded back by the adapter for the kit to compare. */
export type AdapterDelivery = { correlationId: string; text: string; result?: unknown };

export type AdapterHostHarness = {
  /** The parts of the host the adapter implements; the kit supplies the rest. */
  host: Pick<WidgetHostValue, 'sendUserMessage'> & Partial<Pick<WidgetHostValue, 'respond'>>;
  /** Every reply the adapter's host has delivered to its (recorded) SDK so far, decoded. */
  delivered: () => readonly AdapterDelivery[];
};

export type AdapterUnderTest<TEvent> = {
  /** Shown in the report, e.g. `@nerey/ai-sdk`. */
  name: string;
  /** Turns a scenario into the SDK's events, in order. Pure; called once per scenario. */
  script: (scenario: AdapterScenario) => readonly TEvent[];
  /**
   * Feeds the events through the adapter and returns the frames for the scenario's tool call, one
   * per event that changed it, in order. The registry is the one the kit renders against, for an
   * adapter that needs to look an entry up; looking it up is allowed, validating against it is not.
   */
  frames: (events: readonly TEvent[], context: { registry: WidgetRegistry }) => readonly AdapterFrame[];
  /** A host wired to a recording stand-in for the SDK. Called once per scenario. */
  createHost: () => AdapterHostHarness;
};

export type AdapterConformanceReport = {
  adapter: string;
  passed: boolean;
  violations: ConformanceViolation[];
};

type Report = (rule: string, detail: string) => void;

export const ADAPTER_PROBE_TYPE = 'nerey-adapter-probe';
export const ADAPTER_PROBE_VERSION = '1.0.0';

/** The version the exact-match rule plants: the registered one with its patch dropped. */
const NEAR_MISS_VERSION = '1.0';
const PROBE_CREATED_AT = 1_767_225_600_000; // 2026-01-01T00:00:00Z — fixed, so runs are deterministic.
const PROBE_ANSWER = { text: 'Probe answered', result: { answer: 'yes' } } as const;
const PROBE_ACTION = 'answer';

type ProbePayload = { label: string; options: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProbePayload(value: unknown): value is ProbePayload {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    Array.isArray(value.options) &&
    value.options.every((option) => typeof option === 'string')
  );
}

/**
 * A hand-written Standard Schema rather than a validator: core depends on the spec only (ADR
 * 0011), and the kit has to count calls, which no validator exposes.
 */
function countingSchema<T>(
  vendor: string,
  accepts: (value: unknown) => value is T,
  onValidate: (value: unknown) => void,
): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor,
      validate: (value: unknown) => {
        onValidate(value);
        return accepts(value) ? { value } : { issues: [{ message: `not a ${vendor} value` }] };
      },
    },
  };
}

function ProbeWidget(props: WidgetComponentProps<ProbePayload>): ReactElement {
  const { payload, readonly, onInteraction } = props;
  return (
    <div data-nerey-adapter-probe="">
      <span>{typeof payload.label === 'string' ? payload.label : ''}</span>
      <button
        type="button"
        disabled={readonly}
        onClick={() => {
          onInteraction(PROBE_ACTION, { text: PROBE_ANSWER.text, result: PROBE_ANSWER.result });
        }}
      >
        Answer
      </button>
    </div>
  );
}

type Probe = { entry: AnyWidgetRegistryEntry; validations: unknown[] };

function createProbe(): Probe {
  const validations: unknown[] = [];
  const entry: AnyWidgetRegistryEntry = {
    type: ADAPTER_PROBE_TYPE,
    version: ADAPTER_PROBE_VERSION,
    description: 'A probe the adapter conformance kit renders. Never registered in an application.',
    component: ProbeWidget,
    placement: { slot: 'message' },
    lifecycle: NEVER_EXPIRES,
    payloadSchema: countingSchema('nerey-adapter-probe', isProbePayload, (value) => {
      validations.push(value);
    }),
    resultSchema: countingSchema(
      'nerey-adapter-probe-result',
      (value): value is { answer: string } => isRecord(value) && typeof value.answer === 'string',
      () => undefined,
    ),
  };
  return { entry, validations };
}

function scenario(correlationId: string, version: string): AdapterScenario {
  return {
    correlationId,
    type: ADAPTER_PROBE_TYPE,
    version,
    // Each partial fails the probe's schema: `{}` has no label, the second no options. A frame that
    // is validated while streaming therefore shows up twice, as a count and as a fallback.
    partialPayloads: [{}, { label: 'Pro' }],
    payload: { label: 'Probe', options: ['yes', 'no'] },
    createdAt: PROBE_CREATED_AT,
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Rendering harness
 * ──────────────────────────────────────────────────────────────────────────────────── */

const ACT_ENV = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };

function flush(work: () => void): Promise<void> {
  return act(() => {
    work();
    return Promise.resolve();
  });
}

type Stage = {
  container: HTMLElement;
  errors: NereyErrorLike[];
  render: (frame: AdapterFrame) => Promise<void>;
  click: () => Promise<boolean>;
  unmount: () => Promise<void>;
};

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function createStage(
  registry: WidgetRegistry,
  adapterHost: AdapterHostHarness['host'],
  report: Report,
): Stage {
  const errors: NereyErrorLike[] = [];
  const host: WidgetHostValue = {
    ...DEFAULT_HOST_VALUE,
    conversationId: 'nerey-adapter-conformance',
    persistence: createMemoryPersistence(),
    registry,
    now: () => PROBE_CREATED_AT,
    onWidgetError: (error) => {
      errors.push(error);
    },
    ...adapterHost,
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const previousActEnv = ACT_ENV.IS_REACT_ACT_ENVIRONMENT;
  ACT_ENV.IS_REACT_ACT_ENVIRONMENT = true;

  const root = createRoot(container, {
    onUncaughtError: (error: unknown) => {
      report('renders', `rendering a frame threw — ${describeError(error)}`);
    },
    onCaughtError: () => undefined,
    onRecoverableError: () => undefined,
  });

  return {
    container,
    errors,
    render: (frame) =>
      flush(() => {
        root.render(
          <WidgetHostProvider value={host}>
            <WidgetRenderer message={frame.message} status={frame.status} />
          </WidgetHostProvider>,
        );
      }),
    click: async () => {
      const button = container.querySelector<HTMLButtonElement>('[data-nerey-adapter-probe] button');
      if (!button) return false;
      await flush(() => {
        button.click();
      });
      return true;
    },
    unmount: async () => {
      try {
        await flush(() => {
          root.unmount();
        });
      } catch {
        // Already torn down after an uncaught error; the throw is reported as `renders`.
      }
      container.remove();
      if (previousActEnv === undefined) delete ACT_ENV.IS_REACT_ACT_ENVIRONMENT;
      else ACT_ENV.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Rules
 * ──────────────────────────────────────────────────────────────────────────────────── */

function project<TEvent>(
  adapter: AdapterUnderTest<TEvent>,
  input: AdapterScenario,
  registry: WidgetRegistry,
  report: Report,
): readonly AdapterFrame[] | undefined {
  let frames: readonly AdapterFrame[];
  try {
    frames = adapter.frames(adapter.script(input), { registry });
  } catch (error) {
    report('frames-produced', `scripting or projecting the scenario threw — ${describeError(error)}`);
    return undefined;
  }
  if (frames.length === 0) {
    report('frames-produced', 'the adapter produced no frame for the scripted tool call');
    return undefined;
  }
  return frames;
}

function checkFrameShape(frames: readonly AdapterFrame[], input: AdapterScenario, report: Report): void {
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last) return;

  frames.forEach((frame, index) => {
    if (typeof frame.message.text !== 'string') {
      report(
        'text-present',
        `frame ${index} has no \`text\` string; the transcript has nothing to fall back to`,
      );
    }
    if (!Number.isFinite(frame.message.createdAt)) {
      report('created-at', `frame ${index} has no finite \`createdAt\` (ADR 0046)`);
    } else if (frame.message.createdAt !== first.message.createdAt) {
      report(
        'created-at',
        `\`createdAt\` moved from ${first.message.createdAt} to ${frame.message.createdAt} at frame ${index}; ` +
          'a moving anchor restarts every `timeout` deadline (ADR 0046)',
      );
    }
    if (frame.message.id !== first.message.id) {
      report('stable-id', `the message id changed at frame ${index}; lifecycle and state are keyed on it`);
    }
  });

  if (last.message.text.trim() === '') {
    report(
      'text-present',
      'the ready frame has an empty `text`; a widget that cannot render leaves nothing readable',
    );
  }

  const streaming = frames.slice(0, -1);
  if (input.partialPayloads.length > 0 && streaming.length === 0) {
    report('streams-partials', 'no `streaming` frame was produced for the scripted partial payloads');
  }
  streaming.forEach((frame, index) => {
    if (frame.status !== 'streaming') {
      report(
        'streams-partials',
        `frame ${index} carries a partial payload but has status \`${frame.status}\`; only \`streaming\` ` +
          'skips validation (ADR 0019)',
      );
    }
  });
  if (last.status !== 'ready') {
    report('ready-on-available', `the final frame has status \`${last.status}\`, not \`ready\``);
  }

  const envelope = last.message.widget ?? undefined;
  if (!envelope) {
    report('carries-envelope', 'the ready frame carries no widget envelope');
    return;
  }
  if (envelope.type !== input.type || envelope.version !== input.version) {
    report(
      'exact-type-version',
      `the envelope says \`${envelope.type}@${envelope.version}\` for a call scripted as ` +
        `\`${input.type}@${input.version}\`; an adapter passes both through untouched (ADR 0009)`,
    );
  }
  if (envelope.correlationId !== input.correlationId) {
    report(
      'correlation-round-trip',
      `the envelope's \`correlationId\` is ${JSON.stringify(envelope.correlationId)}, not the tool-call id ` +
        `${JSON.stringify(input.correlationId)} (ADR 0048)`,
    );
  }
}

async function checkHappyPath<TEvent>(adapter: AdapterUnderTest<TEvent>, report: Report): Promise<void> {
  const probe = createProbe();
  const registry = createWidgetRegistry([probe.entry]);
  const input = scenario('call-probe-1', ADAPTER_PROBE_VERSION);

  const frames = project(adapter, input, registry, report);
  if (probe.validations.length > 0) {
    report(
      'no-validation-while-streaming',
      `the adapter validated the payload ${probe.validations.length} time(s) itself; validation belongs to ` +
        'the renderer, once, on `ready`',
    );
  }
  if (!frames) return;
  checkFrameShape(frames, input, report);

  const harness = adapter.createHost();
  const stage = createStage(registry, harness.host, report);
  try {
    for (const frame of frames) {
      const before = probe.validations.length;
      await stage.render(frame);
      if (frame.status === 'streaming' && probe.validations.length > before) {
        report('no-validation-while-streaming', 'a `streaming` frame was validated (ADR 0019)');
      }
    }

    const ready = probe.validations.length;
    if (ready !== 1) {
      report(
        'validates-once-on-ready',
        `the payload was validated ${ready} times across the stream; it must be exactly once, on \`ready\``,
      );
    }
    const fallback = stage.container.querySelector(`[${NEREY_ATTR.fallback}]`);
    if (fallback) {
      report(
        'renders-widget',
        `the ready frame rendered a fallback (\`${fallback.getAttribute(NEREY_ATTR.fallback) ?? ''}\`) ` +
          'instead of the probe widget',
      );
    }

    if (!harness.host.respond) {
      report(
        'correlation-round-trip',
        'the adapter host has no `respond`, so a tool call can never be answered',
      );
      return;
    }
    if (!(await stage.click())) {
      report('correlation-round-trip', 'the probe widget did not render, so its answer could not be sent');
      return;
    }
    const delivered = harness.delivered();
    const reply = delivered.find((entry) => entry.correlationId === input.correlationId);
    if (!reply) {
      report(
        'correlation-round-trip',
        `the answer did not reach the SDK under tool-call id ${JSON.stringify(input.correlationId)}; ` +
          `delivered: ${JSON.stringify(delivered)}`,
      );
      return;
    }
    if (reply.text !== PROBE_ANSWER.text) {
      report('reply-text', `the reply's text is ${JSON.stringify(reply.text)}, not the widget's own words`);
    }
    if (JSON.stringify(reply.result) !== JSON.stringify(PROBE_ANSWER.result)) {
      report(
        'reply-result',
        `the reply's validated result was ${JSON.stringify(reply.result)}, not passed through`,
      );
    }
  } finally {
    await stage.unmount();
  }
}

async function checkNearMiss<TEvent>(adapter: AdapterUnderTest<TEvent>, report: Report): Promise<void> {
  const probe = createProbe();
  const registry = createWidgetRegistry([probe.entry]);
  const input = scenario('call-probe-near-miss', NEAR_MISS_VERSION);

  const frames = project(adapter, input, registry, report);
  const last = frames?.[frames.length - 1];
  if (!last) return;

  const harness = adapter.createHost();
  const stage = createStage(registry, harness.host, report);
  try {
    await stage.render(last);
    const rendered = stage.container.querySelector('[data-nerey-adapter-probe]');
    const fallback = stage.container.querySelector(`[${NEREY_ATTR.fallback}="unknown-widget"]`);
    if (rendered || !fallback) {
      report(
        'exact-type-version',
        `a payload carrying \`${ADAPTER_PROBE_TYPE}@${NEAR_MISS_VERSION}\` rendered the entry registered as ` +
          `\`${ADAPTER_PROBE_VERSION}\`; it must fall back as \`unknown-widget\` (ADR 0009)`,
      );
    }
    if (!stage.errors.some((error) => error.code === 'unknown-widget')) {
      report(
        'exact-type-version',
        'the near-miss version did not report an `unknown-widget` error (ADR 0013)',
      );
    }
  } finally {
    await stage.unmount();
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Entry points
 * ──────────────────────────────────────────────────────────────────────────────────── */

/** Runs every adapter rule and returns a report rather than throwing. */
export async function checkAdapterConformance<TEvent>(
  adapter: AdapterUnderTest<TEvent>,
): Promise<AdapterConformanceReport> {
  const violations: ConformanceViolation[] = [];
  const report: Report = (rule, detail) => {
    violations.push({ rule, detail });
  };

  await checkHappyPath(adapter, report);
  await checkNearMiss(adapter, report);

  return { adapter: adapter.name, passed: violations.length === 0, violations };
}

/** Vitest-friendly wrapper: throws with every violation listed. */
export async function expectAdapterConformance<TEvent>(adapter: AdapterUnderTest<TEvent>): Promise<void> {
  const result = await checkAdapterConformance(adapter);
  if (result.passed) return;
  const count = result.violations.length;
  const body = result.violations.map((violation) => `  [${violation.rule}] ${violation.detail}`);
  throw new Error(
    `Adapter \`${result.adapter}\` failed ${count} conformance ${count === 1 ? 'rule' : 'rules'}:\n\n` +
      `${body.join('\n\n')}\n`,
  );
}
