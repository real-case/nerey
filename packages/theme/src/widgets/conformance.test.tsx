import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSync } from '@nerey/core';
import type { AnyWidgetRegistryEntry } from '@nerey/core';
import { createMemoryPersistence } from '@nerey/core/mock';
import { checkWidgetConformance } from '@nerey/core/testing';
import { describe, expect, it } from 'vitest';

import { themeWidgets } from './catalog';

/**
 * AC-22 / ADR 0046–0048 — the conformance kit, run over every widget the theme ships, against the
 * port an application would use. The kit is what a widget author runs in their own repository; if
 * the reference widgets cannot pass it, the kit is wrong or the widgets are, and either is a bug.
 *
 * Payloads come from each widget's own stories rather than a second fixture list, so a story and
 * this test cannot drift apart: the first story argument the entry's schema accepts is the valid
 * payload. A story module is loaded with `import.meta.glob`, which is the same module graph
 * Storybook builds.
 */

const here = dirname(fileURLToPath(import.meta.url));

const storyModules = import.meta.glob<Record<string, unknown>>('./*/*.stories.tsx', { eager: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every `args.payload` and `args.state` a widget's stories pass, in declaration order. */
function storyArgs(folder: string): { payload: unknown; state: unknown }[] {
  const module = Object.entries(storyModules).find(([path]) => path.startsWith(`./${folder}/`))?.[1];
  if (!module) return [];
  const out: { payload: unknown; state: unknown }[] = [];
  for (const exported of Object.values(module)) {
    if (!isRecord(exported) || !isRecord(exported['args'])) continue;
    const args = exported['args'];
    if ('payload' in args) out.push({ payload: args['payload'], state: args['state'] });
  }
  return out;
}

/** Folder names follow the widget `type`, kebab-cased: `choiceChips` lives in `choice-chips/`. */
function folderOf(entry: AnyWidgetRegistryEntry): string {
  return entry.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Widgets whose stories render a whole message rather than passing `args.payload`. `text` is the
 * one: its stories exercise the synthesised envelope of a plain message (ADR 0035), so there is no
 * payload argument to borrow.
 */
const EXTRA_PAYLOADS: Readonly<Record<string, unknown>> = {
  text: { content: 'Plain prose from the assistant.' },
};

function fixtureFor(entry: AnyWidgetRegistryEntry) {
  const folder = folderOf(entry);
  const extra = EXTRA_PAYLOADS[entry.type];
  const candidates = [
    ...storyArgs(folder),
    ...(extra === undefined ? [] : [{ payload: extra, state: undefined }]),
  ];
  const schema = entry.payloadSchema;
  const valid = candidates.find((c) => !schema || validateSync(schema, c.payload).ok);
  const sourcePath = resolve(here, folder, 'component.tsx');
  return {
    folder,
    valid,
    source: readFileSync(sourcePath, 'utf8'),
  };
}

describe('every theme widget passes the conformance kit', () => {
  it.each(themeWidgets.map((entry) => [`${entry.type}@${entry.version}`, entry] as const))(
    '%s',
    async (_key, entry) => {
      const fixture = fixtureFor(entry);
      expect(
        fixture.valid,
        `no story in ${fixture.folder}/ passes a payload its schema accepts`,
      ).toBeDefined();

      const report = await checkWidgetConformance(entry, {
        validPayload: fixture.valid?.payload,
        // Not an object at all: every theme schema is an object schema, so each must refuse both.
        invalidPayloads: [null, 'not a payload'],
        ...(fixture.valid?.state !== undefined ? { state: fixture.valid.state } : {}),
        source: fixture.source,
        persistence: createMemoryPersistence(),
      });

      expect(report.violations.map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
    },
  );
});
