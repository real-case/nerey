#!/usr/bin/env node
// scripts/check-ci-pins.mjs
//
// ADR 0043 — everything CI runs is identified by content, and the pins agree with the manifest.
//
// A `uses:` naming a tag is a pointer the action's owner can move between the review and the run.
// That matters most in `release.yml`, which holds `id-token: write` and can therefore mint an npm
// publishing token through trusted publishing (ADR 0039): an action that runs in that job runs with
// that capability.
//
// The image rule exists for a duller reason and is the one most likely to fire. ADR 0042 pins the
// visual reference rasteriser to a Playwright container and states that the image tag and the
// `playwright` devDependency "must move together". Dependabot will NOT keep that true — it does not
// update `container:` references in workflow files — so it will raise `playwright` and leave the
// image behind, and the reference-regeneration path then fails with a Playwright client refusing to
// drive the browsers baked into an older image. This turns that prose into a build failure, on the
// pull request that would have caused it.
//
// Rules:
//
//   unpinned-action     a `uses:` naming a tag or branch instead of a 40-character commit SHA.
//   undocumented-pin    a SHA with no `# vX.Y.Z` comment. A pin nobody can read is a pin nobody
//                       reviews, and Dependabot uses the comment to know what it is upgrading from.
//   action-inconsistent one action pinned to two different digests across the workflow set — or to
//                       one digest under two different version comments. Every such line is legal
//                       on its own, which is the whole point: this is the shape a rebased
//                       Dependabot bump leaves behind when `main` grew a job under it.
//   image-drift         the Playwright image tag disagrees with `devDependencies.playwright`.
//   image-inconsistent  the two places that name the image disagree with each other.
//
// Local actions (`./.github/actions/…`) are exempt: they are this repository's own code, already
// pinned by being in the commit. There are none today; the exemption is here so adding one does not
// require editing this file.
//
// Usage:
//   node scripts/check-ci-pins.mjs
//   node scripts/check-ci-pins.mjs --self-test   plant a violator per rule, assert each fires

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const WORKFLOW_DIR = resolve(repoRoot, '.github/workflows');
const PACKAGE_JSON = resolve(repoRoot, 'package.json');

/** `uses: owner/repo@ref` with whatever trailing comment the line carries. */
const USES_RE = /^\s*(?:-\s*)?uses:\s*(\S+)(?:\s*#\s*(.*))?$/gm;
const SHA_RE = /^[0-9a-f]{40}$/;
const VERSION_COMMENT_RE = /\bv\d+\.\d+\.\d+\b/;
const IMAGE_RE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-[a-z]+/g;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** Every `uses:` in one workflow, judged. Pure over the text, so the self-test can feed it one. */
export function checkWorkflow(source, rel) {
  const problems = [];

  for (const match of source.matchAll(USES_RE)) {
    const [full, spec, comment] = match;
    const line = lineOf(source, match.index ?? 0);

    // Own code, pinned by being in the commit.
    if (spec.startsWith('./')) continue;

    const at = spec.lastIndexOf('@');
    const ref = at === -1 ? '' : spec.slice(at + 1);

    if (!SHA_RE.test(ref)) {
      problems.push({
        rel,
        line,
        rule: 'unpinned-action',
        message:
          `\`${spec}\` is pinned to \`${ref || 'nothing'}\`, which its author can repoint at any ` +
          `time — including between the review of this file and the next run. Pin the 40-character ` +
          `commit SHA and put the version in a trailing comment (ADR 0043).`,
      });
      continue;
    }

    if (!comment || !VERSION_COMMENT_RE.test(comment)) {
      problems.push({
        rel,
        line,
        rule: 'undocumented-pin',
        message:
          `\`${spec}\` is pinned by SHA with no version comment, so nobody reviewing this line can ` +
          `tell what they are approving — and Dependabot reads that comment to know which version ` +
          `it is upgrading from. Append \` # vX.Y.Z\`.`,
      });
    }

    void full;
  }

  return problems;
}

/**
 * ADR 0043 — the pins must agree with EACH OTHER, not merely be well-formed one line at a time.
 *
 * Every rule above judges a single `uses:` in isolation, so a workflow set can be entirely legal
 * and still run two different versions of the same action. That is not hypothetical: it is what a
 * Dependabot pull request turns into the moment it is rebased onto a `main` that grew a job. The
 * bump was computed against the usages that existed when the branch was cut, the usages added since
 * keep the old digest, and every one of them is a documented digest pin — so nothing fires, and CI
 * quietly runs `actions/checkout` v4 in one job and v7 in the next.
 *
 * This is the action-level twin of `image-inconsistent`, and it exists for the same reason: when
 * one name resolves to two things, at most one of them is the thing anybody reviewed.
 *
 * Two digests for one action is the common shape. One digest under two version comments is the
 * rarer and nastier one — it means a comment is lying about what the SHA is, and the comment is
 * what reviewers read and what Dependabot upgrades from.
 *
 * @param sources `{ rel: text }` for the workflow files only.
 */
export function checkActionVersions(sources) {
  const problems = [];
  /** @type {Map<string, Array<{ rel: string, line: number, ref: string, version: string }>>} */
  const uses = new Map();

  for (const [rel, text] of Object.entries(sources)) {
    for (const match of text.matchAll(USES_RE)) {
      const [, spec, comment] = match;
      if (spec.startsWith('./')) continue;

      const at = spec.lastIndexOf('@');
      if (at === -1) continue;
      const ref = spec.slice(at + 1);
      // An unpinned or undocumented `uses:` is already reported by `checkWorkflow`; reporting it a
      // second time here would just be noise on top of the finding that matters.
      if (!SHA_RE.test(ref)) continue;

      const name = spec.slice(0, at);
      const version = VERSION_COMMENT_RE.exec(comment ?? '')?.[0] ?? '(undocumented)';
      if (!uses.has(name)) uses.set(name, []);
      uses.get(name)?.push({ rel, line: lineOf(text, match.index ?? 0), ref, version });
    }
  }

  // Sorted: a gate whose report depends on Map insertion order is not a merge gate (ADR 0033).
  for (const name of [...uses.keys()].sort()) {
    const sites = uses.get(name) ?? [];
    const refs = new Set(sites.map((site) => site.ref));
    const versions = new Set(sites.map((site) => site.version));
    if (refs.size === 1 && versions.size === 1) continue;

    const where = sites
      .map((site) => `${site.version} (${site.ref.slice(0, 7)}) at ${site.rel}:${site.line}`)
      .join(', ');

    problems.push({
      rel: sites[0]?.rel ?? '',
      line: sites[0]?.line ?? 0,
      rule: 'action-inconsistent',
      message:
        `\`${name}\` is pinned ${refs.size > 1 ? `to ${String(refs.size)} different digests` : 'to one digest under conflicting version comments'} ` +
        `across this workflow set — ${where}. Each of those lines passes on its own, which is ` +
        `exactly why this is checked across files: an update that covered the usages present when ` +
        `it was raised leaves the ones added since on the old pin, and nothing else here notices ` +
        `(ADR 0043).`,
    });
  }

  return problems;
}

/**
 * The ADR 0042 coupling, made mechanical: every mention of the Playwright image must name the same
 * tag, and that tag must be the `playwright` version the lockfile will install.
 *
 * @param sources `{ rel: text }` for every file allowed to name the image.
 */
export function checkImagePins(sources, declaredVersion) {
  const problems = [];
  const found = [];

  for (const [rel, text] of Object.entries(sources)) {
    for (const match of text.matchAll(IMAGE_RE)) {
      found.push({ rel, line: lineOf(text, match.index ?? 0), version: match[1] });
    }
  }

  if (found.length === 0) return problems;

  for (const hit of found) {
    if (hit.version === declaredVersion) continue;
    problems.push({
      rel: hit.rel,
      line: hit.line,
      rule: 'image-drift',
      message:
        `names the Playwright image at v${hit.version}, but \`devDependencies.playwright\` is ` +
        `${declaredVersion}. A mismatched image is a different Chromium, which is a different ` +
        `rasteriser — the visual references stop being reproducible and \`test:visual:update\` ` +
        `fails outright (ADR 0042 / 0043).`,
    });
  }

  const versions = new Set(found.map((hit) => hit.version));
  if (versions.size > 1) {
    problems.push({
      rel: found[0].rel,
      line: found[0].line,
      rule: 'image-inconsistent',
      message:
        `the Playwright image is named at ${[...versions].map((v) => `v${v}`).join(' and ')} in ` +
        `different files. Whichever one CI uses, the other is a lie about what produced the ` +
        `reference images.`,
    });
  }

  return problems;
}

/** `^1.62.1` → `1.62.1`. A range would make the comparison meaningless, so only the base is used. */
export function declaredPlaywrightVersion(manifestText) {
  const manifest = JSON.parse(manifestText);
  const raw = manifest.devDependencies?.playwright ?? '';
  const match = /(\d+\.\d+\.\d+)/.exec(raw);
  return match ? match[1] : null;
}

function run() {
  const problems = [];
  // Sorted: a gate whose report depends on filesystem iteration order is not a merge gate
  // (ADR 0033).
  const workflows = existsSync(WORKFLOW_DIR)
    ? readdirSync(WORKFLOW_DIR)
        .filter((name) => /\.ya?ml$/.test(name))
        .sort()
    : [];

  const sources = {};
  for (const name of workflows) {
    const rel = `.github/workflows/${name}`;
    const text = readFileSync(join(WORKFLOW_DIR, name), 'utf8');
    sources[rel] = text;
    problems.push(...checkWorkflow(text, rel));
  }

  // Before package.json joins `sources`: this rule reads `uses:` lines, and a manifest has none.
  problems.push(...checkActionVersions(sources));

  const manifestText = readFileSync(PACKAGE_JSON, 'utf8');
  sources['package.json'] = manifestText;

  const declared = declaredPlaywrightVersion(manifestText);
  if (declared) problems.push(...checkImagePins(sources, declared));

  return { problems, workflowCount: workflows.length, declared };
}

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  // ADR 0033 — every rule rejects its own planted violator, and the legal forms are asserted to
  // stay silent. The fixtures go through disk so the blind probe in check-gates has a read to take
  // away: a self-test that never reads anything sails through it.
  const dir = mkdtempSync(join(tmpdir(), 'nerey-ci-pins-'));
  const fixture = join(dir, 'workflow.yml');
  const outcomes = [];

  const CASES = [
    ['unpinned-action', '      - uses: actions/checkout@v4\n'],
    ['unpinned-action (branch)', '      - uses: actions/checkout@main\n'],
    ['undocumented-pin', `      - uses: actions/checkout@${'a'.repeat(40)}\n`],
    ['undocumented-pin (bare comment)', `      - uses: actions/checkout@${'a'.repeat(40)} # latest\n`],
  ];

  const ALLOWED = [
    ['a documented digest pin', `      - uses: actions/checkout@${'a'.repeat(40)} # v4.4.0\n`],
    ['a local action', '      - uses: ./.github/actions/thing\n'],
    ['a step with no uses', '      - run: npm ci\n'],
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

    // The cross-file rule needs two files, so it gets two fixtures. Both are read from disk for
    // the same reason as everything above: the blind probe must have a read to take away.
    const other = join(dir, 'other.yml');
    const A = 'a'.repeat(40);
    const B = 'b'.repeat(40);

    writeFileSync(fixture, `      - uses: actions/checkout@${A} # v4.4.0\n`, 'utf8');
    writeFileSync(other, `      - uses: actions/checkout@${B} # v7.0.1\n`, 'utf8');
    outcomes.push([
      'action-inconsistent',
      checkActionVersions({
        'one.yml': readFileSync(fixture, 'utf8'),
        'two.yml': readFileSync(other, 'utf8'),
      }).some((problem) => problem.rule === 'action-inconsistent'),
    ]);

    // One digest, two stories about what it is. Rarer, and worse: the comment is what a reviewer
    // reads and what Dependabot upgrades from.
    writeFileSync(fixture, `      - uses: actions/checkout@${A} # v4.4.0\n`, 'utf8');
    writeFileSync(other, `      - uses: actions/checkout@${A} # v7.0.1\n`, 'utf8');
    outcomes.push([
      'action-inconsistent (one digest, two version comments)',
      checkActionVersions({
        'one.yml': readFileSync(fixture, 'utf8'),
        'two.yml': readFileSync(other, 'utf8'),
      }).some((problem) => problem.rule === 'action-inconsistent'),
    ]);

    writeFileSync(fixture, `      - uses: actions/checkout@${A} # v4.4.0\n`, 'utf8');
    writeFileSync(other, `      - uses: actions/checkout@${A} # v4.4.0\n`, 'utf8');
    outcomes.push([
      'allows one action at one pin in two files',
      checkActionVersions({
        'one.yml': readFileSync(fixture, 'utf8'),
        'two.yml': readFileSync(other, 'utf8'),
      }).length === 0,
    ]);

    // Different actions are unrelated: they are expected to sit at different versions, and a rule
    // that could not tell them apart would fire on every workflow ever written.
    writeFileSync(fixture, `      - uses: actions/checkout@${A} # v4.4.0\n`, 'utf8');
    writeFileSync(other, `      - uses: actions/cache@${B} # v6.1.0\n`, 'utf8');
    outcomes.push([
      'allows two different actions at different pins',
      checkActionVersions({
        'one.yml': readFileSync(fixture, 'utf8'),
        'two.yml': readFileSync(other, 'utf8'),
      }).length === 0,
    ]);

    // An unpinned `uses:` is `unpinned-action`'s to report. Repeating it here would bury the
    // finding that actually tells the reader what to do.
    writeFileSync(fixture, '      - uses: actions/checkout@v4\n', 'utf8');
    writeFileSync(other, `      - uses: actions/checkout@${A} # v4.4.0\n`, 'utf8');
    outcomes.push([
      'allows an unpinned use to be reported by its own rule',
      checkActionVersions({
        'one.yml': readFileSync(fixture, 'utf8'),
        'two.yml': readFileSync(other, 'utf8'),
      }).length === 0,
    ]);

    writeFileSync(fixture, 'container: mcr.microsoft.com/playwright:v1.0.0-noble\n', 'utf8');
    const drift = checkImagePins({ 'fixture.yml': readFileSync(fixture, 'utf8') }, '9.9.9');
    outcomes.push(['image-drift', drift.some((problem) => problem.rule === 'image-drift')]);

    writeFileSync(
      fixture,
      'container: mcr.microsoft.com/playwright:v1.0.0-noble\nrun: mcr.microsoft.com/playwright:v2.0.0-noble\n',
      'utf8',
    );
    const inconsistent = checkImagePins({ 'fixture.yml': readFileSync(fixture, 'utf8') }, '1.0.0');
    outcomes.push([
      'image-inconsistent',
      inconsistent.some((problem) => problem.rule === 'image-inconsistent'),
    ]);

    writeFileSync(fixture, 'container: mcr.microsoft.com/playwright:v1.0.0-noble\n', 'utf8');
    const agreeing = checkImagePins({ 'fixture.yml': readFileSync(fixture, 'utf8') }, '1.0.0');
    outcomes.push(['allows an image that matches', agreeing.length === 0]);

    writeFileSync(fixture, '{"devDependencies":{"playwright":"^1.62.1"}}', 'utf8');
    outcomes.push([
      'reads the declared version through a range',
      declaredPlaywrightVersion(readFileSync(fixture, 'utf8')) === '1.62.1',
    ]);
  } finally {
    // Torn down BEFORE any exit: `process.exit()` skips `finally` (ADR 0033).
    rmSync(dir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ') && !rule.startsWith('reads ');
    if (ok) {
      console.log(`  ✓ check-ci-pins/${rule} — ${positive ? 'rejected its violator' : 'holds'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-ci-pins/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-ci-pins/${rule} — failed on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const { problems, workflowCount, declared } = run();

if (problems.length > 0) {
  console.error(`\n✗ CI pins: ${problems.length} problem(s)\n`);
  for (const problem of problems) {
    console.error(`  ${problem.rel}:${problem.line}  [${problem.rule}] ${problem.message}`);
  }
  process.exit(1);
}

console.log(
  `✓ CI pins: ${workflowCount} workflow(s), every action pinned by digest, documented, and at ` +
    `one version across all of them; the Playwright image agrees with playwright@${declared ?? 'unknown'}`,
);
