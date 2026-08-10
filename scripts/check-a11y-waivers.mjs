#!/usr/bin/env node
// scripts/check-a11y-waivers.mjs
//
// ADR 0032 — accessibility opt-outs are allowed only as explicit, reviewed, per-story
// parameters with a stated reason. This gate is what makes "reviewed" mean something.
//
// The failure mode being closed is specific and common: axe reports something awkward, someone
// adds `parameters: { a11y: { test: 'off' } }` to get a green build, and eighteen months later
// nobody knows whether the underlying defect was fixed. An opt-out with no expiry is a
// permanent exemption wearing a temporary one's clothes.
//
// Rules:
//   waiver-without-reason   an `a11y` opt-out with no matching `nereyA11yWaivers` entry
//   incomplete-waiver       an entry missing `rule`, `reason` or `expires`
//   thin-reason             a reason under 40 characters — "base ui does this" explains nothing
//   expired-waiver          `expires` is in the past
//   far-future-waiver       `expires` more than three years out, which is not an expiry
//   rule-disabled           `a11y.test: 'off'` or `a11y.disable: true` — always a violation.
//                           Narrow the axe CONTEXT to the offending element instead; disabling
//                           the whole check for a story turns one unfixable element into a
//                           blind spot over everything else the story renders.
//
// `expires` is compared against a date passed in, not against the clock: a gate whose verdict
// changes overnight without a commit is a gate that fails in CI on a day nobody touched the
// repo. CI passes today's date explicitly; the self-test passes fixed dates.
//
// Usage:
//   node scripts/check-a11y-waivers.mjs [--today YYYY-MM-DD]
//   node scripts/check-a11y-waivers.mjs --self-test

import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const PACKAGES = resolve(repoRoot, 'packages');

const MIN_REASON_LENGTH = 40;
const MAX_WAIVER_YEARS = 3;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.stories.tsx')) out.push(full);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Waiver entries are read with a regex rather than by importing the module. A gate that needs a
 * TypeScript transpiler to answer a question is a gate that breaks the first time the toolchain
 * moves, and this one has to run inside an edit hook.
 */
function parseWaivers(source) {
  const waivers = [];
  const blockRe = /nereyA11yWaivers\s*:\s*\[([\s\S]*?)\n\s*\]/g;
  for (const block of source.matchAll(blockRe)) {
    const body = block[1] ?? '';
    for (const entry of body.matchAll(/\{([\s\S]*?)\}/g)) {
      const text = entry[1] ?? '';
      waivers.push({
        index: (block.index ?? 0) + (entry.index ?? 0),
        rule: /\brule\s*:\s*['"]([^'"]+)['"]/.exec(text)?.[1],
        // A reason is frequently a multi-line concatenation, so measure the whole value.
        reason: /\breason\s*:\s*([\s\S]*?)(?:,\s*\n\s*\w+\s*:|$)/
          .exec(text)?.[1]
          ?.replace(/['"+\s]+/g, ' ')
          .trim(),
        expires: /\bexpires\s*:\s*['"](\d{4}-\d{2}-\d{2})['"]/.exec(text)?.[1],
      });
    }
  }
  return waivers;
}

function checkFile(absPath, today) {
  const rel = relative(repoRoot, absPath).split(sep).join('/');
  const source = readFileSync(absPath, 'utf8');
  const problems = [];
  const add = (index, rule, message) => problems.push({ rel, line: lineOf(source, index), rule, message });

  for (const match of source.matchAll(/a11y\s*:\s*\{[^}]*?\btest\s*:\s*['"]off['"]/g)) {
    add(
      match.index ?? 0,
      'rule-disabled',
      "`a11y: { test: 'off' }` disables the whole axe run for this story. Narrow " +
        '`a11y.context.exclude` to the specific element instead, so every other element in the ' +
        'story is still audited (ADR 0032).',
    );
  }
  for (const match of source.matchAll(/a11y\s*:\s*\{[^}]*?\bdisable\s*:\s*true/g)) {
    add(
      match.index ?? 0,
      'rule-disabled',
      '`a11y: { disable: true }` turns the gate off for this story (ADR 0032).',
    );
  }

  const exclusions = [...source.matchAll(/a11y\s*:\s*\{[^}]*?\bexclude\s*:/g)];
  const waivers = parseWaivers(source);

  if (exclusions.length > 0 && waivers.length === 0) {
    add(
      exclusions[0]?.index ?? 0,
      'waiver-without-reason',
      'this story excludes elements from the axe context but declares no `nereyA11yWaivers` ' +
        'entry. An opt-out nobody wrote down is an opt-out nobody will revisit (ADR 0032). Add ' +
        '`nereyA11yWaivers: [{ rule, reason, expires }]` alongside the `a11y` parameter.',
    );
  }

  for (const waiver of waivers) {
    if (!waiver.rule || !waiver.reason || !waiver.expires) {
      const missing = ['rule', 'reason', 'expires'].filter((k) => !waiver[k]);
      add(waiver.index, 'incomplete-waiver', `waiver is missing ${missing.join(', ')}.`);
      continue;
    }
    if (waiver.reason.length < MIN_REASON_LENGTH) {
      add(
        waiver.index,
        'thin-reason',
        `the reason for waiving \`${waiver.rule}\` is ${waiver.reason.length} characters. Say what ` +
          `the constraint actually is and why the wrapper cannot discharge it — the reader in a ` +
          `year is the person deciding whether it still holds.`,
      );
    }
    if (waiver.expires < today) {
      add(
        waiver.index,
        'expired-waiver',
        `the waiver for \`${waiver.rule}\` expired on ${waiver.expires}. Re-check whether the ` +
          `constraint still applies: either fix it now, or extend the date deliberately with a ` +
          `note on what you re-verified.`,
      );
    } else {
      const limit = `${Number(today.slice(0, 4)) + MAX_WAIVER_YEARS}${today.slice(4)}`;
      if (waiver.expires > limit) {
        add(
          waiver.index,
          'far-future-waiver',
          `the waiver for \`${waiver.rule}\` expires ${waiver.expires}, more than ` +
            `${MAX_WAIVER_YEARS} years out. That is not an expiry, it is a permanent exemption.`,
        );
      }
    }
  }

  return problems;
}

function todayFromArgv(argv) {
  const flag = argv.indexOf('--today');
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  // CI passes --today. Falling back to the clock keeps a local run useful, and the value is
  // echoed in the summary so a surprising verdict is traceable.
  return new Date().toISOString().slice(0, 10);
}

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  const fixtureDir = resolve(PACKAGES, 'theme/src/__a11ycheck__');
  const fixture = join(fixtureDir, 'planted.stories.tsx');
  const TODAY = '2026-08-10';

  const waiver = (body) =>
    `export const S = { parameters: { a11y: { context: { exclude: ['.x'] } },\n  nereyA11yWaivers: [\n    {\n${body}\n    },\n  ],\n} };\n`;
  const GOOD_REASON = `      reason: 'Base UI renders its own focus-manager sentinels, which the wrapper cannot configure away.',`;

  const CASES = [
    ['rule-disabled', `export const S = { parameters: { a11y: { test: 'off' } } };\n`],
    ['rule-disabled', `export const S = { parameters: { a11y: { disable: true } } };\n`],
    [
      'waiver-without-reason',
      `export const S = { parameters: { a11y: { context: { exclude: ['.x'] } } } };\n`,
    ],
    ['incomplete-waiver', waiver(`      rule: 'aria-hidden-focus',\n${GOOD_REASON}`)],
    [
      'thin-reason',
      waiver(
        `      rule: 'aria-hidden-focus',\n      reason: 'base ui does this',\n      expires: '2027-01-01',`,
      ),
    ],
    [
      'expired-waiver',
      waiver(`      rule: 'aria-hidden-focus',\n${GOOD_REASON}\n      expires: '2020-01-01',`),
    ],
    [
      'far-future-waiver',
      waiver(`      rule: 'aria-hidden-focus',\n${GOOD_REASON}\n      expires: '2099-01-01',`),
    ],
  ];

  const ALLOWED = [
    [
      'a fully documented waiver',
      waiver(`      rule: 'aria-hidden-focus',\n${GOOD_REASON}\n      expires: '2027-08-01',`),
    ],
    ['a story with no a11y parameter at all', `export const S = { args: {} };\n`],
    [
      'a story that narrows context without excluding',
      `export const S = { parameters: { a11y: { context: { include: ['#root'] } } } };\n`,
    ],
  ];

  const outcomes = [];
  try {
    mkdirSync(fixtureDir, { recursive: true });
    for (const [rule, source] of CASES) {
      writeFileSync(fixture, source, 'utf8');
      outcomes.push([rule, checkFile(fixture, TODAY).some((p) => p.rule === rule)]);
    }
    for (const [name, source] of ALLOWED) {
      writeFileSync(fixture, source, 'utf8');
      const found = checkFile(fixture, TODAY);
      outcomes.push([`allows ${name}`, found.length === 0, found.map((p) => p.rule).join(', ')]);
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ');
    if (ok) {
      console.log(`  ✓ check-a11y-waivers/${rule} — ${positive ? 'rejected its violator' : 'stayed silent'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-a11y-waivers/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-a11y-waivers/${rule} — fired on a LEGAL story [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const today = todayFromArgv(argv);
const files = walk(PACKAGES);
const problems = files.flatMap((f) => checkFile(f, today));
const waiverCount = files.reduce((n, f) => n + parseWaivers(readFileSync(f, 'utf8')).length, 0);

if (problems.length) {
  console.error(`✗ a11y waivers: ${problems.length} violation(s) across ${files.length} story file(s)\n`);
  for (const p of problems) console.error(`  ${p.rel}:${p.line}  [${p.rule}] ${p.message}`);
  console.error('\n  Reference: docs/decisions/0032-accessibility-gate-axe-wcag22aa.md');
  process.exit(1);
}

console.log(
  `✓ a11y waivers: ${waiverCount} documented waiver(s) across ${files.length} story file(s), ` +
    `none expired as of ${today}`,
);
