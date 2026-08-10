#!/usr/bin/env node
// scripts/hooks/post-edit.mjs
//
// PostToolUse hook (Claude Code). ADR 0034 — the edit-time half of the gate layer.
//
// This file is a DISPATCHER, not a second implementation. It maps the edited path to the same
// `scripts/check-*.mjs` binaries `npm run check:all` runs, so every rule has exactly one
// implementation and two triggers. The first draft of this hook re-implemented the token rules
// inline and immediately drifted: the real gate learned that a literal inside a mandated
// `var(--token, fallback)` is legal, the hook did not, and it started rejecting correct CSS.
// One implementation per rule is the whole point.
//
// Budget: only fast, file-scoped gates belong here (~2s total). tsc, Vitest, Storybook and
// dependency-cruiser stay CI gates — a hook that takes ten seconds gets disabled.
//
// Contract: exit 2 with stderr to BLOCK and show Claude the reason; exit 0 to allow. Drift
// reminders (a generated artifact went stale elsewhere) are NOT violations of the edited file,
// so they surface through `additionalContext` on a clean exit. Fails OPEN on any unexpected
// error — a convenience hook must never brick the session.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const bin = (name) => join(repoRoot, 'node_modules', '.bin', name);

/**
 * path glob → gate script. Globs are matched with a simple `**`/`*` translation rather than a
 * dependency; the manifest is small and every entry is asserted by `npm run check:gates`.
 */
const DISPATCH = [
  { match: 'packages/**/*.module.css', gate: 'scripts/check-tokens.mjs' },
  { match: 'packages/core/src/**/*.ts', gate: 'scripts/check-core-purity.mjs' },
  { match: 'packages/core/src/**/*.tsx', gate: 'scripts/check-core-purity.mjs' },
  { match: 'packages/core/package.json', gate: 'scripts/check-core-purity.mjs' },

  { match: 'packages/**/*.tsx', gate: 'scripts/check-data-contract.mjs' },
  { match: 'packages/core/src/data-attrs.ts', gate: 'scripts/check-data-contract.mjs' },

  { match: 'packages/**/*.stories.tsx', gate: 'scripts/check-stories.mjs' },
  { match: 'packages/**/*.stories.tsx', gate: 'scripts/check-a11y-waivers.mjs' },

  { match: 'packages/core/src/index.ts', gate: 'scripts/check-public-api.mjs' },
  { match: 'packages/**/index.ts', gate: 'scripts/check-public-api.mjs' },

  { match: '**/*.md', gate: 'scripts/check-adr-citations.mjs' },
  { match: 'packages/**/*.ts', gate: 'scripts/check-adr-citations.mjs' },
  { match: 'scripts/**/*.mjs', gate: 'scripts/check-adr-citations.mjs' },
];

/**
 * Gates deliberately NOT dispatched here, with the reason. `npm run check:gates` warns about any
 * unlisted gate, so an omission has to be a recorded decision rather than an oversight.
 */
export const CI_ONLY = {
  'scripts/check-exports.mjs': 'needs a built dist and a packed tarball — far past the ~2s hook budget',
  'scripts/check-commits.mjs': 'reads git history, which no single file edit can invalidate',
  'scripts/check-gates.mjs': 'runs every other gate; dispatching it per edit would be quadratic',
};

/**
 * Translates a `**`/`*` glob to a RegExp in a single left-to-right pass.
 *
 * The obvious implementation — chained `.replace()` calls — needs a placeholder to stop the
 * `*` rule from eating the `**` rule's output, and any placeholder is a character that could
 * legitimately appear in a path. A single pass has no such hazard.
 */
function globToRegExp(glob) {
  let body = '';
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith('**/', i)) {
      body += '(?:[^/]+/)*';
      i += 2;
      continue;
    }
    const char = glob[i];
    if (char === '*') {
      body += '[^/]*';
      continue;
    }
    body += /[.+^${}()|[\]\\?]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${body}$`);
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function surfaceContext(message) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message },
    }),
  );
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(readStdin() || '{}');
} catch {
  process.exit(0);
}

const filePath = payload.tool_input?.file_path;
if (!filePath || typeof filePath !== 'string') process.exit(0);

const abs = resolve(filePath);
if (!existsSync(abs) || !statSync(abs).isFile()) process.exit(0);
const relPosix = relative(repoRoot, abs).split(sep).join('/');
if (relPosix.startsWith('..')) process.exit(0);

// 1. Format in place. A transient syntax error mid-edit is not this hook's business.
try {
  execFileSync(bin('prettier'), ['--write', '--ignore-unknown', abs], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
} catch {
  /* ignored */
}

// 2. Run every gate whose glob matches, deduplicated.
const gates = [...new Set(DISPATCH.filter((d) => globToRegExp(d.match).test(relPosix)).map((d) => d.gate))];

for (const gate of gates) {
  try {
    execFileSync(process.execPath, [join(repoRoot, gate)], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    process.stderr.write(
      `⛔ post-edit (${gate}) rejected the workspace after editing ${relPosix}:\n\n${output}\n`,
    );
    process.exit(2);
  }
}

// 3. Codegen-drift reminders — a follow-up step, not a defect in this edit.
if (relPosix === 'packages/theme/src/tokens.css') {
  surfaceContext(
    'tokens.css changed, so three generated artifacts are now stale: tokens.generated.ts, ' +
      'tokens.allowlist.json and docs/design-system/tokens.agent-rules.md. Run `npm run gen:tokens` ' +
      '(ADR 0024). CI drift-checks them.',
  );
}

if (relPosix.endsWith('.module.css') && !existsSync(`${abs}.d.ts`)) {
  surfaceContext(
    `${relPosix} has no committed type declarations yet. Run \`npm run gen:css-types\` so ` +
      `\`styles.typo\` is a compile error rather than a silently unstyled element (ADR 0023).`,
  );
}

process.exit(0);
