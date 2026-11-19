#!/usr/bin/env node
// scripts/check-mutants.mjs
//
// ADR 0046 / 0047 — the tests that guard the runtime's promises must be able to fail.
//
// D-8 passed every gate because every gate checks form: the lifecycle measured `timeout` from mount
// and stored no marker, and the tests that existed asserted exactly that. A test suite that agrees
// with a wrong implementation is not evidence. This gate re-plants known-wrong implementations, one
// defect at a time, runs the test file that is supposed to catch each, and requires the run to fail.
//
// Each suite names a source file, the test file that guards it, and its mutants:
//
//   lifecycle    use-widget-lifecycle.tsx  ×  lifecycle-reload.test.tsx   the two D-8 defects (0046)
//   write queue  use-widget-state.tsx      ×  use-widget-state.test.tsx   ADR 0016's drop-on-unmount (0047)
//   reply        widget-renderer.tsx       ×  interaction-contract.test   an unvalidated `result` (0048)
//
// Rules:
//
//   survived-mutant  the test PASSED with a known-wrong implementation in place, so it no longer
//                    guards the behaviour its record describes.
//   missing-anchor   a mutant's search text is not in the source. The module was rewritten and the
//                    mutant no longer applies; a gate that silently skips it passes everything.
//   baseline-red     the test fails against the real implementation, so a "killed" mutant would
//                    prove nothing.
//
// A source file is mutated in place and restored in a `finally` (and on SIGINT/SIGTERM), because
// Vitest resolves the module graph from the workspace and a copy elsewhere would not be what runs.
// Runs are sequential for the same reason.
//
// Usage:
//   node scripts/check-mutants.mjs
//   node scripts/check-mutants.mjs --self-test   plant a violator per rule, assert each fires

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
/** Each suite: a source, the test that must kill its mutants, and the mutants themselves. */
export const SUITES = [
  {
    name: 'lifecycle',
    adr: 'ADR 0046',
    source: 'packages/core/src/lifecycle/use-widget-lifecycle.tsx',
    test: 'packages/core/src/lifecycle/lifecycle-reload.test.tsx',
    // The implementation D-8 described, split into its two defects.
    mutants: [
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
    ],
  },
  {
    name: 'write queue',
    adr: 'ADR 0047',
    source: 'packages/core/src/state/use-widget-state.tsx',
    test: 'packages/core/src/state/use-widget-state.test.tsx',
    // ADR 0016's component-owned write, which the queue replaced.
    mutants: [
      {
        name: 'unmount does not flush',
        edits: [['      queue.flush(conversationId, messageId);\n', '      void conversationId;\n']],
      },
      {
        name: 'remount ignores the queued value',
        edits: [
          [
            '  const hydrate = (): S => (queue.unsettled(conversationId, messageId) as S | undefined) ?? initial;\n',
            '  const hydrate = (): S => initial;\n',
          ],
        ],
      },
    ],
  },
  {
    name: 'reply channel',
    adr: 'ADR 0048',
    source: 'packages/core/src/render/widget-renderer.tsx',
    test: 'packages/core/src/render/interaction-contract.test.tsx',
    mutants: [
      {
        name: 'forwards an unvalidated result',
        edits: [
          [
            "      const result = status === 'streaming' ? NO_RESULT : checkResult(resultSchema, data, coords);\n",
            '      const result: ResultCheck = { ok: true, value: data.result };\n',
          ],
        ],
      },
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

function runVitest(test) {
  const result = spawnSync('npx', ['vitest', 'run', '--project', 'unit', test], {
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
  const stale = SUITES.flatMap((suite) => {
    const real = readFileSync(resolve(repoRoot, suite.source), 'utf8');
    return suite.mutants.filter((m) => applyEdits(real, m.edits).missing !== undefined).map((m) => m.name);
  });
  outcomes.push([
    'allows the shipped mutants against the shipped source',
    stale.length === 0,
    stale.join(', '),
  ]);

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ');
    if (ok) {
      console.log(`  ✓ check-mutants/${rule} — ${positive ? 'rejected its violator' : 'stayed silent'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-mutants/${rule} — did NOT reject its violator (gate is broken) [${detail}]`
          : `  ✗ check-mutants/${rule} — failed on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

const originals = new Map(
  SUITES.map((suite) => [suite.source, readFileSync(resolve(repoRoot, suite.source), 'utf8')]),
);
const restoreAll = () => {
  for (const [source, text] of originals) writeFileSync(resolve(repoRoot, source), text, 'utf8');
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restoreAll();
    process.exit(130);
  });
}

const violations = [];
let killed = 0;
try {
  for (const suite of SUITES) {
    const path = resolve(repoRoot, suite.source);
    const found = analyse({
      read: () => readFileSync(path, 'utf8'),
      write: (text) => writeFileSync(path, text, 'utf8'),
      run: () => runVitest(suite.test),
      mutants: suite.mutants,
    });
    violations.push(...found.map((v) => ({ ...v, suite })));
    if (found.length === 0) killed += suite.mutants.length;
  }
} finally {
  restoreAll();
}

if (violations.length) {
  console.error(`✗ mutants: ${violations.length} problem(s)\n`);
  for (const v of violations) {
    const why = {
      'survived-mutant': `${v.suite.test} passed with this defect planted in ${v.suite.source}; it no longer guards it`,
      'missing-anchor': `its search text is gone from ${v.suite.source} [${v.detail}]; update the mutant to the new source`,
      'baseline-red': `${v.suite.test} fails against the real implementation, so no mutant result means anything`,
    }[v.rule];
    console.error(`  [${v.rule}] ${v.suite.name}: ${v.mutant} — ${why} (${v.suite.adr}).`);
  }
  process.exit(1);
}

const total = SUITES.reduce((n, suite) => n + suite.mutants.length, 0);
console.log(
  `✓ mutants: ${killed}/${total} planted defect(s) across ${SUITES.length} suite(s) killed by their tests`,
);
