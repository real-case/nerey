#!/usr/bin/env node
// scripts/check-core-purity.mjs
//
// ADR 0002 / 0011 / 0012 / 0022 / 0037 — @nerey/core stays headless and dependency-light, and
// this gate is the thing that keeps it that way once the repo has more than one contributor.
//
// It checks BOTH the source and, when present, the built package:
//
//   Source   no `.css` import anywhere under packages/core/src; no import of a validator, a
//            markdown renderer, an HTTP client, a query library, Base UI, or @nerey/theme.
//   Manifest packages/core/package.json declares no dependency outside the allowlist, and no
//            dependency at all on @nerey/theme.
//   Build    packages/core/dist contains zero .css files (only checked if dist exists, so the
//            gate is useful before a build as well as after).
//
// The manifest check matters more than it looks: a source-only check passes happily while a
// transitive dependency drags Zod into every consumer's install.
//
// Usage:
//   node scripts/check-core-purity.mjs
//   node scripts/check-core-purity.mjs --self-test

import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const CORE_SRC = resolve(repoRoot, 'packages/core/src');
const CORE_PKG = resolve(repoRoot, 'packages/core/package.json');
const CORE_DIST = resolve(repoRoot, 'packages/core/dist');

/** The only runtime dependencies @nerey/core may declare. */
const ALLOWED_DEPENDENCIES = new Set(['@standard-schema/spec']);

const BANNED_IMPORTS = [
  {
    rule: 'no-theme-dependency',
    test: /@nerey\/theme/,
    detail:
      'the dependency arrow points theme → core and never back (ADR 0002); core importing the ' +
      'theme would make the headless package drag CSS into every consumer',
  },
  {
    rule: 'no-validator',
    test: /^(zod|valibot|arktype|yup|joi)(\/|$)/,
    detail:
      'core validates through Standard Schema v1 so a consumer can bring their own validator ' + '(ADR 0011)',
  },
  {
    rule: 'no-markdown',
    test: /^(react-markdown|marked|markdown-it|remark-|rehype-)/,
    detail: 'the fallback renderer is injected through the host value, not bundled (ADR 0012)',
  },
  {
    rule: 'no-http',
    test: /^(axios|ofetch|ky|got|superagent)(\/|$)/,
    detail: 'core performs no I/O; persistence goes through the MessagePersistence port (ADR 0016)',
  },
  {
    rule: 'no-query-library',
    test: /^(@tanstack\/(react-)?query|swr)(\/|$)/,
    detail: 'the server cache belongs to the consumer, behind the persistence port (ADR 0016)',
  },
  {
    rule: 'no-behavioural-primitives',
    test: /^(@base-ui\/|@radix-ui\/|react-aria|@ark-ui\/)/,
    detail: 'behavioural primitives belong to @nerey/theme, wrapped and never re-exported (ADR 0022)',
  },
];

const IMPORT_RE =
  /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function checkSourceFile(absPath) {
  const rel = relative(repoRoot, absPath).split(sep).join('/');
  const source = readFileSync(absPath, 'utf8');
  const problems = [];

  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (!specifier) continue;
    const line = lineOf(source, match.index ?? 0);

    if (specifier.endsWith('.css')) {
      problems.push({
        rel,
        line,
        rule: 'no-css-in-core',
        detail: `imports \`${specifier}\` — @nerey/core ships zero CSS (ADR 0002); styling happens through the data-* contract (ADR 0020)`,
      });
      continue;
    }

    for (const banned of BANNED_IMPORTS) {
      if (banned.test.test(specifier)) {
        problems.push({
          rel,
          line,
          rule: banned.rule,
          detail: `imports \`${specifier}\` — ${banned.detail}`,
        });
      }
    }
  }

  return problems;
}

function checkManifest() {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(CORE_PKG, 'utf8'));
  } catch {
    return [{ rel: 'packages/core/package.json', line: 1, rule: 'manifest', detail: 'unreadable' }];
  }

  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (!ALLOWED_DEPENDENCIES.has(name)) {
      problems.push({
        rel: 'packages/core/package.json',
        line: 1,
        rule: 'no-runtime-dependency',
        detail:
          `declares \`${name}\` as a runtime dependency. @nerey/core's allowlist is ` +
          `{${[...ALLOWED_DEPENDENCIES].join(', ')}} — everything else is a port, not a dependency ` +
          `(ADR 0011 / 0012 / 0016 / 0037). If this is genuinely needed, it needs an ADR first.`,
      });
    }
  }

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (manifest[field]?.['@nerey/theme']) {
      problems.push({
        rel: 'packages/core/package.json',
        line: 1,
        rule: 'no-theme-dependency',
        detail: `declares @nerey/theme in ${field} — the dependency arrow only points theme → core (ADR 0002)`,
      });
    }
  }

  return problems;
}

function checkDist() {
  if (!existsSync(CORE_DIST)) return [];
  const css = walk(CORE_DIST, (f) => f.endsWith('.css'));
  return css.map((f) => ({
    rel: relative(repoRoot, f).split(sep).join('/'),
    line: 1,
    rule: 'no-css-in-core',
    detail:
      'a stylesheet was emitted into @nerey/core/dist — the package must ship zero CSS (ADR 0002, AC-1)',
  }));
}

function run() {
  // Tests, stories and fixtures are excluded: the purity claim is about the PUBLISHED bundle,
  // and `files: ["dist", "README.md"]` means none of them ship. A core test that imports Zod to
  // exercise Standard Schema is exactly right, and the first version of this gate rejected it —
  // the manifest and dist checks below are what actually guard the shipped artifact.
  const sources = walk(
    CORE_SRC,
    (f) =>
      /\.(ts|tsx)$/.test(f) &&
      !f.endsWith('.d.ts') &&
      !/\.(test|spec|stories)\.tsx?$/.test(f) &&
      !/(^|\/)__(tests|fixtures|mocks)__\//.test(f),
  );
  return {
    fileCount: sources.length,
    problems: [...sources.flatMap(checkSourceFile), ...checkManifest(), ...checkDist()],
  };
}

if (process.argv.includes('--self-test')) {
  // ADR 0033 — every rule must reject a planted violator.
  const fixtureDir = resolve(CORE_SRC, '__puritycheck__');
  const fixture = join(fixtureDir, 'planted.ts');
  const CASES = [
    ['no-css-in-core', "import './x.css';"],
    ['no-theme-dependency', "import { x } from '@nerey/theme';"],
    ['no-validator', "import { z } from 'zod';"],
    ['no-markdown', "import ReactMarkdown from 'react-markdown';"],
    ['no-http', "import axios from 'axios';"],
    ['no-query-library', "import { useQuery } from '@tanstack/react-query';"],
    ['no-behavioural-primitives', "import { Dialog } from '@base-ui/react/dialog';"],
  ];

  const outcomes = [];
  try {
    mkdirSync(fixtureDir, { recursive: true });
    for (const [rule, code] of CASES) {
      writeFileSync(fixture, code, 'utf8');
      outcomes.push([rule, checkSourceFile(fixture).some((p) => p.rule === rule)]);
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }

  // The manifest rule needs its own violator, planted in memory rather than on disk.
  const manifestOriginal = readFileSync(CORE_PKG, 'utf8');
  let manifestFired = false;
  try {
    const corrupted = JSON.parse(manifestOriginal);
    corrupted.dependencies = { ...corrupted.dependencies, zod: '^4.0.0' };
    writeFileSync(CORE_PKG, `${JSON.stringify(corrupted, null, 2)}\n`, 'utf8');
    manifestFired = checkManifest().some((p) => p.rule === 'no-runtime-dependency');
  } finally {
    writeFileSync(CORE_PKG, manifestOriginal, 'utf8');
  }
  outcomes.push(['no-runtime-dependency', manifestFired]);

  let failures = 0;
  for (const [rule, fired] of outcomes) {
    if (fired) console.log(`  ✓ check-core-purity/${rule} — rejected its violator`);
    else {
      console.error(`  ✗ check-core-purity/${rule} — did NOT reject its violator (gate is broken)`);
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const { fileCount, problems } = run();

if (problems.length) {
  console.error(`✗ core purity: ${problems.length} violation(s)\n`);
  for (const p of problems) console.error(`  ${p.rel}:${p.line}  [${p.rule}] ${p.detail}`);
  process.exit(1);
}

console.log(`✓ core purity: ${fileCount} source file(s), manifest and dist clean`);
