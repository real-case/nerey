#!/usr/bin/env node
// scripts/check-lifecycle-mutants.mjs
//
// ADR 0046 / 0047 — the reload test must be able to fail.
//
// D-8 passed every gate because every gate checks form: the lifecycle measured `timeout` from mount
// and stored no marker, and the tests that existed asserted exactly that. A test suite that agrees
// with a wrong implementation is not evidence. This gate re-plants the implementation D-8 described,
// one defect at a time, runs `lifecycle-reload.test.tsx` against it, and requires the run to fail.
//
// Rules:
//
//   survived-mutant  the reload test PASSED with a known-wrong implementation in place, so it no
//                    longer guards the behaviour ADR 0046 records.
//   missing-anchor   a mutant's search text is not in the source. The lifecycle was rewritten and
//                    the mutant no longer applies; a gate that silently skips it passes everything.
//   baseline-red     the reload test fails against the real implementation, so a "killed" mutant
//                    would prove nothing.
//
// The source file is mutated in place and restored in a `finally` (and on SIGINT/SIGTERM), because
// Vitest resolves the module graph from the workspace and a copy elsewhere would not be what runs.
// Runs are sequential for the same reason.
//
// Usage:
//   node scripts/check-lifecycle-mutants.mjs
//   node scripts/check-lifecycle-mutants.mjs --self-test   plant a violator per rule, assert each fires

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const SOURCE = resolve(repoRoot, 'packages/core/src/lifecycle/use-widget-lifecycle.tsx');
const TEST = 'packages/core/src/lifecycle/lifecycle-reload.test.tsx';

function relOf(absPath) {
  return relative(repoRoot, absPath).split(sep).join('/');
}

/** The implementation D-8 described, split into its two defects. Each is a list of replacements. */
export const MUTANTS = [
  {
    name: 'timeout measured from mount',
    edits: [
      [
        '  const clock = host.now ?? Date.now;\n',
        '  const clock = host.now ?? Date.now;\n  const [mountedAt] = useState(() => clock());\n',
      ],
      [
        '  const signals: LifecycleSignals = {\n    interactions,\n    createdAt,\n',
        '  const signals: LifecycleSignals = {\n    interactions,\n    createdAt: mountedAt,\n',
      ],
    ],
  },
  {
    name: 'no expiry marker',
    edits: [
      ["    return durable && actionBearing ? 'pending' : 'none';\n", "    return 'none';\n"],
      [
        '    if (durable && persistence.updateLifecycleRecord) {\n',
        '    if (durable && persistence.updateLifecycleRecord && false) {\n',
      ],
    ],
  },
];

/** Applies `edits` to `text`; returns the mutated text, or the first search string that is absent. */
export function applyEdits(text, edits) {
  let out = text;
  for (const [search, replace] of edits) {
    if (!out.includes(search)) return { missing: search };
    out = out.replace(search, replace);
  }
  return { text: out };
}

/**
 * Pure over its inputs: `read` / `write` touch the source, `run` runs the test and returns true when
 * it passed. The self-test drives exactly this function with stubs.
 */
export function analyse({ read, write, run, mutants }) {
  const original = read();
  const violations = [];
  if (!run()) {
    violations.push({ rule: 'baseline-red', mutant: '(none)' });
    return violations;
  }
  try {
    for (const mutant of mutants) {
      const result = applyEdits(original, mutant.edits);
      if (result.missing !== undefined) {
        violations.push({ rule: 'missing-anchor', mutant: mutant.name, detail: result.missing.trim() });
        continue;
      }
      write(result.text);
      try {
        if (run()) violations.push({ rule: 'survived-mutant', mutant: mutant.name });
      } finally {
        write(original);
      }
    }
  } finally {
    write(original);
  }
  return violations;
}

function runVitest() {
  const result = spawnSync('npx', ['vitest', 'run', '--project', 'unit', TEST], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: process.env.CI ?? '1' },
  });
  return result.status === 0;
}

function selfTest() {
  // ADR 0033 — each rule rejects a planted violator, and a well-guarded source stays silent.
  const SOURCE_TEXT = 'anchor-a\nanchor-b\n';
  const mutants = [{ name: 'flip a', edits: [['anchor-a', 'mutant-a']] }];
  const harness = (runner) => {
    let text = SOURCE_TEXT;
    const violations = analyse({
      read: () => text,
      write: (t) => (text = t),
      run: () => runner(text),
      mutants,
    });
    return { violations, restored: text === SOURCE_TEXT };
  };

  const outcomes = [];

  // A test that never looks at the mutated line passes against the mutant.
  const blind = harness(() => true);
  outcomes.push([
    'survived-mutant',
    blind.violations.some((v) => v.rule === 'survived-mutant'),
    JSON.stringify(blind.violations),
  ]);

  let text = SOURCE_TEXT;
  const drifted = analyse({
    read: () => text,
    write: (t) => (text = t),
    run: () => true,
    mutants: [{ name: 'gone', edits: [['no-such-anchor', 'x']] }],
  });
  outcomes.push([
    'missing-anchor',
    drifted.some((v) => v.rule === 'missing-anchor'),
    JSON.stringify(drifted),
  ]);

  const red = harness(() => false);
  outcomes.push([
    'baseline-red',
    red.violations.some((v) => v.rule === 'baseline-red'),
    JSON.stringify(red.violations),
  ]);

  // A test that fails exactly when the mutant is in: silent, and the source is restored.
  const guarded = harness((t) => !t.includes('mutant-a'));
  outcomes.push([
    'allows a test that kills every mutant',
    guarded.violations.length === 0,
    JSON.stringify(guarded.violations),
  ]);
  outcomes.push(['allows nothing to leak: the source is restored', guarded.restored && blind.restored, '']);

  // The real mutants still apply to the real source, so the main run cannot pass on nothing.
  const real = readFileSync(SOURCE, 'utf8');
  const stale = MUTANTS.filter((m) => applyEdits(real, m.edits).missing !== undefined).map((m) => m.name);
  outcomes.push([
    'allows the shipped mutants against the shipped source',
    stale.length === 0,
    stale.join(', '),
  ]);

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ');
    if (ok) {
      console.log(
        `  ✓ check-lifecycle-mutants/${rule} — ${positive ? 'rejected its violator' : 'stayed silent'}`,
      );
    } else {
      console.error(
        positive
          ? `  ✗ check-lifecycle-mutants/${rule} — did NOT reject its violator (gate is broken) [${detail}]`
          : `  ✗ check-lifecycle-mutants/${rule} — failed on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

const original = readFileSync(SOURCE, 'utf8');
const restore = () => writeFileSync(SOURCE, original, 'utf8');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}

const violations = analyse({
  read: () => readFileSync(SOURCE, 'utf8'),
  write: (text) => writeFileSync(SOURCE, text, 'utf8'),
  run: runVitest,
  mutants: MUTANTS,
});
restore();

if (violations.length) {
  console.error(`✗ lifecycle mutants: ${violations.length} problem(s) with ${TEST}\n`);
  for (const v of violations) {
    const why = {
      'survived-mutant': `passed with this defect planted in ${relOf(SOURCE)}; the test no longer guards it`,
      'missing-anchor': `its search text is gone from ${relOf(SOURCE)} [${v.detail}]; update the mutant to the new source`,
      'baseline-red': 'the test fails against the real implementation, so no mutant result means anything',
    }[v.rule];
    console.error(`  [${v.rule}] ${v.mutant} — ${why} (ADR 0046).`);
  }
  process.exit(1);
}

console.log(`✓ lifecycle mutants: ${TEST} kills all ${MUTANTS.length} planted D-8 defects`);
