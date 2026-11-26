// @vitest-environment node
import { resolve } from 'node:path';

import { build } from 'vite';
import type { Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * ADR 0056 — `@nerey/theme/server` is safe to import from a React Server Component. Built from
 * source with the package's own server config, its only imports are `zod` and `@nerey/core/server`:
 * the bare `@nerey/core` is the client entry, and reaching it would turn every contract into a
 * client reference again. `npm run check:mutants` re-plants such an import and requires this to fail.
 */

const CONFIG = resolve(import.meta.dirname, '../../vite.server.config.ts');
const ALLOWED = new Set(['zod', '@nerey/core/server']);

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

describe('@nerey/theme/server', () => {
  it('emits its entry as dist/server/index.js', () => {
    expect(chunks.map((chunk) => chunk.fileName)).toContain('server/index.js');
  });

  it('imports only zod and @nerey/core/server', () => {
    const own = new Set(chunks.map((chunk) => chunk.fileName));
    const imported = chunks.flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports]);
    expect(imported.filter((id) => !own.has(id) && !ALLOWED.has(id))).toEqual([]);
  });

  it('does not open with a use client directive', () => {
    for (const chunk of chunks) expect(chunk.code.trimStart()).not.toMatch(/^['"]use client['"]/);
  });

  it('exports every contract and the catalog list', () => {
    const entry = chunks.find((chunk) => chunk.fileName === 'server/index.js');
    expect(entry?.exports).toContain('themeWidgetContracts');
    expect(entry?.exports.filter((name) => name.endsWith('Contract'))).toHaveLength(11);
  });
});
