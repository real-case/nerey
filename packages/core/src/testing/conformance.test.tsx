import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReactElement } from 'react';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { EXPIRE_ON_INTERACT, NEVER_EXPIRES } from '../lifecycle/expiry';
import { WidgetRoot } from '../primitives/widget-root';
import { asAnyWidget, defineWidget } from '../registry';
import type { AnyWidgetRegistryEntry, WidgetComponentProps } from '../types';
import { confirmationWidget } from '../widgets/confirmation';
import { textWidget } from '../widgets/text';
import { checkWidgetConformance, expectWidgetConformance } from './conformance';
import type { ConformanceOptions } from './conformance';

/* ────────────────────────────────────────────────────────────────────────────────────
 * A conforming widget, and the machinery to break it one rule at a time
 * ──────────────────────────────────────────────────────────────────────────────────── */

type Payload = { label: string };
type State = Record<string, never>;
type Props = WidgetComponentProps<Payload, State>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const labelSchema: StandardSchemaV1<unknown, Payload> = {
  '~standard': {
    version: 1,
    vendor: 'nerey-conformance-test',
    validate(value): StandardSchemaV1.Result<Payload> {
      if (!isRecord(value) || typeof value['label'] !== 'string') {
        return { issues: [{ path: ['label'], message: '`label` must be a string.' }] };
      }
      return { value: { label: value['label'] } };
    },
  },
};

function OkWidget({ payload, readonly, status, onInteraction }: Props): ReactElement {
  return (
    <WidgetRoot
      type="ok"
      version="1.0.0"
      slot="message"
      status={status}
      state={readonly ? 'locked' : 'idle'}
      readonly={readonly}
    >
      <button
        type="button"
        disabled={readonly}
        onClick={() => {
          if (readonly) return;
          onInteraction('press', { text: String(payload.label) });
        }}
      >
        {String(payload.label)}
      </button>
    </WidgetRoot>
  );
}

const okEntry = asAnyWidget(
  defineWidget<Payload, State>({
    type: 'ok',
    version: '1.0.0',
    component: OkWidget,
    placement: { slot: 'message' },
    lifecycle: EXPIRE_ON_INTERACT,
    payloadSchema: labelSchema,
  }),
);

const okOptions: ConformanceOptions = {
  validPayload: { label: 'Go' },
  invalidPayloads: [{}, null, { label: 7 }],
};

/** A shallow override, deliberately untyped: every violator here is a value the types forbid. */
function variant(overrides: Record<string, unknown>): AnyWidgetRegistryEntry {
  return { ...okEntry, ...overrides };
}

async function rulesFor(
  entry: AnyWidgetRegistryEntry,
  overrides: Partial<ConformanceOptions> = {},
): Promise<string[]> {
  const report = await checkWidgetConformance(entry, { ...okOptions, ...overrides });
  return report.violations.map((violation) => violation.rule);
}

async function detailFor(
  entry: AnyWidgetRegistryEntry,
  rule: string,
  overrides: Partial<ConformanceOptions> = {},
): Promise<string> {
  const report = await checkWidgetConformance(entry, { ...okOptions, ...overrides });
  return report.violations
    .filter((violation) => violation.rule === rule)
    .map((violation) => violation.detail)
    .join('\n');
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * The control: the kit must pass what conforms
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('a conforming entry', () => {
  it('produces an empty, passing report', async () => {
    const report = await checkWidgetConformance(okEntry, okOptions);

    expect(report.violations).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.entry).toBe('ok@1.0.0');
  });

  it('leaves no DOM behind, so a second run sees a clean document', async () => {
    await checkWidgetConformance(okEntry, okOptions);
    await checkWidgetConformance(okEntry, okOptions);

    expect(document.body.querySelectorAll('[data-nerey-widget]')).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * AC-22, first half — both built-ins pass
 * ──────────────────────────────────────────────────────────────────────────────────── */

const here = dirname(fileURLToPath(import.meta.url));

/** The real widget modules, concatenated, so `no-io` is checked against shipped source. */
function widgetSource(widget: 'text' | 'confirmation', files: readonly string[]): string {
  return files.map((file) => readFileSync(resolve(here, '..', 'widgets', widget, file), 'utf8')).join('\n');
}

describe('the built-in widgets (AC-22)', () => {
  it('passes `text`', async () => {
    await expectWidgetConformance(asAnyWidget(textWidget), {
      validPayload: { content: 'Hello.' },
      invalidPayloads: [null, 'plain string', { content: 42 }, []],
      source: widgetSource('text', ['schema.ts', 'component.tsx', 'index.ts']),
    });
  });

  it('passes `confirmation`', async () => {
    await expectWidgetConformance(asAnyWidget(confirmationWidget), {
      validPayload: { title: 'Delete the project?', description: 'This cannot be undone.' },
      invalidPayloads: [null, {}, { title: '   ' }, { title: 'ok', tone: 'loud' }],
      state: {},
      source: widgetSource('confirmation', ['schema.ts', 'component.tsx', 'index.ts']),
    });
  });

  it('accepts `text` despite its empty expiry, because it uses the shared NEVER_EXPIRES', async () => {
    // The guard against an unreachable snapshot is by identity, not by shape (ADR 0018). Pinning
    // that here means the exemption cannot quietly widen into "any empty expiry is fine".
    expect(textWidget.lifecycle).toBe(NEVER_EXPIRES);

    const report = await checkWidgetConformance(asAnyWidget(textWidget), {
      validPayload: { content: 'Hello.' },
      invalidPayloads: [null],
    });

    expect(report.violations.map((violation) => violation.rule)).not.toContain('lifecycle-declared');
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * AC-22, second half — every rule fails on a seeded violation (ADR 0033)
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('rule: identity', () => {
  it('fires on an empty type', async () => {
    await expect(rulesFor(variant({ type: '' }))).resolves.toContain('identity');
  });

  it('fires on a missing version', async () => {
    await expect(rulesFor(variant({ version: undefined }))).resolves.toContain('identity');
  });

  it('fires on a leading `v`, because resolution is a string comparison', async () => {
    const detail = await detailFor(variant({ version: 'v1.0.0' }), 'identity');
    expect(detail).toMatch(/unknown-widget/);
  });

  it.each(['^1.0.0', '~1.2', '*', '>=1.0.0', '1.x || 2.x'])('fires on the range %s', async (range) => {
    await expect(rulesFor(variant({ version: range }))).resolves.toContain('identity');
  });

  it('does not report a mismatch cascade when the type is the thing that is missing', async () => {
    // The root still announces `ok`; the entry announces nothing. That is one defect, and it
    // belongs to `identity` — `data-contract` reporting it again would bury the diagnosis.
    const rules = await rulesFor(variant({ type: '' }));
    expect(rules).not.toContain('data-contract');
  });
});

describe('rule: schema-accepts-valid', () => {
  it('fires when the schema rejects the supplied valid payload', async () => {
    const rules = await rulesFor(okEntry, { validPayload: { label: 42 } });
    expect(rules).toContain('schema-accepts-valid');
  });

  it('fires when the schema throws instead of returning issues', async () => {
    const throwing: StandardSchemaV1<unknown, Payload> = {
      '~standard': {
        version: 1,
        vendor: 'nerey-conformance-test',
        validate() {
          throw new RangeError('nope');
        },
      },
    };

    const detail = await detailFor(variant({ payloadSchema: throwing }), 'schema-accepts-valid');
    expect(detail).toMatch(/RangeError: nope/);
  });

  it('stays silent for an entry that declares no payloadSchema', async () => {
    const rules = await rulesFor(variant({ payloadSchema: undefined }), { invalidPayloads: [] });
    expect(rules).toEqual([]);
  });
});

describe('rule: schema-rejects-invalid', () => {
  it('fires when the schema accepts a payload it was told to refuse', async () => {
    const rules = await rulesFor(okEntry, { invalidPayloads: [{ label: 'actually fine' }] });
    expect(rules).toContain('schema-rejects-invalid');
  });

  it('fires when a schema is declared but no invalid payloads are supplied to prove it', async () => {
    const rules = await rulesFor(okEntry, { invalidPayloads: undefined });
    expect(rules).toEqual(['schema-rejects-invalid']);
  });

  it('names the offending index, so a long fixture list is diagnosable', async () => {
    const detail = await detailFor(okEntry, 'schema-rejects-invalid', {
      invalidPayloads: [null, { label: 'fine' }],
    });
    expect(detail).toMatch(/invalidPayloads\[1\]/);
  });
});

describe('rule: schema-is-sync', () => {
  const asyncSchema: StandardSchemaV1<unknown, Payload> = {
    '~standard': {
      version: 1,
      vendor: 'nerey-conformance-test',
      validate: (value) => Promise.resolve(labelSchema['~standard'].validate(value)),
    },
  };

  it('fires on a schema that validates asynchronously', async () => {
    const rules = await rulesFor(variant({ payloadSchema: asyncSchema }));
    expect(rules).toEqual(['schema-is-sync']);
  });

  it('explains that Nerey validates during render', async () => {
    const detail = await detailFor(variant({ payloadSchema: asyncSchema }), 'schema-is-sync');
    expect(detail).toMatch(/render phase and cannot await/);
  });

  it('fires for a state schema too, since it runs on the same render pass', async () => {
    const rules = await rulesFor(variant({ stateSchema: asyncSchema }), { state: {} });
    expect(rules).toEqual(['schema-is-sync']);
  });
});

describe('rule: renders', () => {
  it('fires when the component throws', async () => {
    function ExplodingWidget(): ReactElement {
      throw new Error('kaboom');
    }

    const detail = await detailFor(variant({ component: ExplodingWidget }), 'renders');
    expect(detail).toMatch(/kaboom/);
  });

  it('fires when the component throws only in its read-only branch', async () => {
    function HalfBrokenWidget({ readonly, status }: Props): ReactElement {
      if (readonly) throw new Error('read-only path forgotten');
      return <WidgetRoot type="ok" version="1.0.0" slot="message" status={status} />;
    }

    const detail = await detailFor(variant({ component: HalfBrokenWidget }), 'renders');
    expect(detail).toMatch(/read-only path forgotten/);
  });

  it('fires when `component` is not a component at all', async () => {
    await expect(rulesFor(variant({ component: undefined }))).resolves.toContain('renders');
  });

  it('suppresses the render-rule cascade: a throwing widget reports `renders` and nothing else', async () => {
    function ExplodingWidget(): ReactElement {
      throw new Error('kaboom');
    }

    const rules = await rulesFor(variant({ component: ExplodingWidget }));
    expect(rules).toEqual(['renders']);
  });
});

describe('rule: data-contract', () => {
  it('fires when the root carries none of the identity attributes', async () => {
    function BareWidget(): ReactElement {
      return <div>styled by nobody</div>;
    }

    const detail = await detailFor(variant({ component: BareWidget }), 'data-contract');
    expect(detail).toMatch(/data-nerey-widget/);
    expect(detail).toMatch(/data-nerey-status/);
  });

  it('fires when the attributes sit on a descendant rather than the outermost node', async () => {
    function WrappedWidget({ status, readonly }: Props): ReactElement {
      return (
        <div>
          <WidgetRoot type="ok" version="1.0.0" slot="message" status={status} readonly={readonly} />
        </div>
      );
    }

    const detail = await detailFor(variant({ component: WrappedWidget }), 'data-contract');
    expect(detail).toMatch(/deeper in the subtree/);
  });

  it('fires when the root announces a version the entry does not hold', async () => {
    function MislabelledWidget({ status }: Props): ReactElement {
      return <WidgetRoot type="ok" version="9.9.9" slot="message" status={status} />;
    }

    const detail = await detailFor(variant({ component: MislabelledWidget }), 'data-contract');
    expect(detail).toMatch(/data-nerey-version="9\.9\.9"/);
  });

  it('fires on a `data-state` value outside the documented vocabulary', async () => {
    function LoudWidget({ status }: Props): ReactElement {
      return (
        <WidgetRoot type="ok" version="1.0.0" slot="message" status={status}>
          <span data-nerey-part="body" data-state="wobbly" />
        </WidgetRoot>
      );
    }

    const detail = await detailFor(variant({ component: LoudWidget }), 'data-contract');
    expect(detail).toMatch(/wobbly/);
    expect(detail).toMatch(/data-nerey-part="body"/);
  });

  it('fires on an invented `data-state` on the root itself', async () => {
    function LoudRootWidget(): ReactElement {
      return (
        <div
          data-nerey-widget="ok"
          data-nerey-version="1.0.0"
          data-nerey-slot="message"
          data-nerey-status="ready"
          data-state="humming"
        />
      );
    }

    const detail = await detailFor(variant({ component: LoudRootWidget }), 'data-contract');
    expect(detail).toMatch(/humming/);
  });

  it('fires when the component renders nothing', async () => {
    function EmptyWidget(): ReactElement | null {
      return null;
    }

    const detail = await detailFor(variant({ component: EmptyWidget }), 'data-contract');
    expect(detail).toMatch(/rendered no element/);
  });
});

describe('rule: readonly-is-inert', () => {
  it('fires when a read-only widget still sends on click', async () => {
    function LeakyWidget({ status, onInteraction }: Props): ReactElement {
      return (
        <WidgetRoot type="ok" version="1.0.0" slot="message" status={status}>
          <button
            type="button"
            onClick={() => {
              onInteraction('press', { text: 'sent anyway' });
            }}
          >
            Press
          </button>
        </WidgetRoot>
      );
    }

    const detail = await detailFor(variant({ component: LeakyWidget }), 'readonly-is-inert');
    expect(detail).toMatch(/sent anyway/);
    expect(detail).toMatch(/second model turn/);
  });

  it('fires for a widget that disables the button but not the handler', async () => {
    // The realistic version of the bug: `disabled` is honoured, so the DOM looks right, but the
    // handler is reachable through a consumer's substituted control (ADR 0021).
    function HalfGuardedWidget({ readonly, status, onInteraction }: Props): ReactElement {
      return (
        <WidgetRoot type="ok" version="1.0.0" slot="message" status={status} readonly={readonly}>
          <button
            type="button"
            aria-disabled={readonly}
            onClick={() => {
              onInteraction('press', { text: 'still sent' });
            }}
          >
            Press
          </button>
        </WidgetRoot>
      );
    }

    await expect(rulesFor(variant({ component: HalfGuardedWidget }))).resolves.toContain('readonly-is-inert');
  });

  it('stays silent for a widget with no buttons at all', async () => {
    function InertWidget({ status, readonly }: Props): ReactElement {
      return <WidgetRoot type="ok" version="1.0.0" slot="message" status={status} readonly={readonly} />;
    }

    await expect(rulesFor(variant({ component: InertWidget }))).resolves.toEqual([]);
  });
});

describe('rule: lifecycle-declared', () => {
  it('fires on an unknown `persist`', async () => {
    const rules = await rulesFor(
      variant({ lifecycle: { persist: 'sometimes', expiry: [{ on: 'interact' }], afterExpiry: 'hide' } }),
    );
    expect(rules).toEqual(['lifecycle-declared']);
  });

  it('fires on an unknown `afterExpiry`', async () => {
    const rules = await rulesFor(
      variant({ lifecycle: { persist: 'forever', expiry: [{ on: 'interact' }], afterExpiry: 'vanish' } }),
    );
    expect(rules).toEqual(['lifecycle-declared']);
  });

  it('fires on a snapshot that can never be reached', async () => {
    const detail = await detailFor(
      variant({ lifecycle: { persist: 'forever', expiry: [], afterExpiry: 'snapshot' } }),
      'lifecycle-declared',
    );
    expect(detail).toMatch(/never reaches/);
  });

  it('does not fire on an empty expiry with a reachable afterExpiry', async () => {
    const rules = await rulesFor(
      variant({ lifecycle: { persist: 'ephemeral', expiry: [], afterExpiry: 'hide' } }),
    );
    expect(rules).toEqual([]);
  });

  it('fires on a non-array `expiry`', async () => {
    await expect(
      rulesFor(variant({ lifecycle: { persist: 'forever', expiry: null, afterExpiry: 'hide' } })),
    ).resolves.toContain('lifecycle-declared');
  });

  it('fires on an expiry rule nothing can trigger', async () => {
    const detail = await detailFor(
      variant({ lifecycle: { persist: 'forever', expiry: [{ on: 'blink' }], afterExpiry: 'hide' } }),
      'lifecycle-declared',
    );
    expect(detail).toMatch(/expiry\[0\]/);
  });

  it('fires on a timeout with no usable deadline', async () => {
    const detail = await detailFor(
      variant({ lifecycle: { persist: 'forever', expiry: [{ on: 'timeout' }], afterExpiry: 'hide' } }),
      'lifecycle-declared',
    );
    expect(detail).toMatch(/born expired/);
  });

  it('fires on an event rule with no name', async () => {
    const detail = await detailFor(
      variant({
        lifecycle: { persist: 'forever', expiry: [{ on: 'event', name: '' }], afterExpiry: 'hide' },
      }),
      'lifecycle-declared',
    );
    expect(detail).toMatch(/never be matched/);
  });

  it('fires when `lifecycle` is missing entirely', async () => {
    await expect(rulesFor(variant({ lifecycle: undefined }))).resolves.toContain('lifecycle-declared');
  });
});

describe('rule: no-io', () => {
  // Built by concatenation rather than written as a literal import statement: this file lives
  // under packages/core/src, and the repository's own purity gate greps that tree for banned
  // specifiers. A fixture that reads as a real import would fail a gate it has nothing to do with.
  const AXIOS = ['ax', 'ios'].join('');
  const TANSTACK = ['@tan', 'stack'].join('');

  it('fires on a fetch call', async () => {
    const rules = await rulesFor(okEntry, { source: 'const data = await fetch("/api/things");' });
    expect(rules).toEqual(['no-io']);
  });

  it('does not fire on an identifier that merely ends in fetch', async () => {
    await expect(rulesFor(okEntry, { source: 'const { refetch } = props;\nrefetch();' })).resolves.toEqual(
      [],
    );
  });

  it('fires on XMLHttpRequest', async () => {
    await expect(rulesFor(okEntry, { source: 'const xhr = new XMLHttpRequest();' })).resolves.toContain(
      'no-io',
    );
  });

  it('fires on a WebSocket', async () => {
    const detail = await detailFor(okEntry, 'no-io', {
      source: 'const socket = new WebSocket("wss://example.test");',
    });
    expect(detail).toMatch(/Transport belongs to the host/);
  });

  it('fires on an HTTP client import', async () => {
    const detail = await detailFor(okEntry, 'no-io', { source: `import http from "${AXIOS}";` });
    expect(detail).toMatch(/axios/);
  });

  it('fires on a query-library import', async () => {
    const detail = await detailFor(okEntry, 'no-io', {
      source: `import { useQuery } from "${TANSTACK}/react-query";`,
    });
    expect(detail).toMatch(/react-query/);
  });

  it('reports the line, so a long module is navigable', async () => {
    const detail = await detailFor(okEntry, 'no-io', { source: '\n\n\nvoid fetch("/x");' });
    expect(detail).toMatch(/^line 4 /);
  });

  it('is skipped, not failed, when no source is supplied', async () => {
    await expect(rulesFor(okEntry, { source: undefined })).resolves.toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * The assertion wrapper
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('expectWidgetConformance', () => {
  it('resolves for a conforming entry', async () => {
    await expect(expectWidgetConformance(okEntry, okOptions)).resolves.toBeUndefined();
  });

  it('rejects with every violation, not only the first', async () => {
    const broken = variant({
      version: '^1.0.0',
      lifecycle: { persist: 'forever', expiry: [], afterExpiry: 'snapshot' },
    });

    await expect(expectWidgetConformance(broken, okOptions)).rejects.toThrow(/\[identity\]/);
    await expect(expectWidgetConformance(broken, okOptions)).rejects.toThrow(/\[lifecycle-declared\]/);
  });

  it('names the entry and counts the rules in the message', async () => {
    const error = await expectWidgetConformance(okEntry, { ...okOptions, invalidPayloads: [] }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Widget `ok@1\.0\.0` failed 1 conformance rule:/);
  });
});
