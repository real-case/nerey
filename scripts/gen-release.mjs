#!/usr/bin/env node
// scripts/gen-release.mjs
//
// ADR 0039 — prepares ONE package's release. It writes files and prints commands; it does not
// commit, does not tag, and never touches the network. The decision to release stays human,
// because a behavioural break passes every gate this repository has (ADR 0038) and only a person
// is going to catch it.
//
// What it derives, and from where:
//
//   the bump      the commit range since that package's last tag, classified by the ADR 0036
//                 grammar. Attribution is the commit SCOPE, not the file paths: a change to a
//                 core type breaks theme consumers while touching no file under packages/theme.
//   the number    ADR 0029's arithmetic, including the pre-1.0 shift — on 0.x a breaking change
//                 bumps MINOR and everything else bumps PATCH.
//   the changelog the same range, grouped by type. ADR 0036 said commit discipline was for
//                 generating these; until ADR 0039 nothing consumed it.
//
// It REFUSES rather than warns, on four things (ADR 0039, Confirmation):
//
//   no-commits         nothing releasable in the range — the tag would publish an identical
//                      artifact under a new number.
//   undeclared-break   a contract baseline (ADR 0038) lost a symbol or changed a signature
//                      between the last tag and HEAD, and no commit in the range carries `!`.
//                      This is the two-signal cross-check ADR 0029 described and ADR 0038
//                      deferred to a release runbook: the author declares the bump, the gates
//                      derive it, and a disagreement blocks rather than resolving itself in
//                      whichever direction happens to be quieter.
//   dirty-tree         uncommitted changes, which would make the tag name a build nobody can
//                      reproduce.
//   version-behind     a tag already exists at or above the version in the manifest, so the
//                      manifest is behind its own history.
//
// Usage:
//   node scripts/gen-release.mjs --package @nerey/core
//   node scripts/gen-release.mjs --package @nerey/core --dry-run   print, write nothing
//   node scripts/gen-release.mjs --self-test                       plant a violator per rule

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

/** Record separators for `git log`, chosen because neither can occur in a commit message. */
const FIELD = '\u001f';
const RECORD = '\u001e';

/** ADR 0036's type vocabulary, split by what it does to a version (ADR 0029). */
const MINOR_TYPES = new Set(['feat']);
const PATCH_TYPES = new Set(['fix', 'perf', 'refactor']);

/** Everything else — docs, test, build, ci, chore, style, revert — releases nothing on its own. */
const CHANGELOG_SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Bug Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
];

/**
 * Which barrels of the ADR 0038 baselines belong to which package. A removal in one of these is
 * what `undeclared-break` reads; a removal in a barrel of some OTHER package is that package's
 * release problem, not this one's.
 */
const OWNED_BARRELS = {
  '@nerey/core': (key) => key === '@nerey/core' || key.startsWith('@nerey/core/'),
  '@nerey/theme': (key) => key === '@nerey/theme',
  '@nerey/eslint-config': () => false,
};

const BASELINES = ['docs/design-system/public-api.json', 'docs/design-system/api-signatures.json'];

function fail(rule, message) {
  console.error(`✗ ${rule}: ${message}`);
  process.exit(1);
}

function runGit(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

/* ── Pure core. Everything below this line is testable without git or a network. ─────────── */

/**
 * `type(scope)!: description` — the ADR 0036 grammar, parsed leniently so a commit that does not
 * conform is carried through as unclassified rather than dropped. `check:commits` is what rejects
 * a malformed subject; silently discarding one here would hide it from the changelog too.
 */
const HEADER_RE = /^([A-Za-z][A-Za-z0-9-]*)(?:\(([^()]*)\))?(!)?:(?: (.*))?$/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/m;

export function parseCommitRecords(text) {
  return text
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', subject = '', body = ''] = record.split(FIELD);
      const match = subject.match(HEADER_RE);
      return {
        hash: hash.trim(),
        subject,
        type: match?.[1] ?? null,
        scope: match?.[2] ?? null,
        description: match?.[4] ?? subject,
        breaking: Boolean(match?.[3]) || BREAKING_FOOTER_RE.test(body),
      };
    });
}

/** The scope that names a package: `@nerey/core` → `core` (ADR 0036 computes the same set). */
export function scopeOf(packageName) {
  return packageName.startsWith('@') ? packageName.split('/')[1] : packageName;
}

export function classify(commits) {
  if (commits.some((commit) => commit.breaking)) return 'major';
  if (commits.some((commit) => commit.type && MINOR_TYPES.has(commit.type))) return 'minor';
  if (commits.some((commit) => commit.type && PATCH_TYPES.has(commit.type))) return 'patch';
  return null;
}

/**
 * ADR 0029's pre-1.0 shift: on `0.x` the whole scale moves one place, so a MAJOR-class change
 * bumps MINOR and MINOR and PATCH classes both bump PATCH. The `!` marker is still mandatory —
 * the shift is in the arithmetic, never in whether the break is declared.
 */
export function applyPreOne(level, version) {
  if (!version.startsWith('0.')) return level;
  if (level === 'major') return 'minor';
  return 'patch';
}

export function nextVersion(current, level) {
  const [major = 0, minor = 0, patch = 0] = current.split('.').map((part) => Number.parseInt(part, 10));
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * What changed on a package's surfaces between two readings of a baseline.
 *
 * `public-api.json` holds `{ values: [], types: [] }` per barrel; `api-signatures.json` holds
 * `{ name: signature }`. Both reduce to a name→shape map, so one comparison covers both and a
 * third baseline in that shape would need no new code here.
 */
function flattenBarrel(entry) {
  if (!entry || typeof entry !== 'object') return new Map();
  const map = new Map();
  if (Array.isArray(entry.values) || Array.isArray(entry.types)) {
    for (const name of entry.values ?? []) map.set(name, 'value');
    for (const name of entry.types ?? []) map.set(name, 'type');
    return map;
  }
  for (const [name, signature] of Object.entries(entry)) map.set(name, signature);
  return map;
}

export function surfaceBreaks(previous, current, owns) {
  const breaks = [];
  for (const key of Object.keys(previous ?? {})) {
    if (!owns(key)) continue;
    const before = flattenBarrel(previous[key]);
    const after = flattenBarrel(current?.[key]);
    for (const [name, shape] of before) {
      if (!after.has(name)) {
        breaks.push({ key, name, kind: 'removed' });
      } else if (after.get(name) !== shape) {
        breaks.push({ key, name, kind: 'changed' });
      }
    }
  }
  return breaks;
}

export function renderChangelogEntry(version, date, commits) {
  const lines = [`## ${version} — ${date}`, ''];
  let wrote = false;

  for (const [type, heading] of CHANGELOG_SECTIONS) {
    const matching = commits.filter((commit) => commit.type === type);
    if (matching.length === 0) continue;
    lines.push(`### ${heading}`, '');
    for (const commit of matching) {
      const mark = commit.breaking ? '**BREAKING** ' : '';
      lines.push(`- ${mark}${commit.description} (${commit.hash.slice(0, 7)})`);
    }
    lines.push('');
    wrote = true;
  }

  const breaking = commits.filter((commit) => commit.breaking);
  if (breaking.length > 0) {
    lines.push('### Breaking changes', '');
    for (const commit of breaking) lines.push(`- ${commit.description} (${commit.hash.slice(0, 7)})`);
    lines.push('');
    wrote = true;
  }

  // A release with nothing to say is a release that should not have been prepared; `no-commits`
  // catches it upstream, and this is the assertion that the two rules cannot disagree.
  if (!wrote) lines.push('_No user-visible changes._', '');

  return lines.join('\n');
}

const CHANGELOG_HEADER = (name) =>
  `# ${name}\n\nAll notable changes to this package. The format follows the commit range it was\ngenerated from (ADR 0036), and the version numbers follow ADR 0029.\n\n`;

/** Writes the manifest version and prepends the entry. Split out so the self-test can run it. */
export function applyRelease(packageDir, packageName, version, entry) {
  const manifestPath = join(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const changelogPath = join(packageDir, 'CHANGELOG.md');
  const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
  const header = existing.startsWith('# ') ? '' : CHANGELOG_HEADER(packageName);
  const body = existing.startsWith('# ')
    ? existing.replace(/^(# [^\n]*\n\n(?:[^\n]*\n)*?\n)/, `$1${entry}\n`)
    : `${header}${entry}\n`;
  writeFileSync(changelogPath, body, 'utf8');

  return { manifestPath, changelogPath };
}

/* ── Impure shell. ──────────────────────────────────────────────────────────────────────── */

function workspacePackages() {
  const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const globs = root.workspaces ?? [];
  const dirs = [];
  for (const glob of globs) {
    const [base] = String(glob).split('/*');
    const parent = join(repoRoot, base);
    if (!existsSync(parent)) continue;
    // Sorted, so nothing downstream depends on filesystem iteration order (ADR 0033).
    for (const entry of readdirSync(parent).sort()) {
      const dir = join(parent, entry);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs.map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }));
}

function lastTagFor(packageName) {
  const tags = runGit(['tag', '--list', `${packageName}@*`])
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags.length === 0) return null;
  const versions = tags.map((tag) => ({ tag, version: tag.slice(packageName.length + 1) }));
  versions.sort((a, b) => compareVersions(a.version, b.version));
  return versions.at(-1);
}

function commitsSince(tag, scope) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const format = `%H${FIELD}%s${FIELD}%b${RECORD}`;
  const log = execFileSync('git', ['log', `--format=${format}`, range], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return parseCommitRecords(log).filter((commit) => commit.scope === scope);
}

function baselineAt(ref, file) {
  try {
    return JSON.parse(runGit(['show', `${ref}:${file}`]));
  } catch {
    return null; // the baseline did not exist at that ref — nothing to compare
  }
}

function main(argv) {
  const packageArg = argv[argv.indexOf('--package') + 1];
  if (!argv.includes('--package') || !packageArg || packageArg.startsWith('--')) {
    fail('usage', 'name the package: `npm run gen:release -- --package @nerey/core`.');
  }
  const dryRun = argv.includes('--dry-run');

  const found = workspacePackages().find((entry) => entry.manifest.name === packageArg);
  if (!found) fail('usage', `${packageArg} is not a workspace package.`);
  const { dir, manifest } = found;

  if (runGit(['status', '--porcelain']) !== '') {
    fail(
      'dirty-tree',
      'the working tree has uncommitted changes. A tag must name a commit, and a build from a ' +
        'dirty tree is one nobody else can reproduce — commit or stash first.',
    );
  }

  const last = lastTagFor(packageArg);
  if (last && compareVersions(last.version, manifest.version) >= 0) {
    fail(
      'version-behind',
      `${packageArg} is at ${manifest.version} in its manifest but ${last.tag} already exists. ` +
        `The manifest is behind its own history; reconcile before releasing.`,
    );
  }

  const scope = scopeOf(packageArg);
  const commits = commitsSince(last?.tag ?? null, scope);
  const level = classify(commits);

  if (!level) {
    fail(
      'no-commits',
      `nothing releasable for scope \`${scope}\` since ${last?.tag ?? 'the first commit'}. ` +
        `A tag now would publish an identical artifact under a new number.`,
    );
  }

  // The two-signal cross-check (ADR 0039). Skipped on a first release: with no previous tag there
  // is no earlier reading of the baseline, and comparing against nothing would either pass
  // vacuously or condemn every symbol as new.
  if (last) {
    const owns = OWNED_BARRELS[packageArg] ?? (() => false);
    const breaks = BASELINES.flatMap((file) => {
      const previous = baselineAt(last.tag, file);
      const current = existsSync(join(repoRoot, file))
        ? JSON.parse(readFileSync(join(repoRoot, file), 'utf8'))
        : {};
      return surfaceBreaks(previous, current, owns).map((entry) => ({ ...entry, file }));
    });

    if (breaks.length > 0 && !commits.some((commit) => commit.breaking)) {
      const shown = breaks
        .slice(0, 8)
        .map((entry) => `      ${entry.key} · \`${entry.name}\` ${entry.kind} (${entry.file})`)
        .join('\n');
      fail(
        'undeclared-break',
        `${packageArg} lost or reshaped ${breaks.length} public symbol(s) between ${last.tag} and ` +
          `HEAD, but no commit in the range declares a break:\n${shown}\n` +
          `    Either the change is not breaking and a baseline was re-blessed too eagerly, or the ` +
          `commit that made it should have carried \`!\` (ADR 0036 / 0038 / 0039).`,
      );
    }
  }

  const effective = applyPreOne(level, manifest.version);
  const version = nextVersion(manifest.version, effective);
  const date = runGit(['log', '-1', '--format=%ad', '--date=short']);
  const entry = renderChangelogEntry(version, date, commits);

  console.log(`\n${packageArg}  ${manifest.version} → ${version}   (${level} → ${effective} on 0.x)`);
  console.log(`  range: ${last?.tag ?? 'first release'}..HEAD, ${commits.length} commit(s) in scope\n`);
  console.log(entry.replace(/^/gm, '  '));

  if (dryRun) {
    console.log('  (--dry-run: nothing written)\n');
    return;
  }

  const written = applyRelease(dir, packageArg, version, entry);
  const tag = `${packageArg}@${version}`;
  console.log(
    `✓ written: ${written.manifestPath.replace(`${repoRoot}/`, '')}, ` +
      `${written.changelogPath.replace(`${repoRoot}/`, '')}\n\n` +
      `  Read the entry above, then:\n\n` +
      `    git commit -m 'chore(${scope}): release ${version}' -m 'Refs: ADR 0039' \\\n` +
      `      ${written.manifestPath.replace(`${repoRoot}/`, '')} ` +
      `${written.changelogPath.replace(`${repoRoot}/`, '')}\n` +
      `    git tag ${tag}\n` +
      `    git push origin main ${tag}\n\n` +
      `  The tag is what publishes (ADR 0039). CI runs every gate on a clean checkout first.\n`,
  );
}

/* ── Self-test (ADR 0033). ──────────────────────────────────────────────────────────────── */

if (process.argv.includes('--self-test')) {
  const dir = mkdtempSync(join(tmpdir(), 'nerey-release-'));
  const outcomes = [];

  const log = (records) =>
    records.map(({ hash, subject, body = '' }) => `${hash}${FIELD}${subject}${FIELD}${body}`).join(RECORD);

  try {
    // Parsing and classification run through a file on disk, not an inline string: the blind
    // probe in check-gates re-runs this with reads removed and demands a different answer, and a
    // self-test that never reads anything would sail through it (ADR 0033).
    const logFile = join(dir, 'log.txt');
    writeFileSync(
      logFile,
      log([
        { hash: 'a'.repeat(40), subject: 'feat(core): add a widget' },
        { hash: 'b'.repeat(40), subject: 'docs(core): explain it' },
      ]),
      'utf8',
    );
    const featCommits = parseCommitRecords(readFileSync(logFile, 'utf8'));
    outcomes.push(['classifies feat as minor', classify(featCommits) === 'minor']);
    outcomes.push(['applies the 0.x shift', applyPreOne('minor', '0.1.0') === 'patch']);
    outcomes.push(['keeps the scale past 1.0', applyPreOne('minor', '1.4.0') === 'minor']);

    writeFileSync(logFile, log([{ hash: 'c'.repeat(40), subject: 'feat(core)!: drop a widget' }]), 'utf8');
    const breakingCommits = parseCommitRecords(readFileSync(logFile, 'utf8'));
    outcomes.push(['reads the `!` marker', classify(breakingCommits) === 'major']);
    outcomes.push(['a break bumps MINOR on 0.x', applyPreOne('major', '0.1.0') === 'minor']);

    writeFileSync(
      logFile,
      log([{ hash: 'd'.repeat(40), subject: 'fix(core): repair', body: 'BREAKING CHANGE: it moved' }]),
      'utf8',
    );
    outcomes.push([
      'reads a BREAKING CHANGE footer',
      classify(parseCommitRecords(readFileSync(logFile, 'utf8'))) === 'major',
    ]);

    writeFileSync(logFile, log([{ hash: 'e'.repeat(40), subject: 'docs(core): only prose' }]), 'utf8');
    outcomes.push(['no-commits', classify(parseCommitRecords(readFileSync(logFile, 'utf8'))) === null]);

    outcomes.push(['bumps the number', nextVersion('0.1.0', 'patch') === '0.1.1']);

    // undeclared-break — the two-signal check, over both baseline shapes.
    const owns = OWNED_BARRELS['@nerey/core'];
    const namesBefore = { '@nerey/core': { values: ['kept', 'dropped'], types: [] } };
    const namesAfter = { '@nerey/core': { values: ['kept'], types: [] } };
    outcomes.push([
      'undeclared-break (name removed)',
      surfaceBreaks(namesBefore, namesAfter, owns).some((b) => b.name === 'dropped' && b.kind === 'removed'),
    ]);

    const sigBefore = { '@nerey/core': { f: '(a: string) => void' } };
    const sigAfter = { '@nerey/core': { f: '(a: string, b: number) => void' } };
    outcomes.push([
      'undeclared-break (signature changed)',
      surfaceBreaks(sigBefore, sigAfter, owns).some((b) => b.name === 'f' && b.kind === 'changed'),
    ]);

    outcomes.push(['allows an untouched surface', surfaceBreaks(sigBefore, sigBefore, owns).length === 0]);
    outcomes.push([
      "allows another package's removal",
      surfaceBreaks({ '@nerey/theme': { values: ['gone'], types: [] } }, { '@nerey/theme': {} }, owns)
        .length === 0,
    ]);

    // The writer, round-tripped through disk.
    const fixturePkg = join(dir, 'pkg');
    mkdirSync(fixturePkg, { recursive: true });
    writeFileSync(
      join(fixturePkg, 'package.json'),
      `${JSON.stringify({ name: '@nerey/fixture', version: '0.1.0' }, null, 2)}\n`,
      'utf8',
    );
    const entry = renderChangelogEntry('0.1.1', '2026-08-25', featCommits);
    applyRelease(fixturePkg, '@nerey/fixture', '0.1.1', entry);
    const written = JSON.parse(readFileSync(join(fixturePkg, 'package.json'), 'utf8'));
    const changelog = readFileSync(join(fixturePkg, 'CHANGELOG.md'), 'utf8');
    outcomes.push(['writes the manifest version', written.version === '0.1.1']);
    outcomes.push([
      'writes a changelog entry',
      changelog.includes('## 0.1.1') && changelog.includes('add a widget'),
    ]);

    // A second release must not clobber the first — the header stays, the new entry goes on top.
    const second = renderChangelogEntry('0.1.2', '2026-08-26', breakingCommits);
    applyRelease(fixturePkg, '@nerey/fixture', '0.1.2', second);
    const twice = readFileSync(join(fixturePkg, 'CHANGELOG.md'), 'utf8');
    outcomes.push([
      'prepends without losing history',
      twice.includes('## 0.1.2') &&
        twice.includes('## 0.1.1') &&
        twice.indexOf('## 0.1.2') < twice.indexOf('## 0.1.1'),
      twice.slice(0, 200),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ');
    if (ok) {
      console.log(`  ✓ gen-release/${rule} — ${positive ? 'rejected its violator' : 'stayed silent'}`);
    } else {
      console.error(
        positive
          ? `  ✗ gen-release/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ gen-release/${rule} — fired on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

if (!process.argv.includes('--self-test')) main(process.argv.slice(2));
