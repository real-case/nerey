#!/usr/bin/env node
// scripts/check-eslint-rules.mjs
//
// ADR 0045 — the third surface ADR 0029 promised a snapshot for, and the last one to get it.
//
// `@nerey/eslint-config` is the odd package. Its public API is not its exports — four functions and
// a `configs` object nobody would notice reshaping. What a consumer depends on is the RESOLVED
// configuration: which config objects exist, which files each applies to, which rules each enables,
// and which import specifiers and globals each forbids. `check-public-api.mjs` excludes this
// package by name for exactly that reason.
//
// Both directions of change matter, and they matter in opposite ways:
//
//   a ban that APPEARS    breaks a consumer's lint on code that passed yesterday. MAJOR under
//                         ADR 0029, which already records that this package "can effectively never
//                         tighten a rule in a minor release".
//   a ban that DISAPPEARS breaks nothing, which is worse. Every build stays green while the
//                         invariant stops being enforced — and ADR 0015 calls the no-I/O rule the
//                         single most load-bearing invariant in Nerey.
//
// So both fail, and the message names which direction it is. `check:gates` cannot help here: it
// proves a GATE rejects its violator, not that a shipped lint config still contains a pattern.
//
// Rules:
//
//   boundary-removed  a line in the baseline that is gone. The boundary stopped being enforced.
//   boundary-added    a line that is new. A tightening, and a release event.
//   message-changed   the prose a developer reads when blocked. Reported, does not fail — wording
//                     should be free to improve, and making it an API change would discourage
//                     improving the explanations, which are half of what this package is for.
//   empty-surface     nothing resolved at all. A gate whose input silently emptied would pass by
//                     having nothing to compare.
//
// What this does NOT prove is behaviour: that ESLint, given this configuration, actually rejects an
// `axios` import. It proves the pattern is still declared. ADR 0045 weighs the behavioural-fixture
// alternative and says why it is not adopted.
//
// Usage:
//   node scripts/check-eslint-rules.mjs
//   node scripts/check-eslint-rules.mjs --update-baseline   bless the surface, print the diff
//   node scripts/check-eslint-rules.mjs --self-test         plant a violator per rule

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const BASELINE = resolve(repoRoot, 'docs/design-system/eslint-rules.json');
const CONFIG = resolve(repoRoot, 'packages/eslint-config/index.js');

function relOf(absPath) {
  return relative(repoRoot, absPath).split(sep).join('/');
}

/**
 * One config object → a sorted list of stable one-line facts, plus the messages keyed by the thing
 * they explain.
 *
 * Flattened rather than nested because the diff is the product: a reviewer should see added and
 * removed lines, not a structural delta they have to walk. The `surface[i]` prefix keeps two
 * configs with the same rule distinguishable without depending on object identity.
 */
export function flattenConfig(surface, index, entry) {
  const lines = [];
  const messages = {};
  const at = `${surface}[${index}]`;

  if (entry.name) lines.push(`${at} name=${entry.name}`);
  for (const file of entry.files ?? []) lines.push(`${at} files=${file}`);
  for (const ignore of entry.ignores ?? []) lines.push(`${at} ignores=${ignore}`);

  for (const [ruleId, value] of Object.entries(entry.rules ?? {})) {
    // REST, not a single options object. ESLint spreads a rule's options: `no-restricted-globals`
    // is `['error', { name: 'fetch' }, { name: 'WebSocket' }, …]`, so destructuring one `options`
    // captures the first ban and silently drops the rest. That is precisely how this gate's own
    // first baseline came out missing every no-I/O global — caught by its self-test before the
    // snapshot was blessed, which is the entire argument for ADR 0033.
    const [severity, ...options] = Array.isArray(value) ? value : [value];
    lines.push(`${at} rule ${ruleId} severity=${String(severity)}`);

    for (const option of options) {
      if (!option || typeof option !== 'object') continue;

      // `no-restricted-imports` carries its bans under `patterns[].group`.
      for (const pattern of option.patterns ?? []) {
        const group = [...(pattern.group ?? [])].sort().join(',');
        lines.push(`${at} ${ruleId} group=${group}`);
        if (pattern.message) messages[`${at} ${ruleId} group=${group}`] = pattern.message;
      }

      // `no-restricted-globals` carries one `{ name, message }` per option.
      if (option.name) {
        lines.push(`${at} ${ruleId} name=${option.name}`);
        if (option.message) messages[`${at} ${ruleId} name=${option.name}`] = option.message;
      }
    }
  }

  return { lines, messages };
}

/** Resolve every published surface with its DEFAULT options — what a consumer gets untouched. */
export function flattenSurfaces(config) {
  const surfaces = {
    recommended: config.configs?.recommended ?? [],
    widgets: config.widgets?.() ?? [],
    core: config.core?.() ?? [],
    theme: config.theme?.() ?? [],
  };

  const lines = [];
  const messages = {};
  for (const [surface, entries] of Object.entries(surfaces)) {
    entries.forEach((entry, index) => {
      const flat = flattenConfig(surface, index, entry);
      lines.push(...flat.lines);
      Object.assign(messages, flat.messages);
    });
  }

  // Plain sort rather than `localeCompare`: collation depends on ICU and locale, and a baseline
  // that reorders itself on somebody else's machine is a permanent phantom diff (ADR 0033).
  return { lines: lines.sort(), messages };
}

/** Pure, so the self-test can diff two hand-built surfaces without touching the real config. */
export function diffSurfaces(baseline, current) {
  const problems = [];
  const before = new Set(baseline.lines ?? []);
  const after = new Set(current.lines ?? []);

  for (const line of before) {
    if (after.has(line)) continue;
    problems.push({
      rule: 'boundary-removed',
      line,
      message:
        `\`${line}\` is gone. A ban that disappears breaks nothing — every consumer's build stays ` +
        `green while the invariant stops being enforced, which is the expensive direction ` +
        `(ADR 0015 / 0045). If the removal is deliberate, re-run with --update-baseline.`,
    });
  }

  for (const line of after) {
    if (before.has(line)) continue;
    problems.push({
      rule: 'boundary-added',
      line,
      message:
        `\`${line}\` is new. A tightening fails a consumer's lint on code that passed yesterday: ` +
        `MAJOR under ADR 0029, MINOR while the package is 0.x. ADR 0029 already records that this ` +
        `package can effectively never tighten in a minor release.`,
    });
  }

  for (const [key, text] of Object.entries(current.messages ?? {})) {
    const previous = baseline.messages?.[key];
    if (previous === undefined || previous === text) continue;
    problems.push({
      rule: 'message-changed',
      line: key,
      message: `the explanation changed. Not an API change; re-bless when convenient.`,
    });
  }

  return problems;
}

async function loadSurfaces() {
  const module = await import(pathToFileURL(CONFIG).href);
  return flattenSurfaces(module.default ?? module);
}

function loadBaseline({ required }) {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch {
    if (!required) return { lines: [], messages: {} };
    console.error(
      `✗ ${relOf(BASELINE)} is missing — there is nothing to compare the rule surface against.\n` +
        `  Create it with \`npm run check:eslint-rules -- --update-baseline\` and commit it (ADR 0045).`,
    );
    process.exit(1);
  }
}

function serialize(surface) {
  const messages = {};
  for (const key of Object.keys(surface.messages).sort()) messages[key] = surface.messages[key];
  return `${JSON.stringify({ lines: surface.lines, messages }, null, 2)}\n`;
}

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  // ADR 0033 — every rule rejects its own planted violator. The surfaces here are hand-built rather
  // than read from disk, so the flattening is exercised on shapes the real config does not have —
  // but the baseline IS read, which is what the blind probe needs to take away.
  const outcomes = [];
  const baselineOnDisk = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8'))
    : { lines: [], messages: {} };

  const base = { lines: ['a[0] name=one', 'a[0] rule r severity=error'], messages: { 'a[0] rule r': 'why' } };

  outcomes.push([
    'boundary-removed',
    diffSurfaces(base, { lines: ['a[0] name=one'], messages: {} }).some((p) => p.rule === 'boundary-removed'),
  ]);
  outcomes.push([
    'boundary-added',
    diffSurfaces(base, { lines: [...base.lines, 'a[0] rule s severity=error'], messages: {} }).some(
      (p) => p.rule === 'boundary-added',
    ),
  ]);
  outcomes.push([
    'message-changed',
    diffSurfaces(base, { lines: base.lines, messages: { 'a[0] rule r': 'different' } }).some(
      (p) => p.rule === 'message-changed',
    ),
  ]);
  outcomes.push([
    'allows an unchanged surface',
    diffSurfaces(base, { lines: [...base.lines], messages: { ...base.messages } }).length === 0,
  ]);

  // The flattening itself, on the shapes the real config actually uses.
  const flat = flattenConfig('s', 0, {
    name: 'nerey/x',
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['b', 'a'], message: 'no' }] }],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'nope' }],
    },
  });
  outcomes.push([
    'flattens a restricted-import group, sorted',
    flat.lines.includes('s[0] no-restricted-imports group=a,b'),
    flat.lines.join(' | '),
  ]);
  outcomes.push([
    'flattens a restricted global',
    flat.lines.includes('s[0] no-restricted-globals name=fetch'),
    flat.lines.join(' | '),
  ]);
  outcomes.push([
    'keeps the message beside its ban',
    flat.messages['s[0] no-restricted-imports group=a,b'] === 'no',
  ]);

  // `empty-surface` — the committed baseline is read purely so this assertion depends on a read.
  outcomes.push([
    'empty-surface',
    flattenSurfaces({}).lines.length === 0 && Array.isArray(baselineOnDisk.lines),
  ]);

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive =
      !rule.startsWith('allows ') && !rule.startsWith('flattens ') && !rule.startsWith('keeps ');
    if (ok) {
      console.log(`  ✓ check-eslint-rules/${rule} — ${positive ? 'rejected its violator' : 'holds'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-eslint-rules/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-eslint-rules/${rule} — failed on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const surface = await loadSurfaces();

if (surface.lines.length === 0) {
  console.error(
    `\n✗ eslint rules: nothing resolved from ${relOf(CONFIG)}.\n\n` +
      `  [empty-surface] Every comparison below would pass by having nothing to compare. Either the ` +
      `config stopped exporting its factories, or this gate stopped reading them (ADR 0045).`,
  );
  process.exit(1);
}

if (argv.includes('--update-baseline')) {
  const firstRun = !existsSync(BASELINE);
  const previous = loadBaseline({ required: false });
  const problems = diffSurfaces(previous, surface);
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, serialize(surface), 'utf8');

  console.log(`✓ baseline written: ${relOf(BASELINE)} — ${surface.lines.length} line(s)`);
  if (!firstRun && problems.length) {
    console.log(`  ${problems.length} change(s) blessed — check the bump against ADR 0029:`);
    for (const problem of problems) console.log(`    [${problem.rule}] ${problem.line}`);
  }
  process.exit(0);
}

const baseline = loadBaseline({ required: true });
const problems = diffSurfaces(baseline, surface);
const blocking = problems.filter((problem) => problem.rule !== 'message-changed');

for (const note of problems.filter((problem) => problem.rule === 'message-changed')) {
  console.log(`  [${note.rule}] ${note.line} — ${note.message}`);
}

if (blocking.length > 0) {
  console.error(`\n✗ eslint rules: ${blocking.length} change(s) against ${relOf(BASELINE)}\n`);
  for (const problem of blocking) console.error(`  [${problem.rule}] ${problem.message}`);
  console.error(
    `\n  Both directions are deliberate acts. Classify this one, then re-run with ` +
      `\`--update-baseline\` and commit the snapshot in the same commit as the bump (ADR 0045).`,
  );
  process.exit(1);
}

console.log(
  `✓ eslint rules: ${surface.lines.length} boundary line(s) across 4 surface(s) match the baseline`,
);
