#!/usr/bin/env node
// scripts/check-security-policy.mjs
//
// ADR 0053 — the security policy names a private channel, covers every published package and
// points at a threat model that exists.
//
// A policy goes stale in the least visible way: a package is added, nobody edits `SECURITY.md`, and
// a reporter who finds a bug in the new package reads that it is not supported. The reporting
// channel goes the same way when someone "simplifies" the file. This gate checks structure, not
// truth — a threat model can cite a record whose defence has weakened — and ADR 0053 says so.
//
// Rules:
//
//   missing-policy               `SECURITY.md` does not exist at the repository root.
//   no-reporting-channel         the policy does not name GitHub Private Vulnerability Reporting.
//   missing-package-row          a non-private workspace package under `packages/*` has no row in a
//                                Markdown table whose first cell names it.
//   missing-threat-model-link    the policy does not link to `docs/security/threat-model.md`.
//   missing-threat-model         `docs/security/threat-model.md` does not exist.
//   no-packages                  no published package was found. A gate whose input silently
//                                emptied passes everything by having nothing to compare.
//
// Usage:
//   node scripts/check-security-policy.mjs
//   node scripts/check-security-policy.mjs --self-test   plant a violator per rule, assert each fires

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

const POLICY = 'SECURITY.md';
const THREAT_MODEL = 'docs/security/threat-model.md';
const CHANNEL_RE = /private\s+vulnerability\s+reporting/i;
const LINK_RE = /\]\(\s*(?:\.\/)?docs\/security\/threat-model\.md(?:#[^)]*)?\s*\)/;

/** Every non-private package under `<root>/packages/*`, by its manifest name. */
export function publishedPackages(root) {
  const dir = join(root, 'packages');
  if (!existsSync(dir)) return [];
  const names = [];
  for (const entry of readdirSync(dir).sort()) {
    const manifest = join(dir, entry, 'package.json');
    if (!existsSync(manifest)) continue;
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    if (parsed.private !== true && typeof parsed.name === 'string') names.push(parsed.name);
  }
  return names;
}

/** The first cell of every Markdown table row, header and separator rows included. */
function firstCells(markdown) {
  const cells = [];
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    cells.push(trimmed.slice(1).split('|')[0]?.trim() ?? '');
  }
  return cells;
}

/** Pure over its inputs, so the self-test runs exactly the code path the real run does. */
export function checkRoot(root) {
  const problems = [];
  const packages = publishedPackages(root);
  if (packages.length === 0) {
    problems.push({
      rule: 'no-packages',
      message:
        'no non-private package was found under packages/*. Either the layout moved or this gate ' +
        'has stopped looking, and a gate that has stopped looking reports a clean result forever.',
    });
  }

  const policyPath = join(root, POLICY);
  if (!existsSync(policyPath)) {
    problems.push({
      rule: 'missing-policy',
      message: `${POLICY} does not exist. A reporter needs a private channel before they need anything else (ADR 0053).`,
    });
  } else {
    const policy = readFileSync(policyPath, 'utf8');
    if (!CHANNEL_RE.test(policy)) {
      problems.push({
        rule: 'no-reporting-channel',
        message:
          `${POLICY} does not name GitHub Private Vulnerability Reporting. It is the only channel ` +
          'ADR 0053 publishes; without it a reporter opens a public issue.',
      });
    }
    const cells = firstCells(policy);
    for (const name of packages) {
      if (!cells.some((cell) => cell.replaceAll('`', '') === name)) {
        problems.push({
          rule: 'missing-package-row',
          message:
            `${POLICY}'s supported-versions table has no row for \`${name}\`. A reporter reads a ` +
            'package with no row as unsupported. Add one naming the release line that receives fixes.',
        });
      }
    }
    if (!LINK_RE.test(policy)) {
      problems.push({
        rule: 'missing-threat-model-link',
        message: `${POLICY} does not link to ${THREAT_MODEL}, which defines what is in scope to report.`,
      });
    }
  }

  if (!existsSync(join(root, THREAT_MODEL))) {
    problems.push({
      rule: 'missing-threat-model',
      message: `${THREAT_MODEL} does not exist. ADR 0053 names it as the definition of what to report.`,
    });
  }

  return { problems, packages };
}

function selfTest() {
  // ADR 0033 — each rule rejects a planted violator, and a complete policy stays silent. Fixtures go
  // through disk so the blind probe has a read to take away.
  const GOOD = [
    '# Security',
    '',
    'Report through GitHub Private Vulnerability Reporting.',
    '',
    '| Package | Supported |',
    '| --- | --- |',
    '| `@nerey/a` | 0.1.x |',
    '| `@nerey/b` | 0.1.x |',
    '',
    'See the [threat model](docs/security/threat-model.md).',
    '',
  ].join('\n');

  const without = (text, needle) =>
    text
      .split('\n')
      .filter((line) => !line.includes(needle))
      .join('\n');

  const CASES = [
    ['missing-policy', { policy: null }],
    ['no-reporting-channel', { policy: without(GOOD, 'Private Vulnerability') }],
    ['missing-package-row', { policy: without(GOOD, '@nerey/b') }],
    // A package named only in prose is not a row in the table.
    [
      'missing-package-row',
      { policy: without(GOOD, '@nerey/b').replace('# Security', '# Security for @nerey/b') },
    ],
    ['missing-threat-model-link', { policy: without(GOOD, 'threat model') }],
    ['missing-threat-model', { threatModel: false }],
    ['no-packages', { packages: [] }],
  ];

  const ALLOWED = [
    ['a complete policy', {}],
    ['a private package with no row', { packages: ['@nerey/a', '@nerey/b', '!@nerey/private'] }],
    [
      'a relative ./ link with an anchor',
      { policy: GOOD.replace('](docs/', '](./docs/').replace('.md)', '.md#assets)') },
    ],
  ];

  function plant(dir, { policy = GOOD, threatModel = true, packages = ['@nerey/a', '@nerey/b'] }) {
    for (const name of packages) {
      const isPrivate = name.startsWith('!');
      const clean = isPrivate ? name.slice(1) : name;
      const pkgDir = join(dir, 'packages', clean.split('/').pop());
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name: clean, ...(isPrivate ? { private: true } : {}) }),
      );
    }
    // `null` plants no policy at all; `undefined` would take the default above.
    if (policy !== null) writeFileSync(join(dir, POLICY), policy, 'utf8');
    if (threatModel) {
      mkdirSync(join(dir, 'docs/security'), { recursive: true });
      writeFileSync(join(dir, THREAT_MODEL), '# Threat model\n', 'utf8');
    }
  }

  const outcomes = [];
  for (const [rule, fixture] of CASES) {
    const dir = mkdtempSync(join(tmpdir(), 'nerey-security-policy-'));
    try {
      plant(dir, fixture);
      const { problems } = checkRoot(dir);
      outcomes.push([rule, problems.some((p) => p.rule === rule)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  for (const [name, fixture] of ALLOWED) {
    const dir = mkdtempSync(join(tmpdir(), 'nerey-security-policy-'));
    try {
      plant(dir, fixture);
      const { problems } = checkRoot(dir);
      outcomes.push([`allows ${name}`, problems.length === 0, problems.map((p) => p.rule).join(', ')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // The live layout must still yield packages, or every rule above passes against nothing.
  outcomes.push(['reads the live workspace packages', publishedPackages(repoRoot).length > 0, 'none found']);

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ') && !rule.startsWith('reads ');
    if (ok) {
      console.log(`  ✓ check-security-policy/${rule} — ${positive ? 'rejected its violator' : 'holds'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-security-policy/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-security-policy/${rule} — failed on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

const { problems, packages } = checkRoot(repoRoot);

if (problems.length > 0) {
  console.error(`\n✗ security policy: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error(`  [${problem.rule}] ${problem.message}`);
  process.exit(1);
}

console.log(
  `✓ security policy: ${POLICY} names a private channel, covers ${packages.length} package(s) and ` +
    `links an existing ${THREAT_MODEL}`,
);
