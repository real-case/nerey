#!/usr/bin/env node
// scripts/check-workflow-gates.mjs
//
// A check that can be silently skipped is not a gate.
//
// ADR 0033 makes every gate in this repository prove it rejects its own violator. That covers the
// gate being WRONG. It says nothing about the gate never having RUN — and on a pull request those
// two states look almost identical: one line in a checks list reading `cancelled` instead of
// `pass`, on a pull request that is otherwise green and mergeable.
//
// GitHub's concurrency rule is the mechanism. When a run is queued and another in the same group is
// already in progress, the queued one waits — and "any previously pending run in the group is
// cancelled". A `concurrency.group` that is a constant string puts every pull request AND every
// push to the default branch into one queue, so three arrivals in a burst is all it takes to cancel
// the middle one outright. `cancel-in-progress: false` does not prevent this; it governs the
// RUNNING run, not the pending one.
//
// This was found by merging: on 2026-08-30 two Dependabot pull requests were merged whose static
// build gate (ADR 0044) had been cancelled rather than run, because `pages.yml` used `group: pages`
// while `ci.yml` and `release.yml` were already scoped to `github.ref`.
//
// Rules:
//
//   shared-concurrency-group  a workflow that runs on `pull_request` declares a `concurrency.group`
//                             containing no `${{ … }}` expression, so it cannot be per-ref. Every
//                             pull request contends with every other one and with the default
//                             branch, and the loser is cancelled rather than failed.
//   no-pull-request-workflow  nothing was found that runs on `pull_request`. A gate that has
//                             stopped looking reports a clean result forever, which is the failure
//                             this whole file is about.
//
// Usage:
//   node scripts/check-workflow-gates.mjs
//   node scripts/check-workflow-gates.mjs --self-test

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const WORKFLOW_DIR = resolve(repoRoot, '.github/workflows');

/** The `concurrency:` block at column 0 — workflow level, not a job's. */
const CONCURRENCY_RE = /^concurrency:\s*$\n((?:^[ \t]+.*$\n?)*)/m;
const GROUP_RE = /^[ \t]+group:\s*(.+?)\s*$/m;
const EXPRESSION_RE = /\$\{\{/;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Does this workflow run on `pull_request`? Deliberately textual rather than a YAML parse: the
 * repository has no YAML dependency, and the shapes in use here are `pull_request:` on its own
 * line under `on:`, with or without a filter block.
 */
export function runsOnPullRequest(source) {
  return /^\s{2}pull_request(_target)?:\s*$/m.test(source) || /^on:.*\bpull_request\b/m.test(source);
}

/** Pure: the workflow-level concurrency group, or null when none is declared. */
export function concurrencyGroup(source) {
  const block = CONCURRENCY_RE.exec(source);
  if (!block) return null;
  const group = GROUP_RE.exec(block[1] ?? '');
  if (!group) return null;
  return { value: group[1] ?? '', line: lineOf(source, block.index) + 1 };
}

/** Pure: the whole verdict for one workflow. */
export function checkWorkflow(source, rel) {
  if (!runsOnPullRequest(source)) return [];

  const group = concurrencyGroup(source);
  // No concurrency block at all is fine: nothing queues, so nothing is cancelled.
  if (!group) return [];
  if (EXPRESSION_RE.test(group.value)) return [];

  return [
    {
      rel,
      line: group.line,
      rule: 'shared-concurrency-group',
      message:
        `runs on \`pull_request\` and declares \`concurrency.group: ${group.value}\`, a constant. ` +
        `Every pull request and every push then share one queue, and GitHub cancels a run that is ` +
        `merely PENDING when another arrives — so under a burst this workflow's checks do not run ` +
        `at all. \`cancel-in-progress: false\` does not help: it governs the running run, not the ` +
        `pending one. A cancelled check is not a failed one, so nothing turns red and the pull ` +
        `request merges having skipped this gate. Scope the group with \`\${{ github.ref }}\`.`,
    },
  ];
}

function run() {
  const names = existsSync(WORKFLOW_DIR)
    ? readdirSync(WORKFLOW_DIR)
        .filter((name) => /\.ya?ml$/.test(name))
        .sort()
    : [];

  const problems = [];
  let onPullRequest = 0;

  for (const name of names) {
    const rel = `.github/workflows/${name}`;
    const source = readFileSync(join(WORKFLOW_DIR, name), 'utf8');
    if (runsOnPullRequest(source)) onPullRequest += 1;
    problems.push(...checkWorkflow(source, rel));
  }

  if (onPullRequest === 0) {
    problems.push({
      rel: '.github/workflows',
      line: 0,
      rule: 'no-pull-request-workflow',
      message:
        'nothing here runs on `pull_request`. Either the trigger moved and every gate in this ' +
        'repository now runs only after a merge, or this check has stopped recognising the shape ' +
        'it looks for — and a gate that has stopped looking reports a clean result forever.',
    });
  }

  return { problems, count: names.length, onPullRequest };
}

if (process.argv.includes('--self-test')) {
  // ADR 0033 — each rule rejects a planted violator, and the legal forms are asserted to stay
  // silent. Fixtures go through disk so the blind probe has a read to take away.
  const dir = mkdtempSync(join(tmpdir(), 'nerey-workflow-gates-'));
  const fixture = join(dir, 'workflow.yml');
  const outcomes = [];

  const ON_PR = 'on:\n  push:\n    branches: [main]\n  pull_request:\n\n';

  const CASES = [
    ['shared-concurrency-group', `${ON_PR}concurrency:\n  group: pages\n  cancel-in-progress: false\n`],
    // The exact shape that lost the gate: false does NOT rescue a constant group.
    [
      'shared-concurrency-group (cancel-in-progress does not rescue it)',
      `${ON_PR}concurrency:\n  group: build\n  cancel-in-progress: true\n`,
    ],
  ];

  const ALLOWED = [
    [
      'a ref-scoped group',
      `${ON_PR}concurrency:\n  group: pages-\${{ github.ref }}\n  cancel-in-progress: false\n`,
    ],
    [
      'a group scoped by workflow and ref',
      `${ON_PR}concurrency:\n  group: ci-\${{ github.workflow }}-\${{ github.ref }}\n  cancel-in-progress: true\n`,
    ],
    ['no concurrency block at all', `${ON_PR}jobs:\n  build:\n    runs-on: ubuntu-latest\n`],
    // A constant group is fine when no pull request can ever queue behind another: release.yml runs
    // on a tag and is the reason this exemption is not a loophole worth closing.
    [
      'a constant group on a workflow that does not run on pull_request',
      'on:\n  push:\n    tags: ["v*"]\n\nconcurrency:\n  group: release\n  cancel-in-progress: false\n',
    ],
  ];

  try {
    for (const [rule, source] of CASES) {
      writeFileSync(fixture, source, 'utf8');
      const found = checkWorkflow(readFileSync(fixture, 'utf8'), 'fixture.yml');
      outcomes.push([rule, found.some((problem) => rule.startsWith(problem.rule))]);
    }

    for (const [name, source] of ALLOWED) {
      writeFileSync(fixture, source, 'utf8');
      const found = checkWorkflow(readFileSync(fixture, 'utf8'), 'fixture.yml');
      outcomes.push([`allows ${name}`, found.length === 0, found.map((p) => p.rule).join(', ')]);
    }

    writeFileSync(fixture, 'on:\n  push:\n    branches: [main]\n', 'utf8');
    outcomes.push([
      'reads the pull_request trigger',
      runsOnPullRequest(readFileSync(fixture, 'utf8')) === false,
    ]);

    writeFileSync(fixture, `${ON_PR}concurrency:\n  group: pages\n`, 'utf8');
    outcomes.push([
      'reads the group out of the block',
      concurrencyGroup(readFileSync(fixture, 'utf8'))?.value === 'pages',
    ]);
  } finally {
    // Torn down BEFORE any exit: `process.exit()` skips `finally` (ADR 0033).
    rmSync(dir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ') && !rule.startsWith('reads ');
    if (ok) {
      console.log(`  ✓ check-workflow-gates/${rule} — ${positive ? 'rejected its violator' : 'holds'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-workflow-gates/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-workflow-gates/${rule} — failed on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const { problems, count, onPullRequest } = run();

if (problems.length > 0) {
  console.error(`\n✗ workflow gates: ${problems.length} problem(s)\n`);
  for (const problem of problems) {
    console.error(`  ${problem.rel}:${problem.line}  [${problem.rule}] ${problem.message}`);
  }
  process.exit(1);
}

console.log(
  `✓ workflow gates: ${count} workflow(s), ${onPullRequest} running on pull requests, none able to ` +
    `cancel another's checks`,
);
