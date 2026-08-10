#!/usr/bin/env node
// scripts/check-public-api.mjs
//
// ADR 0029 — the export surface of a published package is versioned API, and TypeScript will
// not tell us when it changes. Deleting `export { foo }` from a barrel compiles cleanly here
// and breaks only in a consumer's build, after publication. So the surface is snapshotted into
// `docs/design-system/public-api.json` and diffed on every run: a removal or a value→type flip
// shows up in the PR as a deleted line in a committed file, which is the whole point.
//
// Two independent checks live in this file:
//
//   Snapshot  every symbol re-exported from a published barrel, plus whether it is type-only.
//             Removals and kind flips FAIL (MAJOR under 0029). Additions are printed and pass —
//             they are a MINOR bump, and the print is the source for the release notes.
//   Imports   ADR 0028 — nothing under packages/theme/src may reach into another package's
//             internals. `@nerey/core/src/…` is not in the `exports` map, so it resolves in this
//             workspace (symlink + TS paths) and fails from an installed tarball. The failure
//             is invisible until someone consumes the published package.
//
// Why barrels and not `dist/`: ADR 0028 makes the `exports` map closed, so what a barrel
// re-exports IS the reachable surface, and the check works before a build as well as after.
// A symbol a barrel *declares* inline rather than re-exporting is invisible here; barrels
// re-export by construction, and `check:exports` owns which subpaths exist at all.
//
// @nerey/eslint-config is deliberately absent: its API is rule ids and failure messages rather
// than exports, and ADR 0029 gives it a separate snapshot.
//
// Usage:
//   node scripts/check-public-api.mjs
//   node scripts/check-public-api.mjs --update-baseline   bless the current surface, print the diff
//   node scripts/check-public-api.mjs --self-test         plant a violator per rule, assert each fires

import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const BASELINE = resolve(repoRoot, 'docs/design-system/public-api.json');
const THEME_SRC = resolve(repoRoot, 'packages/theme/src');

/** The published entry points of ADR 0028, in the order a consumer meets them. */
const BARRELS = [
  { key: '@nerey/core', file: 'packages/core/src/index.ts' },
  { key: '@nerey/core/mock', file: 'packages/core/src/mock/index.ts' },
  { key: '@nerey/core/testing', file: 'packages/core/src/testing/index.ts' },
  { key: '@nerey/theme', file: 'packages/theme/src/index.ts' },
];

/** Rules that block. `added-export` and `missing-barrel` are reported and do not fail. */
const FATAL = new Set(['removed-export', 'kind-changed', 'no-deep-import']);

const IMPORT_RE =
  /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

/** `@nerey/<pkg>/src/…` and `…/dist/…` — the two shapes ADR 0028 bans by name. */
const DEEP_PACKAGE_RE = /^(@nerey\/[a-z0-9-]+)\/(src|dist)\//;

function relOf(absPath) {
  return relative(repoRoot, absPath).split(sep).join('/');
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Blank out comments, preserving every byte offset so reported line numbers still match the
 * file on disk. Without this a commented-out `export { … }` — the usual way a symbol is
 * retired before deletion — counts as part of the public surface.
 */
function blankComments(source) {
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s;{}()])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)));
}

/**
 * Extract the re-exported surface of one barrel.
 *
 * Handles `export { a }`, `export type { A }`, the inline modifier `export { type A, b }`, and
 * aliases `export { a as b }` — the alias is the name a consumer imports, so it is the name that
 * is API. Returns a Map so a symbol re-exported twice collapses to one entry.
 */
/**
 * Resolves a relative specifier from a barrel to a file on disk, trying the forms TypeScript
 * would: an explicit extension, `.ts`/`.tsx`, then `index.ts`/`index.tsx`.
 */
function resolveBarrelImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/**
 * @param fromFile absolute path of the barrel, so a `export * from './x'` can be followed.
 * @param seen     guards against a cycle between two barrels re-exporting each other.
 *
 * A bare star re-export used to be reported as opaque, because a regex cannot see through it and
 * the symbols never entered the snapshot. That was the safe reading but the wrong tradeoff: the
 * alternative it pushed people toward — hand-listing three hundred names in a third file — is
 * exactly the kind of manually maintained list that drifts, and a snapshot of a list that has
 * drifted is worse than no snapshot. So the star is FOLLOWED into the module it names. It stays
 * reported as opaque only when the target cannot be resolved on disk, which is the one case
 * where nothing can be known about it.
 */
function parseBarrel(source, fromFile, seen = new Set()) {
  const code = blankComments(source);
  const symbols = new Map();
  const opaqueStars = [];

  for (const clause of code.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    const clauseIsType = Boolean(clause[1]);
    const bodyStart = clause.index + clause[0].indexOf('{') + 1;
    let cursor = 0;
    for (const part of clause[2].split(',')) {
      const at = bodyStart + cursor + (part.length - part.trimStart().length);
      cursor += part.length + 1;
      const spec = part.trim();
      if (!spec) continue;
      const parsed = spec.match(/^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!parsed) continue;
      const name = parsed[3] ?? parsed[2];
      symbols.set(name, { kind: clauseIsType || parsed[1] ? 'types' : 'values', line: lineOf(source, at) });
    }
  }

  for (const star of code.matchAll(/export\s+\*\s+(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/g)) {
    if (star[1]) {
      symbols.set(star[1], { kind: 'values', line: lineOf(source, star.index) });
      continue;
    }
    const target = fromFile ? resolveBarrelImport(fromFile, star[2]) : null;
    if (!target || seen.has(target)) {
      opaqueStars.push({ from: star[2], line: lineOf(source, star.index) });
      continue;
    }
    seen.add(target);
    const nested = parseBarrel(readFileSync(target, 'utf8'), target, seen);
    // The outer barrel wins on a name collision: it is the module a consumer actually imports.
    for (const [name, meta] of nested.symbols) {
      if (!symbols.has(name)) symbols.set(name, { ...meta, line: lineOf(source, star.index) });
    }
    opaqueStars.push(...nested.opaqueStars);
  }

  return { symbols, opaqueStars };
}

function snapshotOf(symbols) {
  const values = [];
  const types = [];
  for (const [name, info] of symbols) (info.kind === 'types' ? types : values).push(name);
  // Plain `.sort()` rather than `localeCompare`: collation depends on ICU and locale, and a
  // baseline that reorders itself on someone else's machine is a permanent phantom diff.
  return { values: values.sort(), types: types.sort() };
}

function kindMap(entry) {
  const map = new Map();
  for (const name of entry?.values ?? []) map.set(name, 'values');
  for (const name of entry?.types ?? []) map.set(name, 'types');
  return map;
}

/** Compare one barrel against its baseline entry. Returns problems plus the fresh snapshot. */
function checkBarrel(absPath, key, baselineEntry) {
  const rel = relOf(absPath);
  const problems = [];

  if (!existsSync(absPath)) {
    const baseline = kindMap(baselineEntry);
    if (baseline.size === 0) {
      problems.push({
        rel,
        line: 1,
        rule: 'missing-barrel',
        message:
          `${key} has no barrel yet, so it contributes nothing to the snapshot. Not a failure — ` +
          `the entry appears once the barrel lands (ADR 0028).`,
      });
      return { problems, entry: null, opaqueStars: [] };
    }
    // The barrel vanished but the baseline remembers its exports: every one of them is a removal.
    for (const [name] of baseline) {
      problems.push({
        rel,
        line: 1,
        rule: 'removed-export',
        message:
          `${key} exported \`${name}\`, and the barrel itself is gone. Every export of a deleted ` +
          `barrel is a breaking change under ADR 0029.`,
      });
    }
    return { problems, entry: null, opaqueStars: [] };
  }

  const source = readFileSync(absPath, 'utf8');
  const { symbols, opaqueStars } = parseBarrel(source, absPath);
  const current = kindMap(snapshotOf(symbols));
  const baseline = kindMap(baselineEntry);

  for (const [name, kind] of baseline) {
    const now = current.get(name);
    if (now === undefined) {
      problems.push({
        rel,
        line: 1,
        rule: 'removed-export',
        message:
          `${key} no longer exports \`${name}\` (baseline: ${kind === 'types' ? 'type' : 'value'}). ` +
          `Removing a public export is a breaking change — MAJOR under ADR 0029, MINOR while the ` +
          `package is 0.x. Restore it, or land the removal with a \`!\` commit and re-run with ` +
          `--update-baseline.`,
      });
      continue;
    }
    if (now !== kind) {
      const line = symbols.get(name)?.line ?? 1;
      problems.push({
        rel,
        line,
        rule: 'kind-changed',
        message:
          `\`${name}\` moved from a ${kind === 'types' ? 'type-only' : 'value'} export to a ` +
          `${now === 'types' ? 'type-only' : 'value'} export in ${key}. A consumer's ` +
          `\`import { ${name} }\` stops resolving at runtime when a value becomes type-only — ` +
          `breaking under ADR 0029.`,
      });
    }
  }

  for (const [name, kind] of current) {
    if (baseline.has(name)) continue;
    problems.push({
      rel,
      line: symbols.get(name)?.line ?? 1,
      rule: 'added-export',
      message:
        `${key} gains \`${name}\` (${kind === 'types' ? 'type' : 'value'}) — a MINOR bump under ` +
        `ADR 0029. Run \`npm run check:public-api -- --update-baseline\` and mention it in the ` +
        `release notes.`,
    });
  }

  return { problems, entry: snapshotOf(symbols), opaqueStars };
}

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  // Sorted: ADR 0033 forbids letting filesystem iteration order reach the output.
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

/**
 * ADR 0028 — a cross-package import goes through the package name and nothing else.
 *
 * Two escapes are possible from packages/theme/src: naming a banned subpath outright
 * (`@nerey/core/src/…`), or walking out of the tree with `../..` until you land in another
 * package. Both resolve here and neither resolves from an installed tarball, where `files` is
 * `["dist"]` and the `exports` map has no matching key.
 */
function checkThemeImports(absPath) {
  const rel = relOf(absPath);
  const source = readFileSync(absPath, 'utf8');
  const code = blankComments(source);
  const problems = [];

  for (const match of code.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (!specifier) continue;
    const line = lineOf(source, match.index ?? 0);

    const deep = specifier.match(DEEP_PACKAGE_RE);
    if (deep) {
      problems.push({
        rel,
        line,
        rule: 'no-deep-import',
        message:
          `imports \`${specifier}\` — \`${deep[1]}/${deep[2]}/**\` is not in that package's ` +
          `\`exports\` map, so it resolves in this workspace and fails with ` +
          `ERR_PACKAGE_PATH_NOT_EXPORTED for a consumer. Import from \`${deep[1]}\` (ADR 0028).`,
      });
      continue;
    }

    if (!specifier.startsWith('.')) continue;
    const target = resolve(dirname(absPath), specifier);
    if (target === THEME_SRC || target.startsWith(THEME_SRC + sep)) continue;
    const intoCore = relOf(target).startsWith('packages/core/');
    problems.push({
      rel,
      line,
      rule: 'no-deep-import',
      message:
        `imports \`${specifier}\`, which escapes packages/theme/src into ` +
        `\`${relOf(target)}\`${intoCore ? ' — straight into @nerey/core' : ''}. A relative path ` +
        `across a package boundary is bundled twice and is unresolvable once published; go ` +
        `through the package name (ADR 0028).`,
    });
  }

  return problems;
}

function loadBaseline({ required }) {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch {
    if (!required) return {};
    console.error(
      `✗ ${relOf(BASELINE)} is missing — there is nothing to compare the export surface against.\n` +
        `  Create it with \`npm run check:public-api -- --update-baseline\` and commit it (ADR 0029).`,
    );
    process.exit(1);
  }
}

function run(baseline) {
  const problems = [];
  const snapshot = {};
  const opaqueStars = [];
  let symbolCount = 0;

  for (const { key, file } of BARRELS) {
    const result = checkBarrel(resolve(repoRoot, file), key, baseline[key]);
    problems.push(...result.problems);
    if (result.entry) {
      snapshot[key] = result.entry;
      symbolCount += result.entry.values.length + result.entry.types.length;
    }
    opaqueStars.push(...result.opaqueStars.map((s) => ({ ...s, rel: relOf(resolve(repoRoot, file)) })));
  }

  // A baseline key with no barrel registered above would otherwise be silently dropped by
  // --update-baseline, taking its removal detection with it.
  for (const key of Object.keys(baseline).sort()) {
    if (BARRELS.some((b) => b.key === key)) continue;
    problems.push({
      rel: relOf(BASELINE),
      line: 1,
      rule: 'removed-export',
      message:
        `the baseline records \`${key}\`, which is not a barrel this gate knows about. Either add ` +
        `it to BARRELS in ${relOf(fileURLToPath(import.meta.url))} or drop the entry deliberately ` +
        `(ADR 0028 / 0029).`,
    });
  }

  const themeFiles = walk(THEME_SRC, (f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f));
  problems.push(...themeFiles.flatMap(checkThemeImports));

  return { problems, snapshot, opaqueStars, symbolCount, themeFileCount: themeFiles.length };
}

function serialize(snapshot) {
  const sorted = {};
  for (const key of Object.keys(snapshot).sort()) sorted[key] = snapshot[key];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  // ADR 0033 — every rule rejects its own planted violator, and the non-failing rules are
  // asserted to stay non-failing. A gate that turned `added-export` fatal would block every
  // MINOR release, which is exactly as broken as one that never fires.
  const fixtureDir = resolve(THEME_SRC, '__apicheck__');
  const barrelFixture = join(fixtureDir, 'barrel.ts');
  const importFixture = join(fixtureDir, 'imports.ts');
  const outcomes = [];
  const fatal = (problems) => problems.filter((p) => FATAL.has(p.rule));

  const BARREL_CASES = [
    [
      'removed-export',
      { values: ['ghost'], types: [] },
      "export { present } from './x';\n",
      (problems) => problems.some((p) => p.rule === 'removed-export'),
    ],
    [
      'kind-changed',
      { values: ['Widget'], types: [] },
      "export type { Widget } from './x';\n",
      (problems) => problems.some((p) => p.rule === 'kind-changed'),
    ],
    [
      'added-export',
      { values: [], types: [] },
      "export { fresh } from './x';\n",
      // Fires AND does not block: a new export is a MINOR bump, not a breaking change.
      (problems) => problems.some((p) => p.rule === 'added-export') && fatal(problems).length === 0,
    ],
  ];

  const BARREL_ALLOWED = [
    [
      'an unchanged surface',
      { values: ['a'], types: ['B'] },
      "export { a } from './x';\nexport type { B } from './x';\n",
    ],
    ['an aliased re-export', { values: ['b'], types: [] }, "export { a as b } from './x';\n"],
    ['an inline type modifier', { values: ['a'], types: ['B'] }, "export { a, type B } from './x';\n"],
    ['a commented-out export', { values: ['a'], types: [] }, "export { a } from './x';\n// export { b };\n"],
  ];

  const IMPORT_CASES = [
    ['no-deep-import (subpath)', "import { x } from '@nerey/core/src/registry';\n"],
    ['no-deep-import (relative escape)', "import { x } from '../../../core/src/registry';\n"],
  ];

  const IMPORT_ALLOWED = [
    [
      'the package name',
      "import { WidgetRoot } from '@nerey/core';\nimport { m } from '@nerey/core/mock';\n",
    ],
    ['a sibling module', "import { cx } from '../internal/cx';\nimport s from './x.module.css';\n"],
  ];

  // The fixture tree is torn down BEFORE any exit — `process.exit()` skips `finally`.
  try {
    mkdirSync(fixtureDir, { recursive: true });

    for (const [rule, entry, source, assert] of BARREL_CASES) {
      writeFileSync(barrelFixture, source, 'utf8');
      outcomes.push([rule, assert(checkBarrel(barrelFixture, '@nerey/fixture', entry).problems)]);
    }

    for (const [name, entry, source] of BARREL_ALLOWED) {
      writeFileSync(barrelFixture, source, 'utf8');
      const found = checkBarrel(barrelFixture, '@nerey/fixture', entry).problems;
      outcomes.push([`allows ${name}`, found.length === 0, found.map((p) => p.rule).join(', ')]);
    }

    for (const [name, source] of IMPORT_CASES) {
      writeFileSync(importFixture, source, 'utf8');
      outcomes.push([name, checkThemeImports(importFixture).some((p) => p.rule === 'no-deep-import')]);
    }

    for (const [name, source] of IMPORT_ALLOWED) {
      writeFileSync(importFixture, source, 'utf8');
      const found = checkThemeImports(importFixture);
      outcomes.push([`allows ${name}`, found.length === 0, found.map((p) => p.rule).join(', ')]);
    }

    rmSync(barrelFixture, { force: true });
    const missing = checkBarrel(barrelFixture, '@nerey/fixture', undefined);
    outcomes.push([
      'missing-barrel',
      missing.problems.some((p) => p.rule === 'missing-barrel') && fatal(missing.problems).length === 0,
    ]);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ');
    if (ok) {
      console.log(`  ✓ check-public-api/${rule} — ${positive ? 'rejected its violator' : 'stayed silent'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-public-api/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-public-api/${rule} — fired on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

if (argv.includes('--update-baseline')) {
  const firstRun = !existsSync(BASELINE);
  const previous = loadBaseline({ required: false });
  const { snapshot, problems, symbolCount } = run(previous);
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, serialize(snapshot), 'utf8');

  // Print what was just blessed. A baseline update that silently swallows a removal is how a
  // MAJOR change reaches npm labelled as a patch. On the very first write every symbol is an
  // addition by definition, so the per-symbol list is noise rather than review material.
  const blessed = firstRun ? [] : problems.filter((p) => p.rule !== 'missing-barrel');
  console.log(`✓ baseline written: ${relOf(BASELINE)} — ${symbolCount} symbol(s)`);
  if (blessed.length) {
    console.log(`  ${blessed.length} change(s) blessed — check the bump against ADR 0029:`);
    for (const p of blessed) console.log(`    [${p.rule}] ${p.message}`);
  }
  for (const p of problems.filter((x) => x.rule === 'missing-barrel')) {
    console.log(`  note: [missing-barrel] ${p.message}`);
  }
  process.exit(0);
}

const baseline = loadBaseline({ required: true });
const { problems, opaqueStars, symbolCount, themeFileCount } = run(baseline);
const blocking = problems.filter((p) => FATAL.has(p.rule));
const notes = problems.filter((p) => !FATAL.has(p.rule));

for (const note of notes) {
  console.log(`  ${note.rel}:${note.line}  [${note.rule}] ${note.message}`);
}
for (const star of opaqueStars) {
  console.log(
    `  ${star.rel}:${star.line}  [opaque-star-export] \`export * from '${star.from}'\` hides its ` +
      `symbols from the snapshot — re-export by name so the surface stays diffable (ADR 0029).`,
  );
}

if (blocking.length) {
  console.error(`\n✗ public API: ${blocking.length} breaking change(s) against ${relOf(BASELINE)}\n`);
  for (const p of blocking) console.error(`  ${p.rel}:${p.line}  [${p.rule}] ${p.message}`);
  console.error(
    `\n  A break is allowed — it is not allowed to be quiet. Declare it with a \`!\` commit ` +
      `(ADR 0036), then re-run with \`--update-baseline\` and commit the snapshot (ADR 0029).`,
  );
  process.exit(1);
}

console.log(
  `✓ public API: ${symbolCount} symbol(s) across ${Object.keys(baseline).length} barrel(s) match the ` +
    `baseline; ${themeFileCount} theme file(s) import through package names`,
);
