// @vitest-environment node
import { resolve } from 'node:path';

import { build } from 'vite';
import type { Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * ADR 0052 — `@nerey/core/server` is safe to import from a React Server Component.
 *
 * The test builds the entry from source with the same config the package build uses, rather than
 * reading `dist/`, so it runs in the unit loop without a prior `npm run build` and always sees the
 * source as it is now. React is external in that config, so a React import anywhere in the entry's
 * graph survives as an import of `react` in the output instead of being inlined — which is what
 * this test looks for. `npm run check:mutants` re-plants a React-importing export in the barrel and
 * requires this file to fail.
 */

const CONFIG = resolve(import.meta.dirname, '../../vite.server.config.ts');
const REACT = /^react(-dom)?($|\/)/;

let chunks: Rolldown.OutputChunk[] = [];

beforeAll(async () => {
  const result = await build({
    configFile: CONFIG,
    logLevel: 'silent',
    build: { write: false, sourcemap: false },
  });
  const outputs = Array.isArray(result) ? result : [result];
  chunks = outputs.flatMap((output) =>
    'output' in output
      ? output.output.filter((item): item is Rolldown.OutputChunk => item.type === 'chunk')
      : [],
  );
}, 60_000);

describe('@nerey/core/server', () => {
  it('emits its entry as dist/server/index.js', () => {
    expect(chunks.map((chunk) => chunk.fileName)).toContain('server/index.js');
  });

  it('reaches no react or react-dom module at runtime', () => {
    const imported = chunks.flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports]);
    expect(imported.filter((id) => REACT.test(id))).toEqual([]);
  });

  it('does not open with a use client directive', () => {
    for (const chunk of chunks) {
      expect(chunk.code.trimStart()).not.toMatch(/^['"]use client['"]/);
    }
  });

  it('exports the registry, describe, lifecycle and validation functions', () => {
    const entry = chunks.find((chunk) => chunk.fileName === 'server/index.js');
    expect(entry?.exports.slice().sort()).toEqual(
      [
        'EXPIRE_ON_INTERACT',
        'NEVER_EXPIRES',
        'builtInWidgetContracts',
        'composeRegistries',
        'confirmationContract',
        'createWidgetRegistry',
        'defineWidget',
        'defineWidgetContract',
        'describeRegistry',
        'emptyRegistry',
        'firstFiredRule',
        'flattenIssues',
        'formatIssuePath',
        'isExpired',
        'msUntilNextTimeout',
        'textContract',
        'validateSync',
      ].sort(),
    );
  });
});
