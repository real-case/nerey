#!/usr/bin/env node
// scripts/check-package-purity.mjs
//
// ADR 0051 (generalising ADR 0011 / 0012 / 0022 / 0037) — every published package declares only
// the dependencies its row below allows, and no published package carries analytics or telemetry.
// It replaces `check-core-purity.mjs`, whose checks of core are carried over unchanged as core's
// row.
//
// For every package under packages/* that is not `private`:
//
//   Row      the package has a row in PACKAGES. A new package with no row fails, because a package
//            nobody described is a package whose dependencies nobody reviewed.
//   Manifest `dependencies` ⊆ the row's allowlist (an adapter's allowlist is EMPTY: its SDK is a
//            peer, ADR 0051); `peerDependencies` ⊆ the row's peer allowlist; no analytics or
//            telemetry package in `dependencies`, `peerDependencies` or `optionalDependencies`.
//   Source   no import the row bans. Core bans what core-purity banned plus every LLM SDK and agent
//            protocol (`@ag-ui/*`, `ai`, `@ai-sdk/*`, …) and every adapter package; an adapter bans
//            `@nerey/theme`, CSS, deep reaches into core, I/O and query libraries; every package
//            bans telemetry. Tests, stories and fixtures are not judged — they do not ship.
//   Build    for packages that must ship zero CSS, `dist` contains no `.css` (only when it exists).
//
// Usage:
//   node scripts/check-package-purity.mjs
//   node scripts/check-package-purity.mjs --self-test

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const PACKAGES_DIR = resolve(repoRoot, 'packages');

/* ── The shared banned sets ──────────────────────────────────────────────────────────── */

/** ADR 0051 — no published package collects analytics or telemetry. Matched on package names. */
const TELEMETRY =
  /^(@segment\/|posthog-|@posthog\/|@scarf\/scarf$|mixpanel|@sentry\/|@amplitude\/|@datadog\/|@vercel\/analytics$)/;

const ADAPTER_PACKAGES = /^@nerey\/(ag-ui|ai-sdk)(\/|$)/;

const RULES = {
  'no-telemetry': {
    test: (s) => TELEMETRY.test(s),
    detail: 'no published package collects analytics or telemetry (ADR 0051)',
  },
  'no-theme-dependency': {
    test: (s) => /^@nerey\/theme(\/|$)/.test(s),
    detail:
      'the dependency arrow points theme → core and never back, and no adapter reaches the theme ' +
      '(ADR 0051); a headless package importing it would drag CSS into every consumer',
  },
  'no-validator': {
    test: (s) => /^(zod|valibot|arktype|yup|joi)(\/|$)/.test(s),
    detail:
      'core validates through Standard Schema v1 so a consumer can bring their own validator (ADR 0011)',
  },
  'no-markdown': {
    test: (s) => /^(react-markdown|marked|markdown-it|remark-|rehype-)/.test(s),
    detail: 'the fallback renderer is injected through the host value, not bundled (ADR 0012)',
  },
  'no-http': {
    test: (s) => /^(axios|ofetch|ky|got|superagent|node-fetch)(\/|$)/.test(s),
    detail: 'the runtime performs no I/O of its own; transports are the consumer’s (ADR 0016 / 0037)',
  },
  'no-query-library': {
    test: (s) => /^(@tanstack\/(react-)?query|swr)(\/|$)/.test(s),
    detail: 'the server cache belongs to the consumer, behind the persistence port (ADR 0016)',
  },
  'no-behavioural-primitives': {
    test: (s) => /^(@base-ui\/|@radix-ui\/|react-aria|@ark-ui\/)/.test(s),
    detail: 'behavioural primitives belong to @nerey/theme, wrapped and never re-exported (ADR 0022)',
  },
  'no-llm-sdk-in-core': {
    test: (s) =>
      /^(@ag-ui\/|ai$|ai\/|@ai-sdk\/|openai(\/|$)|@anthropic-ai\/|@langchain\/|langchain(\/|$)|@copilotkit\/)/.test(
        s,
      ),
    detail:
      'LLM SDKs and agent protocols are adapter points, shipped as separate packages that take core ' +
      'as a peer (ADR 0037 / 0051)',
  },
  'no-adapter-in-core': {
    test: (s) => ADAPTER_PACKAGES.test(s),
    detail: 'core never imports an adapter; the arrow points adapter → core (ADR 0051)',
  },
  'no-deep-core-import': {
    // Core's public entry points are read from its exports map, so a new entry needs no edit here.
    test: (s) => /^@nerey\/core(\/|$)/.test(s) && !coreEntryPoints().has(s),
    detail: 'an adapter imports core only through its public entry points (ADR 0028 / 0051)',
  },
};

const CORE_RULES = [
  'no-telemetry',
  'no-theme-dependency',
  'no-validator',
  'no-markdown',
  'no-http',
  'no-query-library',
  'no-behavioural-primitives',
  'no-llm-sdk-in-core',
  'no-adapter-in-core',
];

const ADAPTER_RULES = [
  'no-telemetry',
  'no-theme-dependency',
  'no-markdown',
  'no-http',
  'no-query-library',
  'no-behavioural-primitives',
  'no-deep-core-import',
];

/* ── The manifest of published packages ──────────────────────────────────────────────── */

/**
 * One row per published package. `peers` entries are exact names or a RegExp; `css: false` means
 * the package must ship zero CSS, in source and in `dist`. An adapter's `dependencies` is empty by
 * rule (ADR 0051), so its row has no `dependencies` field to loosen.
 */
const PACKAGES = {
  '@nerey/core': {
    src: 'packages/core/src',
    dependencies: ['@standard-schema/spec'],
    peers: ['react', 'react-dom'],
    rules: CORE_RULES,
    css: false,
  },
  '@nerey/theme': {
    src: 'packages/theme/src',
    dependencies: ['@base-ui/react', 'zod'],
    peers: ['@nerey/core', 'react', 'react-dom'],
    rules: ['no-telemetry', 'no-adapter-in-core'],
    css: true,
  },
  '@nerey/eslint-config': {
    src: 'packages/eslint-config',
    dependencies: [],
    peers: ['eslint'],
    rules: ['no-telemetry'],
    css: true,
  },
  '@nerey/ag-ui': {
    src: 'packages/ag-ui/src',
    adapter: true,
    peers: ['@nerey/core', 'react', 'react-dom', '@ag-ui/core'],
    rules: ADAPTER_RULES,
    css: false,
  },
  '@nerey/ai-sdk': {
    src: 'packages/ai-sdk/src',
    adapter: true,
    peers: ['@nerey/core', 'react', 'react-dom', 'ai', /^@ai-sdk\//],
    rules: ADAPTER_RULES,
    css: false,
  },
};

/* ── Helpers ─────────────────────────────────────────────────────────────────────────── */

const IMPORT_RE =
  /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

let coreEntryCache;
function coreEntryPoints() {
  if (!coreEntryCache) {
    const manifest = JSON.parse(readFileSync(resolve(PACKAGES_DIR, 'core/package.json'), 'utf8'));
    coreEntryCache = new Set(
      Object.keys(manifest.exports ?? {})
        .filter((key) => key !== './package.json')
        .map((key) => (key === '.' ? '@nerey/core' : `@nerey/core/${key.slice(2)}`)),
    );
  }
  return coreEntryCache;
}

const rel = (abs) => relative(repoRoot, abs).split(sep).join('/');

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const isShippingSource = (f) =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) &&
  !f.endsWith('.d.ts') &&
  !/\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(f) &&
  !/(^|\/)__(tests|fixtures|mocks)__\//.test(f) &&
  !/(^|\/)(vite|vitest)\.config\.[cm]?[jt]s$/.test(f);

const matchesName = (allowed, name) =>
  allowed.some((entry) => (entry instanceof RegExp ? entry.test(name) : entry === name));

/* ── Checks ──────────────────────────────────────────────────────────────────────────── */

export function checkSourceFile(absPath, row) {
  const source = readFileSync(absPath, 'utf8');
  const problems = [];

  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (!specifier) continue;
    const line = source.slice(0, match.index ?? 0).split('\n').length;

    if (row.css === false && specifier.endsWith('.css')) {
      problems.push({
        rel: rel(absPath),
        line,
        rule: 'no-css',
        detail: `imports \`${specifier}\` — this package ships zero CSS (ADR 0051); style through the data-* contract (ADR 0020)`,
      });
      continue;
    }

    for (const name of row.rules) {
      const rule = RULES[name];
      if (rule.test(specifier)) {
        problems.push({
          rel: rel(absPath),
          line,
          rule: name,
          detail: `imports \`${specifier}\` — ${rule.detail}`,
        });
      }
    }
  }

  return problems;
}

export function checkManifest(absPath, row) {
  const where = rel(absPath);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(absPath, 'utf8'));
  } catch {
    return [{ rel: where, line: 1, rule: 'manifest', detail: 'unreadable' }];
  }

  const problems = [];
  const allowedDeps = row.adapter ? [] : (row.dependencies ?? []);

  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (matchesName(allowedDeps, name)) continue;
    problems.push({
      rel: where,
      line: 1,
      rule: row.adapter ? 'adapter-has-dependencies' : 'no-runtime-dependency',
      detail: row.adapter
        ? `declares \`${name}\` in dependencies — an adapter's dependencies are empty; its SDK, core and react are peers (ADR 0051)`
        : `declares \`${name}\` as a runtime dependency, outside ${manifest.name}'s allowlist. If it is genuinely needed, it needs an ADR first (ADR 0051).`,
    });
  }

  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (matchesName(row.peers ?? [], name)) continue;
    problems.push({
      rel: where,
      line: 1,
      rule: 'peer-not-allowed',
      detail: `declares \`${name}\` as a peer, outside ${manifest.name}'s allowlist (ADR 0051)`,
    });
  }

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (TELEMETRY.test(name)) {
        problems.push({
          rel: where,
          line: 1,
          rule: 'no-telemetry',
          detail: `declares \`${name}\` in ${field} — ${RULES['no-telemetry'].detail}`,
        });
      }
      if (row.rules.includes('no-theme-dependency') && name === '@nerey/theme') {
        problems.push({
          rel: where,
          line: 1,
          rule: 'no-theme-dependency',
          detail: `declares @nerey/theme in ${field} — ${RULES['no-theme-dependency'].detail}`,
        });
      }
    }
  }

  return problems;
}

function checkDist(pkgDir, row) {
  const dist = join(pkgDir, 'dist');
  if (row.css !== false || !existsSync(dist)) return [];
  return walk(dist, (f) => f.endsWith('.css')).map((f) => ({
    rel: rel(f),
    line: 1,
    rule: 'no-css',
    detail: 'a stylesheet was emitted into dist — this package must ship zero CSS (ADR 0051, AC-1)',
  }));
}

function run() {
  const problems = [];
  let fileCount = 0;
  let packageCount = 0;

  for (const dir of readdirSync(PACKAGES_DIR)) {
    const pkgDir = join(PACKAGES_DIR, dir);
    const manifestPath = join(pkgDir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.private) continue;

    const row = PACKAGES[manifest.name];
    if (!row) {
      problems.push({
        rel: rel(manifestPath),
        line: 1,
        rule: 'unlisted-package',
        detail:
          `${manifest.name} is published but has no row in scripts/check-package-purity.mjs. Add one ` +
          `stating its allowed dependencies and peers (ADR 0051).`,
      });
      continue;
    }

    packageCount++;
    problems.push(...checkManifest(manifestPath, row));
    const sources = walk(resolve(repoRoot, row.src), isShippingSource);
    fileCount += sources.length;
    for (const file of sources) problems.push(...checkSourceFile(file, row));
    problems.push(...checkDist(pkgDir, row));
  }

  return { packageCount, fileCount, problems };
}

/* ── Self-test (ADR 0033) ────────────────────────────────────────────────────────────── */

if (process.argv.includes('--self-test')) {
  const fixtureDir = resolve(PACKAGES_DIR, 'core/src/__puritycheck__');
  const source = join(fixtureDir, 'planted.ts');
  const manifestFile = join(fixtureDir, 'package.json');
  const core = PACKAGES['@nerey/core'];
  const adapter = PACKAGES['@nerey/ag-ui'];

  /** [label, row, code, rule] — every source rule, against the row that enforces it. */
  const SOURCE_CASES = [
    ['core', core, "import './x.css';", 'no-css'],
    ['core', core, "import { x } from '@nerey/theme';", 'no-theme-dependency'],
    ['core', core, "import { z } from 'zod';", 'no-validator'],
    ['core', core, "import ReactMarkdown from 'react-markdown';", 'no-markdown'],
    ['core', core, "import axios from 'axios';", 'no-http'],
    ['core', core, "import { useQuery } from '@tanstack/react-query';", 'no-query-library'],
    ['core', core, "import { Dialog } from '@base-ui/react/dialog';", 'no-behavioural-primitives'],
    ['core', core, "import { streamText } from 'ai';", 'no-llm-sdk-in-core'],
    ['core', core, "import type { BaseEvent } from '@ag-ui/core';", 'no-llm-sdk-in-core'],
    ['core', core, "import { createAgUiHost } from '@nerey/ag-ui';", 'no-adapter-in-core'],
    ['core', core, "import { Analytics } from '@segment/analytics-node';", 'no-telemetry'],
    ['adapter', adapter, "import { Poll } from '@nerey/theme';", 'no-theme-dependency'],
    ['adapter', adapter, "import './adapter.css';", 'no-css'],
    ['adapter', adapter, "import { x } from '@nerey/core/src/types';", 'no-deep-core-import'],
    ['adapter', adapter, "import ky from 'ky';", 'no-http'],
    ['adapter', adapter, "import posthog from 'posthog-js';", 'no-telemetry'],
  ];

  /** [label, row, manifest, rule] — every manifest rule. */
  const MANIFEST_CASES = [
    ['core', core, { name: '@nerey/core', dependencies: { zod: '^4.0.0' } }, 'no-runtime-dependency'],
    ['core', core, { name: '@nerey/core', dependencies: { ai: '^5.0.0' } }, 'no-runtime-dependency'],
    ['core', core, { name: '@nerey/core', peerDependencies: { '@nerey/theme': '*' } }, 'no-theme-dependency'],
    [
      'adapter',
      adapter,
      { name: '@nerey/ag-ui', dependencies: { '@ag-ui/core': '^1.0.0' } },
      'adapter-has-dependencies',
    ],
    ['adapter', adapter, { name: '@nerey/ag-ui', peerDependencies: { rxjs: '^7.0.0' } }, 'peer-not-allowed'],
    [
      'adapter',
      adapter,
      { name: '@nerey/ag-ui', optionalDependencies: { '@segment/analytics-node': '^2.0.0' } },
      'no-telemetry',
    ],
  ];

  const outcomes = [];
  try {
    mkdirSync(fixtureDir, { recursive: true });
    for (const [label, row, code, rule] of SOURCE_CASES) {
      writeFileSync(source, code, 'utf8');
      outcomes.push([
        `${label}/${rule} (${code})`,
        checkSourceFile(source, row).some((p) => p.rule === rule),
      ]);
    }
    for (const [label, row, manifest, rule] of MANIFEST_CASES) {
      writeFileSync(manifestFile, JSON.stringify(manifest), 'utf8');
      outcomes.push([
        `${label}/manifest/${rule}`,
        checkManifest(manifestFile, row).some((p) => p.rule === rule),
      ]);
    }

    // A clean adapter source must pass: the gate rejects violators, not adapters.
    writeFileSync(
      source,
      "import { describeRegistry } from '@nerey/core';\nimport type { BaseEvent } from '@ag-ui/core';",
      'utf8',
    );
    outcomes.push(['adapter/clean source accepted', checkSourceFile(source, adapter).length === 0]);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [label, fired] of outcomes) {
    if (fired) console.log(`  ✓ check-package-purity/${label}`);
    else {
      console.error(`  ✗ check-package-purity/${label} — did NOT behave as required (gate is broken)`);
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const { packageCount, fileCount, problems } = run();

if (problems.length) {
  console.error(`✗ package purity: ${problems.length} violation(s)\n`);
  for (const p of problems) console.error(`  ${p.rel}:${p.line}  [${p.rule}] ${p.detail}`);
  process.exit(1);
}

console.log(
  `✓ package purity: ${packageCount} package(s), ${fileCount} source file(s), manifests and dist clean`,
);
