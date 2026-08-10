import { describe, expect, it, vi } from 'vitest';

import type { AnyWidgetRegistryEntry, NereyMessage, NereyWidgetEnvelope } from './types';

import {
  TEXT_WIDGET_TYPE,
  TEXT_WIDGET_VERSION,
  dedupeById,
  hasWidget,
  migratePayload,
  resolveEnvelope,
} from './adapter';

function message(overrides: Partial<NereyMessage> = {}): NereyMessage {
  return { id: 'm1', role: 'assistant', text: 'Plain prose.', ...overrides };
}

const ENVELOPE: NereyWidgetEnvelope = {
  type: 'confirmation',
  version: '1.0.0',
  payload: { title: 'Ship it?' },
  state: { decision: 'confirmed' },
};

/** The two fields `migratePayload` is allowed to see — `acceptsVersion` is invisible by design. */
function entry(
  version: string,
  migrate?: AnyWidgetRegistryEntry['migrate'],
): Pick<AnyWidgetRegistryEntry, 'version' | 'migrate'> {
  return migrate ? { version, migrate } : { version };
}

describe('resolveEnvelope', () => {
  it('returns a real widget by reference', () => {
    // Copying would hand React a new prop identity on every render and defeat memoisation in
    // every widget downstream, so identity — not deep equality — is the assertion.
    const source = message({ widget: ENVELOPE });

    expect(resolveEnvelope(source)).toBe(ENVELOPE);
  });

  it.each<[string, NereyWidgetEnvelope | null | undefined]>([
    ['undefined', undefined],
    ['null', null],
  ])('synthesises a text envelope when widget is %s', (_label, widget) => {
    const envelope = resolveEnvelope(message({ widget, text: 'Just words.' }));

    expect(envelope).toEqual({
      type: TEXT_WIDGET_TYPE,
      version: TEXT_WIDGET_VERSION,
      payload: { content: 'Just words.' },
      state: {},
    });
  });

  it('registers the synthesised envelope under the built-in text coordinates', () => {
    expect(TEXT_WIDGET_TYPE).toBe('text');
    expect(TEXT_WIDGET_VERSION).toBe('1.0.0');
  });

  it('synthesises an envelope for empty text rather than returning nothing', () => {
    // One code path or none: a message with no text still has to reach the renderer, or the
    // degradation chain grows a second branch that nothing exercises (ADR 0035).
    const envelope = resolveEnvelope(message({ text: '' }));

    expect(envelope.type).toBe(TEXT_WIDGET_TYPE);
    expect(envelope.payload).toEqual({ content: '' });
  });

  it('does not mutate the message it was given', () => {
    const source = message({ text: 'Just words.' });
    const before: unknown = JSON.parse(JSON.stringify(source));

    resolveEnvelope(source);

    expect(source).toEqual(before);
    // Specifically: the synthesised envelope is not cached back onto the message. Writing it
    // there would make the message look like a widget message to `hasWidget` forever after.
    expect(Object.hasOwn(source, 'widget')).toBe(false);
  });

  it('does not write the synthesised envelope back onto a null widget', () => {
    const source = message({ widget: null });

    resolveEnvelope(source);

    expect(source.widget).toBeNull();
  });

  it('does not mutate a message that already carries a widget', () => {
    const widget = { ...ENVELOPE };
    const source = message({ widget });
    const before: unknown = JSON.parse(JSON.stringify(source));

    resolveEnvelope(source);

    expect(source).toEqual(before);
    expect(source.widget).toBe(widget);
  });

  it('synthesises a fresh envelope per call', () => {
    const source = message();

    expect(resolveEnvelope(source)).not.toBe(resolveEnvelope(source));
  });
});

describe('hasWidget', () => {
  it.each<[string, NereyWidgetEnvelope | null | undefined, boolean]>([
    ['an undefined widget is not a widget', undefined, false],
    ['a null widget is not a widget', null, false],
    ['a present envelope is', ENVELOPE, true],
  ])('%s', (_label, widget, expected) => {
    expect(hasWidget(message({ widget }))).toBe(expected);
  });

  it('counts an envelope with an empty type as a widget', () => {
    // Presence only. Letting it through produces `unknown-widget` (ADR 0013), which is
    // diagnosable; treating it as text would hide a producer bug behind plausible output.
    const broken: NereyWidgetEnvelope = { type: '', version: '', payload: undefined };

    expect(hasWidget(message({ widget: broken }))).toBe(true);
  });
});

describe('dedupeById', () => {
  it('keeps the last content at the first position', () => {
    // The subtle half of the contract. A reconnection replay resends an earlier message, so the
    // later copy is the more current *content* — but the message has not moved in the
    // conversation, and letting it jump to the end scrambles the transcript on every reconnect.
    const first = message({ id: 'a', text: 'first' });
    const other = message({ id: 'b', text: 'other' });
    const resent = message({ id: 'a', text: 'resent' });

    const deduped = dedupeById([first, other, resent]);

    expect(deduped.map((m) => m.id)).toEqual(['a', 'b']);
    expect(deduped[0]).toBe(resent);
    expect(deduped[0]?.text).toBe('resent');
    expect(deduped[1]).toBe(other);
  });

  it('collapses three copies to the newest, still in the original slot', () => {
    const messages = [
      message({ id: 'a', text: 'v1' }),
      message({ id: 'b', text: 'b' }),
      message({ id: 'a', text: 'v2' }),
      message({ id: 'c', text: 'c' }),
      message({ id: 'a', text: 'v3' }),
    ];

    const deduped = dedupeById(messages);

    expect(deduped.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(deduped[0]?.text).toBe('v3');
  });

  it('leaves a list with no duplicates untouched, in order', () => {
    const messages = [message({ id: 1 }), message({ id: 2 }), message({ id: 3 })];

    expect(dedupeById(messages)).toEqual(messages);
  });

  it('returns a new array rather than editing the caller list', () => {
    const messages = [message({ id: 'a' }), message({ id: 'a' })];
    const deduped = dedupeById(messages);

    expect(deduped).not.toBe(messages);
    expect(messages).toHaveLength(2);
  });

  it('returns an empty list for an empty input', () => {
    expect(dedupeById([])).toEqual([]);
  });

  it('treats a numeric id and its string form as different messages', () => {
    // Ids are keyed in a Map, so `1` and `'1'` do not collide. A producer mixing the two has a
    // bug, and silently merging them would hide it.
    const deduped = dedupeById([message({ id: 1 }), message({ id: '1' })]);

    expect(deduped).toHaveLength(2);
  });

  it('keeps the widget from the newest copy', () => {
    const stale = message({ id: 'a', widget: { ...ENVELOPE, payload: { title: 'stale' } } });
    const fresh = message({ id: 'a', widget: { ...ENVELOPE, payload: { title: 'fresh' } } });

    expect(dedupeById([stale, fresh])[0]?.widget?.payload).toEqual({ title: 'fresh' });
  });
});

describe('migratePayload', () => {
  it('passes the payload through untouched when the versions match', () => {
    const migrate = vi.fn();
    const envelope: NereyWidgetEnvelope = { ...ENVELOPE, version: '2.0.0' };

    const result = migratePayload(entry('2.0.0', migrate), envelope);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toBe(envelope.payload);
    expect(migrate).not.toHaveBeenCalled();
  });

  it('fails with both versions named when the entry declares no migrate', () => {
    const envelope: NereyWidgetEnvelope = { ...ENVELOPE, version: '0.9.0' };

    const result = migratePayload(entry('2.0.0'), envelope);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('`confirmation`');
    expect(result.reason).toContain('payload version 0.9.0');
    expect(result.reason).toContain('entry is version 2.0.0');
    expect(result.reason).toMatch(/declares no `migrate`/);
    expect(result.reason).toMatch(/ADR 0030/);
  });

  it('hands migrate the source version and the historical payload', () => {
    const migrate = vi.fn(() => ({ title: 'migrated' }));
    const envelope: NereyWidgetEnvelope = { ...ENVELOPE, version: '1.0.0', payload: { heading: 'old' } };

    const result = migratePayload(entry('2.0.0', migrate), envelope);

    expect(result).toEqual({ ok: true, payload: { title: 'migrated' } });
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(migrate).toHaveBeenCalledWith('1.0.0', { heading: 'old' });
  });

  it('succeeds when migrate returns null, because a schema may well accept it', () => {
    // Only `undefined` means "I cannot read that version". Treating `null` as failure would take
    // the decision away from `payloadSchema`, which is the only thing that knows.
    const result = migratePayload(
      entry('2.0.0', () => null),
      { ...ENVELOPE, version: '1.0.0' },
    );

    expect(result).toEqual({ ok: true, payload: null });
  });

  it.each<[string, unknown]>([
    ['a falsy zero', 0],
    ['an empty string', ''],
    ['false', false],
  ])('succeeds when migrate returns %s', (_label, migrated) => {
    const result = migratePayload(
      entry('2.0.0', () => migrated),
      { ...ENVELOPE, version: '1.0.0' },
    );

    expect(result).toEqual({ ok: true, payload: migrated });
  });

  it('fails when migrate returns undefined', () => {
    const result = migratePayload(
      entry('2.0.0', () => undefined),
      { ...ENVELOPE, version: '1.0.0' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('returned undefined');
    expect(result.reason).toContain('payload version 1.0.0');
    expect(result.reason).toContain('version 2.0.0');
  });

  it('catches a migrate that throws and reports it as an outcome', () => {
    const boom = () => {
      throw new Error('cannot read `heading` of undefined');
    };

    const result = migratePayload(entry('2.0.0', boom), { ...ENVELOPE, version: '1.0.0' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('threw while converting version 1.0.0 to 2.0.0');
    expect(result.reason).toContain('cannot read `heading` of undefined');
    expect(result.reason).toContain('`confirmation`');
  });

  it.each<[string, unknown, string]>([
    ['a string', 'nope', 'nope'],
    ['a number', 42, '42'],
    ['undefined', undefined, 'undefined'],
  ])('stringifies a non-Error throw (%s)', (_label, thrown, expected) => {
    const result = migratePayload(
      entry('2.0.0', () => {
        throw thrown;
      }),
      { ...ENVELOPE, version: '1.0.0' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(expected);
  });

  it('never rethrows — the degradation chain owns the outcome (ADR 0012)', () => {
    expect(() =>
      migratePayload(
        entry('2.0.0', () => {
          throw new Error('boom');
        }),
        { ...ENVELOPE, version: '1.0.0' },
      ),
    ).not.toThrow();
  });

  it('runs migrate before any validation would, on the raw historical shape', () => {
    const migrate = vi.fn((_from: string, payload: unknown) => ({
      title: (payload as { heading: string }).heading,
    }));

    const result = migratePayload(entry('2.0.0', migrate), {
      ...ENVELOPE,
      version: '1.0.0',
      payload: { heading: 'Ship it?' },
    });

    expect(result).toEqual({ ok: true, payload: { title: 'Ship it?' } });
  });
});
