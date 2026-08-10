#!/usr/bin/env node
// scripts/check-commits.mjs
//
// ADR 0036 — the Conventional Commits gate. The release bump for each package is computed from
// the commit range (ADR 0029), so a subject that does not parse is a version that has to be
// negotiated by hand, and a `BREAKING CHANGE:` that nothing can grep for is a MAJOR that ships
// as a PATCH.
//
// Rules:
//
//   missing-type      subject is not `type(scope)?!?: description`.
//   unknown-type      type outside feat|fix|perf|refactor|docs|test|build|ci|chore|revert|style.
//   unknown-scope     scope outside the vocabulary COMPUTED from the `workspaces` globs in the
//                     root package.json, plus storybook|docs|repo|deps|adr. Computing it is the
//                     point: a hand-listed scope enum is the part of this convention that rots
//                     first, because adding a package does not touch it.
//   subject-style     description empty, ending in a period, or starting with a capital.
//   breaking-marker   a `BREAKING CHANGE:` footer with no `!` in the header. The two must agree,
//                     or the release gate and a human reading `git log --oneline` disagree about
//                     whether the change is breaking.
//   dangling-adr-ref  a `Refs: ADR NNNN` footer citing a record that is not in docs/decisions/.
//
// There is deliberately no commitlint dependency. The grammar above is small, entirely explicit
// here, and needs the derived scope set anyway; a config that overrides `scope-enum` at run time
// is more moving parts than the twenty lines it would replace.
//
// Usage:
//   node scripts/check-commits.mjs                       origin/main..HEAD, or the last 20 commits
//   node scripts/check-commits.mjs --from v0.1.0 --to HEAD
//   node scripts/check-commits.mjs --message .git/COMMIT_EDITMSG    the commit-msg hook path
//   node scripts/check-commits.mjs --self-test           plant a violator per rule, assert each fires

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const DECISIONS = resolve(repoRoot, 'docs/decisions');

const TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert', 'style'];

/** Scopes that name something real but are not a workspace package. */
const FIXED_SCOPES = ['storybook', 'docs', 'repo', 'deps', 'adr'];

const DEFAULT_FROM = 'origin/main';
const DEFAULT_TO = 'HEAD';
const FALLBACK_COUNT = 20;

/**
 * `type(scope)!: description`, parsed leniently so each part can be judged by its own rule.
 *
 * The colon must be followed by a space or end the subject — `feat(core):x` is not Conventional
 * Commits and is better reported as `missing-type`, whose message prints the whole grammar, than
 * as a subtly wrong `subject-style`.
 */
const HEADER_RE = /^([A-Za-z][A-Za-z0-9-]*)(?:\(([^()]*)\))?(!)?:(?: (.*))?$/;

const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/;
const REFS_FOOTER_RE = /^\s*refs?:\s*(.+)$/i;
const ADR_REF_RE = /\bADR[ -]?(\d{1,4})\b/gi;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/**
 * Expand one `workspaces` glob to the package directories it names.
 *
 * `readdirSync` order is filesystem-dependent, so it is sorted before it can reach the output
 * (ADR 0033 — a gate whose result depends on iteration order is not a merge gate).
 */
function expandWorkspaceGlob(glob) {
  const normalized = String(glob).replace(/\/+$/, '');
  if (!normalized.includes('*')) {
    const abs = resolve(repoRoot, normalized);
    return existsSync(join(abs, 'package.json')) ? [abs] : [];
  }

  const slash = normalized.lastIndexOf('/');
  const parentRel = slash === -1 ? '.' : normalized.slice(0, slash);
  const pattern = slash === -1 ? normalized : normalized.slice(slash + 1);
  // Only the last segment may hold the wildcard. `packages/*` is the layout ADR 0002 fixed; a
  // deeper glob would need a matcher, and silently matching nothing is the failure this gate exists
  // to prevent, so it is reported rather than skipped.
  if (parentRel.includes('*'))
    fail(`workspaces glob \`${glob}\` is not supported — wildcard must be the last segment.`);

  const parentAbs = resolve(repoRoot, parentRel);
  if (!existsSync(parentAbs)) return [];
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);

  return readdirSync(parentAbs)
    .sort()
    .filter((entry) => re.test(entry))
    .map((entry) => join(parentAbs, entry))
    .filter((abs) => statSync(abs).isDirectory() && existsSync(join(abs, 'package.json')));
}

/** `@nerey/core` → `core`. The scope names the package, not the npm namespace. */
function packageScope(dirAbs) {
  try {
    const name = JSON.parse(readFileSync(join(dirAbs, 'package.json'), 'utf8')).name;
    if (typeof name === 'string' && name.length) return name.replace(/^@[^/]+\//, '');
  } catch {
    /* fall through to the directory name */
  }
  return basename(dirAbs);
}

function loadScopeVocabulary() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  } catch {
    fail('root package.json is unreadable, so the scope vocabulary cannot be computed (ADR 0036).');
  }

  const globs = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);
  const derived = [...globs].sort().flatMap(expandWorkspaceGlob).map(packageScope);

  // An empty derived set would make every scoped commit legal-looking or every one illegal,
  // depending on which way the check reads — either way the rule would have stopped enforcing
  // anything while still exiting 0. Refuse instead.
  if (!derived.length) {
    fail(
      'no workspace packages resolved from the `workspaces` globs in package.json, so the ' +
        '`unknown-scope` vocabulary would be empty (ADR 0036 / 0033).',
    );
  }

  return new Set([...derived, ...FIXED_SCOPES].sort());
}

function loadAdrNumbers() {
  let entries;
  try {
    entries = readdirSync(DECISIONS).sort();
  } catch {
    fail(`${relative(repoRoot, DECISIONS)} is missing, so \`Refs: ADR NNNN\` footers cannot be resolved.`);
  }
  const numbers = new Set(entries.map((e) => /^(\d{4})-.+\.md$/.exec(e)?.[1]).filter(Boolean));
  if (!numbers.size)
    fail(`${relative(repoRoot, DECISIONS)} holds no NNNN-*.md records — the citation rule would never fire.`);
  return numbers;
}

/**
 * @param {{ rel: string, message: string }} commit
 * @returns {{ rel: string, line: number, rule: string, message: string }[]}
 */
function checkCommit(commit, { scopes, adrNumbers }) {
  const lines = commit.message.replace(/\r\n?/g, '\n').split('\n');
  const subject = (lines[0] ?? '').trim();
  const problems = [];
  const add = (line, rule, message) => problems.push({ rel: commit.rel, line, rule, message });

  const header = HEADER_RE.exec(subject);
  if (!header) {
    add(
      1,
      'missing-type',
      `\`${subject}\` is not \`type(scope)?!?: description\`. Expected e.g. \`feat(core): add the ` +
        `widget registry\` — a lowercase type, an optional parenthesised scope, an optional \`!\` ` +
        `for a breaking change, then \`: \` and the description (ADR 0036).`,
    );
  } else {
    const [, type, scope, bang, description] = header;

    if (!TYPES.includes(type)) {
      add(
        1,
        'unknown-type',
        `\`${type}\` is not a known type. Use one of ${TYPES.join(', ')} — all lowercase. The type ` +
          `is what ADR 0029 reads to compute the version bump, so an invented one bumps nothing.`,
      );
    }

    if (scope !== undefined) {
      const parts = scope
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) {
        add(1, 'unknown-scope', 'empty scope `()` — omit the parentheses when the change has no scope.');
      }
      for (const part of parts) {
        if (!scopes.has(part)) {
          add(
            1,
            'unknown-scope',
            `\`${part}\` is not a known scope. Allowed: ${[...scopes].join(', ')} — the package ` +
              `scopes are derived from the \`workspaces\` globs in package.json, so a new package ` +
              `becomes a legal scope on its own (ADR 0036).`,
          );
        }
      }
    }

    if (description === undefined || !description.trim()) {
      add(1, 'subject-style', 'the description is empty — say what the change does.');
    } else {
      if (description.endsWith('.')) {
        add(
          1,
          'subject-style',
          `\`${description}\` ends in a period — subjects are a summary line, not a sentence.`,
        );
      }
      if (/^[A-Z]/.test(description)) {
        add(
          1,
          'subject-style',
          `\`${description}\` starts with a capital — subjects are lowercase so generated changelog ` +
            `entries read consistently.`,
        );
      }
    }

    for (let i = 1; i < lines.length; i++) {
      if (BREAKING_FOOTER_RE.test(lines[i] ?? '') && !bang) {
        add(
          i + 1,
          'breaking-marker',
          'a `BREAKING CHANGE:` footer with no `!` in the header. Write `' +
            `${type}${scope === undefined ? '' : `(${scope})`}!: …\` — the \`!\` is the token the ` +
            'release gate greps for, and the footer is the token a human reads (ADR 0036 / 0029).',
        );
      }
    }
  }

  // Footer citations are checked whatever the header looked like — a malformed subject is no
  // reason to stop resolving the record it claims to implement.
  for (let i = 1; i < lines.length; i++) {
    const refs = REFS_FOOTER_RE.exec(lines[i] ?? '');
    if (!refs) continue;
    for (const cite of refs[1].matchAll(ADR_REF_RE)) {
      const padded = cite[1].padStart(4, '0');
      if (!adrNumbers.has(padded)) {
        add(
          i + 1,
          'dangling-adr-ref',
          `cites \`ADR ${padded}\`, which is not in docs/decisions/. Either fix the number or write ` +
            `the record first — a citation nobody can follow is worse than none (ADR 0001 / 0036).`,
        );
      }
    }
  }

  return problems;
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function refExists(ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Read commits as `hash\x1f parents \x1f full message`, records separated by \x1e. */
function readCommits(args) {
  const raw = git(['log', '--format=%H%x1f%P%x1f%B%x1e', ...args]);
  return raw
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim().length)
    .map((record) => {
      const [hash = '', parents = '', message = ''] = record.split('\x1f');
      return { rel: hash.slice(0, 8), parents: parents.trim().split(/\s+/).filter(Boolean), message };
    });
}

function resolveRange(from, to, fromWasExplicit) {
  try {
    git(['rev-parse', '--git-dir']);
  } catch {
    return {
      commits: [],
      label: 'no repository',
      note: `${repoRoot} is not a git working tree — nothing to check.`,
    };
  }
  if (!refExists(to)) {
    return {
      commits: [],
      label: to,
      note: `\`${to}\` does not resolve — the repository has no commits yet.`,
    };
  }
  if (refExists(from)) {
    return { commits: readCommits([`${from}..${to}`]), label: `${from}..${to}`, note: null };
  }
  // A missing base is the normal state of a fresh clone with no remote, and refusing there would
  // make the gate unrunnable exactly when someone is setting the repository up. An explicitly
  // requested base that is missing is more likely a typo, so the note says which case this is.
  return {
    commits: readCommits(['-n', String(FALLBACK_COUNT), to]),
    label: `${to} (last ${FALLBACK_COUNT})`,
    note:
      `\`${from}\` does not exist, so the range fell back to the last ${FALLBACK_COUNT} commit(s) on ` +
      `\`${to}\`. ` +
      (fromWasExplicit
        ? 'You passed that base with --from, so check the spelling if you meant a real ref.'
        : 'That is the normal case in a fresh clone or before the first push.'),
  };
}

function run(argv) {
  // A flag given without a value silently falling back to the default is how a gate ends up
  // checking a different range than the caller asked for and still exiting 0.
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    if (i === -1) return fallback;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail(`${name} needs a value.`);
    return value;
  };

  const context = { scopes: loadScopeVocabulary(), adrNumbers: loadAdrNumbers() };
  const messageFile = flag('--message', null);

  if (messageFile) {
    const abs = resolve(repoRoot, messageFile);
    if (!existsSync(abs)) fail(`--message ${messageFile} does not exist.`);
    // Comment lines are what git strips before committing; judging them would reject every
    // message written in an editor.
    const message = readFileSync(abs, 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n');
    const rel = relative(repoRoot, abs).split(sep).join('/');
    return {
      label: rel,
      note: null,
      skipped: 0,
      count: 1,
      context,
      problems: checkCommit({ rel, message }, context),
    };
  }

  let range;
  try {
    range = resolveRange(flag('--from', DEFAULT_FROM), flag('--to', DEFAULT_TO), argv.includes('--from'));
  } catch {
    return {
      label: 'no repository',
      note: 'not a git working tree — nothing to check.',
      skipped: 0,
      count: 0,
      context,
      problems: [],
    };
  }

  // Merge commits carry a generated subject nobody wrote. ADR 0036 makes merges squash merges, so
  // one in the range is a local integration, not a contract breach.
  const subjects = range.commits.filter((c) => c.parents.length < 2);

  return {
    label: range.label,
    note: range.note,
    skipped: range.commits.length - subjects.length,
    count: subjects.length,
    context,
    problems: subjects.flatMap((commit) => checkCommit(commit, context)),
  };
}

if (process.argv.includes('--self-test')) {
  // ADR 0033 — every rule must reject its own violator, and must stay quiet on legal input.
  // Commit messages are strings, not files, so there is no fixture tree to plant and nothing to
  // tear down: the violators below are the whole fixture.
  const context = { scopes: loadScopeVocabulary(), adrNumbers: loadAdrNumbers() };

  const CASES = [
    ['missing-type', 'updated the button styles'],
    ['missing-type', 'feat(core):no space after the colon'],
    ['unknown-type', 'wip(core): add the registry'],
    ['unknown-type', 'Feat(core): add the registry'],
    ['unknown-scope', 'feat(frontend): add the registry'],
    ['unknown-scope', 'feat(): add the registry'],
    ['subject-style', 'feat(core): '],
    ['subject-style', 'feat(core): add the registry.'],
    ['subject-style', 'feat(core): Add the registry'],
    [
      'breaking-marker',
      'feat(theme): rename the surface token\n\nBREAKING CHANGE: --nerey-surface is now --nerey-surface-raised',
    ],
    // The number is assembled rather than written out: scripts/**/*.mjs is inside
    // check-adr-citations' own scan set, so spelling out a four-digit number after the tag
    // would be a real dangling citation in the repo, and that gate would fail on this fixture.
    ['dangling-adr-ref', `docs(adr): record the commit contract\n\nRefs: ADR ${'99'}99`],
  ];

  /**
   * The over-firing hazards are specific: a legal `!` header also carries the footer, `chore(deps)`
   * uses a fixed scope rather than a package one, `eslint-config` is a hyphenated derived scope,
   * and a description may legally contain a colon or an uppercase word that is not the first one.
   */
  const ALLOWED = [
    ['plain feat', 'feat(core): add the widget registry'],
    ['no scope', 'fix: guard against a missing host value'],
    ['hyphenated derived scope', 'chore(eslint-config): widen the peer range'],
    ['fixed scope', 'chore(deps): bump vite to 8.2.1'],
    [
      'breaking with marker',
      'feat(theme)!: rename the surface token\n\nBREAKING CHANGE: --nerey-surface is now --nerey-surface-raised',
    ],
    ['resolvable citation', 'docs(adr): record the commit contract\n\nRefs: ADR 0036'],
    ['colon in description', 'refactor(core): split the registry: part two'],
    ['acronym mid-subject', 'feat(core): expose the HTTP-free host contract'],
    ['multi scope', 'test(core,theme): cover the degradation chain'],
    ['revert', 'revert(core): revert the widget registry'],
  ];

  const PASS = {
    rejects: 'rejected its violator',
    allows: 'stayed silent',
    asserts: 'holds',
  };
  const FAIL = {
    rejects: (d) => `did NOT reject its violator [${d}] (gate is broken)`,
    allows: (d) => `fired on a LEGAL message [${d}] (gate over-fires)`,
    asserts: (d) => `${d} (gate would misreport every commit)`,
  };

  const outcomes = [];
  for (const [rule, message] of CASES) {
    const found = checkCommit({ rel: 'planted', message }, context);
    outcomes.push({
      kind: 'rejects',
      name: rule,
      ok: found.some((p) => p.rule === rule),
      detail: found.map((p) => p.rule).join(', ') || 'no problems at all',
    });
  }
  for (const [name, message] of ALLOWED) {
    const found = checkCommit({ rel: 'planted', message }, context);
    outcomes.push({
      kind: 'allows',
      name,
      ok: found.length === 0,
      detail: found.map((p) => p.rule).join(', '),
    });
  }

  // The scope vocabulary is the one input this gate computes rather than declares. If the
  // derivation silently returned only the fixed scopes, every package-scoped commit would be
  // rejected and the failure would look like a contributor mistake rather than a broken gate.
  const expected = ['core', 'theme', 'eslint-config'];
  const derived = expected.filter((s) => context.scopes.has(s));
  outcomes.push({
    kind: 'asserts',
    name: 'derives package scopes from workspaces',
    ok: derived.length === expected.length,
    detail: `derived only [${derived.join(', ')}] from the workspaces globs`,
  });

  let failures = 0;
  for (const { kind, name, ok, detail } of outcomes) {
    if (ok) {
      console.log(`  ✓ check-commits/${name} — ${PASS[kind]}`);
    } else {
      console.error(`  ✗ check-commits/${name} — ${FAIL[kind](detail)}`);
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const { label, note, skipped, count, context, problems } = run(process.argv.slice(2));
const merges = skipped ? `, ${skipped} merge commit(s) skipped` : '';

if (note) console.log(`ℹ ${note}`);

if (problems.length) {
  console.error(
    `✗ commit gate: ${problems.length} violation(s) across ${count} commit(s) in ${label}${merges}\n`,
  );
  for (const p of problems) console.error(`  ${p.rel}:${p.line}  [${p.rule}] ${p.message}`);
  console.error(
    `\n  Grammar: type(scope)?!?: description — types ${TYPES.join('|')}; scopes ` +
      `${[...context.scopes].join('|')}. Reference: docs/decisions/0036-conventional-commits.md.`,
  );
  console.error('  Amend with `git commit --amend`, or rewrite the range with `git rebase -i`.');
  process.exit(1);
}

console.log(
  `✓ commit gate: ${count} commit(s) in ${label} conform${merges} ` +
    `(scopes: ${[...context.scopes].join(', ')})`,
);
