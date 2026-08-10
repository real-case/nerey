#!/usr/bin/env node
// scripts/check-exports.mjs
//
// ADR 0028 — the packaging gate. It is the thing that catches "works in the monorepo, explodes
// on install", because inside the workspace every path resolves through a symlink and the
// `exports` map is barely consulted. A consumer gets none of that.
//
// Three layers, cheapest first:
//
//   Manifest  Always. Condition ordering, the legacy `main`/`types` pair, `sideEffects` for CSS
//             entries, `files` coverage, and `private`.
//   Artifact  Only when the package's build output is present, so the gate is still useful on a
//             fresh clone. Every export target resolves to a real file, every JS entry chunk
//             carries its `'use client'` banner, and no `.d.ts` carries one.
//   External  `publint` and `attw` against a real `npm pack` tarball — the only view of the
//             package that matches what a consumer downloads.
//
// The artifact layer exists because config is not evidence. Rolldown and Vite both drop a
// top-level directive from a module that ends up merged into a chunk rather than emitted as an
// entry, and neither warns. The only trustworthy place to ask "did the banner survive" is the
// emitted file.
//
// Usage:
//   node scripts/check-exports.mjs                 every workspace package
//   node scripts/check-exports.mjs <pkgDir>...     specific package directories
//   node scripts/check-exports.mjs --no-external   skip publint / attw (manifest + artifact only)
//   node scripts/check-exports.mjs --self-test     plant a violator per rule, assert each fires

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const PACKAGES_DIR = resolve(repoRoot, 'packages');

/** The build-output checks and the external tools, named so the skip note can list them. */
const BUILD_DEPENDENT = [
  'export-target-exists',
  'use-client-banner',
  'no-directive-in-dts',
  'publint',
  'attw',
];

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** Sorted so traversal order never depends on the filesystem (ADR 0033). */
function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function posix(p) {
  return p.split(sep).join('/');
}

/**
 * Repo-relative for the workspace packages, absolute for anything outside it. A `../../tmp/…`
 * path in the output would be unusable to the gate harness, which greps for the path it planted.
 */
function displayPath(abs) {
  const fromRoot = posix(relative(repoRoot, abs));
  return !fromRoot || fromRoot.startsWith('..') ? posix(abs) : fromRoot;
}

/**
 * Line of the first token that occurs in `raw`, 1-based, falling back to 1.
 *
 * package.json findings are about a key, not an offset, and "packages/core/package.json:1" for
 * every one of them makes a multi-problem run unreadable. Naive substring search is enough here:
 * the tokens are quoted JSON keys, which do not collide with values in these manifests.
 */
function lineOfToken(raw, ...tokens) {
  for (const token of tokens) {
    const at = raw.indexOf(token);
    if (at !== -1) return raw.slice(0, at).split('\n').length;
  }
  return 1;
}

/** Strip a leading `./` and any trailing slash so `files` entries and targets compare equal. */
function normalizeEntry(value) {
  return value.replace(/^\.\//, '').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------------------------
// Reading the exports map
// ---------------------------------------------------------------------------------------------

/**
 * Walk `exports`, collecting every leaf string target and every *conditions* object.
 *
 * A node is a subpath map when every key starts with `.`; anything else is a conditions object.
 * Conditions nest legally, so this recurses rather than assuming the two-level shape ADR 0028
 * happens to use today — a gate that only understands the current shape stops enforcing the
 * moment someone nests one.
 *
 * Key order comes from `Object.keys`, which preserves JSON insertion order for every key that is
 * not an array index. Condition names never are, so the ordering rules below are reading the
 * order as authored.
 */
function walkExports(node, path, out) {
  if (typeof node === 'string') {
    out.targets.push({ path, target: node });
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkExports(item, path, out);
    return;
  }
  if (!node || typeof node !== 'object') return;

  const keys = Object.keys(node);
  const isSubpathMap = keys.length > 0 && keys.every((k) => k.startsWith('.'));
  if (!isSubpathMap) out.conditions.push({ path: path || '.', keys });

  for (const key of keys) {
    walkExports(node[key], isSubpathMap ? key : `${path || '.'} → ${key}`, out);
  }
}

function readExports(manifest) {
  const out = { targets: [], conditions: [] };
  if (manifest.exports === undefined) return out;
  if (typeof manifest.exports === 'string') {
    out.targets.push({ path: '.', target: manifest.exports });
    return out;
  }
  walkExports(manifest.exports, '', out);
  return out;
}

/**
 * The `.` entry's runtime and types targets.
 *
 * ADR 0028 keeps every conditional entry flat — `types` then `default` — so a one-level read is
 * exact. A nested entry yields `undefined`, and `no-main-only` then says nothing rather than
 * guessing; publint and attw cover that shape properly.
 */
function rootEntry(exportsField) {
  const node = typeof exportsField === 'string' ? exportsField : exportsField?.['.'];
  if (typeof node === 'string') return { runtime: node, types: undefined };
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    return {
      runtime: typeof node.default === 'string' ? node.default : undefined,
      types: typeof node.types === 'string' ? node.types : undefined,
    };
  }
  return { runtime: undefined, types: undefined };
}

// ---------------------------------------------------------------------------------------------
// Layer 1 — the manifest
// ---------------------------------------------------------------------------------------------

function checkManifest(rel, raw, manifest) {
  const problems = [];
  const add = (rule, message, ...tokens) =>
    problems.push({ rel, line: lineOfToken(raw, ...tokens), rule, message });

  const { targets, conditions } = readExports(manifest);

  // types-first / default-last. Conditions are matched top to bottom by every resolver, so a
  // `types` listed after `import` is simply never reached, and a `default` that is not last
  // shadows everything below it. publint reports these under exactly these names.
  for (const { path, keys } of conditions) {
    const typesAt = keys.indexOf('types');
    if (typesAt > 0) {
      add(
        'types-first',
        `\`exports\` ${path}: \`types\` is key ${typesAt + 1} of ${keys.length} (after ` +
          `\`${keys[typesAt - 1]}\`). Conditions match in declaration order, so a \`types\` placed ` +
          `after a runtime condition is never reached — move it to the top (ADR 0028).`,
        `"${path.split(' → ').pop()}"`,
        '"exports"',
      );
    }

    const defaultAt = keys.indexOf('default');
    if (defaultAt !== -1 && defaultAt !== keys.length - 1) {
      add(
        'default-last',
        `\`exports\` ${path}: \`default\` is key ${defaultAt + 1} of ${keys.length}, so ` +
          `\`${keys[defaultAt + 1]}\` and everything after it is unreachable. \`default\` matches ` +
          `everything and must be last (ADR 0028).`,
        '"default"',
        '"exports"',
      );
    }
  }

  // no-main-only — `exports` wins wherever it is understood, but `main`/`types` must still exist
  // and must name the SAME file, or an older resolver silently loads different code than a modern
  // one. That divergence is invisible in the monorepo and reproducible only from a tarball.
  const { runtime, types } = rootEntry(manifest.exports);
  if (manifest.exports === undefined) {
    add(
      'no-main-only',
      'declares no `exports` map. Without one the entire package directory is resolvable, so every ' +
        'internal file becomes public API by accident (ADR 0028).',
      '"main"',
      '"name"',
    );
  } else if (typeof manifest.main !== 'string') {
    add(
      'no-main-only',
      `has an \`exports\` map but no \`main\`. \`exports\` wins for resolvers that understand it; ` +
        `\`main\` is what everything older reads, and it must point at ${runtime ?? 'the same entry'} ` +
        `(ADR 0028).`,
      '"exports"',
      '"name"',
    );
  } else if (runtime && normalizeEntry(manifest.main) !== normalizeEntry(runtime)) {
    add(
      'no-main-only',
      `\`main\` is \`${manifest.main}\` but \`exports["."]\` resolves to \`${runtime}\`. Old and new ` +
        `resolvers would load different files from the same install (ADR 0028).`,
      '"main"',
    );
  }

  if (types && typeof manifest.types !== 'string') {
    add(
      'no-main-only',
      `\`exports["."]\` declares \`types: "${types}"\` but there is no top-level \`types\` field. ` +
        `TypeScript under \`moduleResolution: "node"\` reads only the top-level field and will treat ` +
        `the package as untyped (ADR 0028).`,
      '"exports"',
    );
  } else if (types && normalizeEntry(manifest.types) !== normalizeEntry(types)) {
    add(
      'no-main-only',
      `\`types\` is \`${manifest.types}\` but \`exports["."].types\` is \`${types}\` — two different ` +
        `declaration files for one entry point (ADR 0028).`,
      '"types"',
    );
  }

  // side-effects-css — load-bearing and completely non-obvious.
  if (targets.some((t) => t.target.endsWith('.css'))) {
    const sideEffects = manifest.sideEffects;
    const declared =
      Array.isArray(sideEffects) && sideEffects.some((p) => typeof p === 'string' && p.endsWith('.css'));
    if (!declared) {
      add(
        'side-effects-css',
        `exports a \`.css\` entry but \`sideEffects\` is ${JSON.stringify(sideEffects) ?? 'absent'}. ` +
          `With \`sideEffects: false\` webpack 5 — which Next.js uses — SILENTLY DROPS the consumer's ` +
          `\`import '${manifest.name}/theme.css'\`: no CSS is emitted, no warning is printed, and the ` +
          `app just renders unstyled. Declare \`"sideEffects": ["**/*.css"]\` (ADR 0028).`,
        '"sideEffects"',
        '"exports"',
      );
    }
  }

  // files-includes-dist — named for the case that actually happens (a build directory left out of
  // the tarball), but checked against every export target so an unbuilt package is covered too.
  const publishedTargets = targets.filter((t) => t.target !== './package.json');
  if (!Array.isArray(manifest.files)) {
    if (publishedTargets.length) {
      add(
        'files-includes-dist',
        'declares no `files` array, so the tarball is whatever npm defaults to — typically the whole ' +
          'working directory including `src`. ADR 0028 requires `files: ["dist"]` so a deep import ' +
          'into source fails for want of a file as well as for want of an export.',
        '"files"',
        '"name"',
      );
    }
  } else {
    const covered = new Set(manifest.files.map((f) => normalizeEntry(String(f)).split('/')[0]));
    const needed = [...new Set(publishedTargets.map((t) => normalizeEntry(t.target).split('/')[0]))].sort();
    for (const entry of needed) {
      if (!covered.has(entry)) {
        add(
          'files-includes-dist',
          `\`files\` is ${JSON.stringify(manifest.files)} and does not include \`${entry}\`, which every ` +
            `export target lives under. The map would resolve to paths that are not in the tarball — ` +
            `install-time \`ERR_MODULE_NOT_FOUND\`, invisible in the monorepo (ADR 0028).`,
          '"files"',
        );
      }
    }
  }

  if (manifest.private === true) {
    add(
      'no-private',
      'is `private: true`, so `npm publish` refuses it. Every package under `packages/` is part of ' +
        'the published surface (ADR 0028); an intentionally unpublished package does not belong ' +
        'beside them.',
      '"private"',
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------------------------
// Layer 2 — the emitted artifact
// ---------------------------------------------------------------------------------------------

/** Rolldown emits `'use client';`; the quote style is not worth failing a build over. */
const BANNER_RE = /^(['"])use client\1\s*;?/;
/** In a `.d.ts` the directive is a TypeScript error, so match it as a statement, not as prose. */
const DTS_DIRECTIVE_RE = /^\s*(['"])use client\1\s*;?\s*$/;

function checkBuild(pkgDir, rel, manifest) {
  const problems = [];
  const { targets } = readExports(manifest);
  const uniqueTargets = [...new Set(targets.map((t) => t.target))].sort();
  const distDir = join(pkgDir, 'dist');
  const expectsBuild = uniqueTargets.some((t) => t.startsWith('./dist/'));

  if (expectsBuild && !existsSync(distDir)) {
    return {
      problems,
      note: `${rel}: dist not built, skipping ${BUILD_DEPENDENT.join(' / ')} — run \`npm run build\``,
      ran: false,
    };
  }

  for (const target of uniqueTargets) {
    const abs = join(pkgDir, target);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      problems.push({
        rel: `${rel}/package.json`,
        line: 1,
        rule: 'export-target-exists',
        message:
          `\`exports\` points at \`${target}\`, which is not a file. A consumer resolving this ` +
          `subpath gets \`ERR_MODULE_NOT_FOUND\` (ADR 0028).`,
      });
    }
  }

  // use-client-banner. Only React packages are asked for the directive — @nerey/eslint-config
  // ships a Node flat config, where `'use client'` would be nonsense. The `react` peer dependency
  // is the honest signal for "this package's entries run in a React client graph".
  if (manifest.peerDependencies?.react) {
    for (const target of uniqueTargets) {
      if (!target.endsWith('.js')) continue;
      const abs = join(pkgDir, target);
      if (!existsSync(abs)) continue; // already reported by export-target-exists
      const head = readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
      if (!BANNER_RE.test(head)) {
        problems.push({
          rel: displayPath(abs),
          line: 1,
          rule: 'use-client-banner',
          message:
            `entry chunk does not start with \`'use client';\` (starts with ` +
            `${JSON.stringify(head.slice(0, 40))}). Rolldown and Vite both drop a top-level directive ` +
            `from a module that gets merged into a chunk instead of emitted as an entry, and NEITHER ` +
            `warns — which is why this is asserted on the artifact rather than trusted from the build ` +
            `config. Without it every consumer importing from a server component must add the ` +
            `directive themselves (ADR 0028).`,
        });
      }
    }
  }

  // no-directive-in-dts. Scan the whole build output, not just the entries: `tsc` will refuse the
  // file wherever the directive lands.
  const dtsFiles = existsSync(distDir)
    ? walk(distDir, (f) => f.endsWith('.d.ts'))
    : uniqueTargets.filter((t) => t.endsWith('.d.ts')).map((t) => join(pkgDir, t));

  for (const abs of dtsFiles) {
    if (!existsSync(abs)) continue;
    const lines = readFileSync(abs, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (DTS_DIRECTIVE_RE.test(lines[i])) {
        problems.push({
          rel: displayPath(abs),
          line: i + 1,
          rule: 'no-directive-in-dts',
          message:
            "a `'use client'` directive in a `.d.ts` is a TypeScript error (TS1360-class), so the " +
            "consumer's own `tsc` fails on install. Strip it from the declaration emit; the " +
            'directive belongs on the `.js` entry only (ADR 0028).',
        });
        break; // one report per file is enough to act on
      }
    }
  }

  return { problems, note: null, ran: true };
}

// ---------------------------------------------------------------------------------------------
// Layer 3 — publint and attw against a real tarball
// ---------------------------------------------------------------------------------------------

/**
 * Both tools are repo devDependencies, so the binaries are resolved from `node_modules/.bin`
 * directly rather than through `npx`. `npx` would reach the registry when the binary is missing,
 * and a gate that can silently start downloading is neither deterministic nor offline-safe.
 */
function bin(name) {
  return join(repoRoot, 'node_modules', '.bin', name);
}

function runTool(name, args) {
  const result = spawnSync(bin(name), args, {
    cwd: repoRoot,
    encoding: 'utf8',
    // Colour and emoji vary with TTY detection, and the output is passed through verbatim.
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (result.error) {
    return { ok: false, output: `could not run \`${name}\`: ${result.error.message}` };
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, output, status: result.status };
}

function checkExternal(pkgDir, rel, manifest) {
  const problems = [];
  const missing = ['publint', 'attw'].filter((n) => !existsSync(bin(n)));
  if (missing.length) {
    return [
      {
        rel: `${rel}/package.json`,
        line: 1,
        rule: 'external-tooling',
        message:
          `${missing.join(' and ')} not found in node_modules/.bin — run \`npm install\`. ADR 0028 ` +
          `makes the packed tarball the unit of review, and these are the only tools that see it.`,
      },
    ];
  }

  const publint = runTool('publint', ['--pack', 'npm', pkgDir]);
  if (!publint.ok) {
    problems.push({
      rel: `${rel}/package.json`,
      line: 1,
      rule: 'publint',
      message: `publint rejected the packed tarball (exit ${publint.status}). Its output, verbatim:`,
      verbatim: publint.output,
    });
  }

  /**
   * attw resolves every `exports` subpath as a TypeScript module. A `.css` subpath has no module
   * resolution and never will, so it always reports a false "No resolution" failure — the CSS
   * entries have to come out of the entrypoint list.
   *
   * Two details that are easy to get wrong here:
   *
   *  1. NOT `--ignore-rules no-resolution`. That silences the rule globally, including for `./mock`
   *     and `./testing` — where an unresolvable entry is a real, shipped-to-consumers bug and the
   *     single most valuable thing attw tells us. Excluding the entrypoint keeps the rule armed
   *     everywhere it means something.
   *  2. The exclusions must be literal subpaths. `@arethetypeswrong/core` accepts a RegExp, but the
   *     CLI hands `--exclude-entrypoints` values straight through as strings and compares them by
   *     equality, so a regex such as `.*\.css$` excludes nothing at all and fails silently — it
   *     merely looks like it worked. Verified against v0.18.5.
   */
  const cssEntrypoints = [
    ...new Set(
      readExports(manifest)
        .targets.filter((t) => t.target.endsWith('.css'))
        .map((t) => t.path),
    ),
  ].sort();

  // `--profile esm-only` because ADR 0028 deliberately ships no `require` condition. Without it
  // attw reports `cjs-resolves-to-esm` on every entry and exits non-zero forever, which would make
  // this gate unsatisfiable rather than informative.
  const attwArgs = ['--pack', pkgDir, '--profile', 'esm-only', '--format', 'ascii', '--no-color'];
  if (cssEntrypoints.length) attwArgs.push('--exclude-entrypoints', ...cssEntrypoints);

  const attw = runTool('attw', attwArgs);
  if (!attw.ok) {
    problems.push({
      rel: `${rel}/package.json`,
      line: 1,
      rule: 'attw',
      message: `attw rejected the packed tarball (exit ${attw.status}). Its output, verbatim:`,
      verbatim: attw.output,
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

function checkPackage(pkgDir, { external = true } = {}) {
  const rel = displayPath(pkgDir);
  const manifestPath = join(pkgDir, 'package.json');

  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return {
      rel,
      problems: [
        { rel: `${rel}/package.json`, line: 1, rule: 'manifest', message: 'missing or unreadable.' },
      ],
      notes: [],
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    return {
      rel,
      problems: [
        { rel: `${rel}/package.json`, line: 1, rule: 'manifest', message: `invalid JSON — ${err.message}` },
      ],
      notes: [],
    };
  }

  const problems = checkManifest(`${rel}/package.json`, raw, manifest);
  const build = checkBuild(pkgDir, rel, manifest);
  problems.push(...build.problems);

  const notes = build.note ? [build.note] : [];

  // A missing export target is the one artifact failure worth short-circuiting on: publint would
  // restate it once per entry, drowning every other finding. Any other build problem still gets
  // packed, because a banner defect and a manifest defect are worth reporting in the same run.
  const unresolved = build.problems.some((p) => p.rule === 'export-target-exists');
  if (external && build.ran && !unresolved) {
    problems.push(...checkExternal(pkgDir, rel, manifest));
  } else if (external && build.ran) {
    notes.push(`${rel}: skipped publint / attw — fix the unresolved export targets first`);
  }

  return { rel, problems, notes };
}

function discoverPackages() {
  if (!existsSync(PACKAGES_DIR)) return [];
  return readdirSync(PACKAGES_DIR)
    .sort()
    .map((name) => join(PACKAGES_DIR, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, 'package.json')));
}

function run(dirs, options) {
  const results = dirs.map((dir) => checkPackage(dir, options));
  return {
    count: results.length,
    problems: results.flatMap((r) => r.problems),
    notes: results.flatMap((r) => r.notes),
  };
}

// ---------------------------------------------------------------------------------------------
// --self-test (ADR 0033)
// ---------------------------------------------------------------------------------------------

/**
 * Fixtures live in an OS temp directory rather than under `packages/`, because this gate's unit is
 * a whole package — manifest plus build output — and materialising one inside the workspace would
 * make it a workspace member for the duration of the run.
 */
function writeFixture(dir, { manifest, indexJs, indexDts, css }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (indexJs !== null) writeFileSync(join(dir, 'dist/index.js'), indexJs, 'utf8');
  if (indexDts !== null) writeFileSync(join(dir, 'dist/index.d.ts'), indexDts, 'utf8');
  if (css !== null) writeFileSync(join(dir, 'dist/theme.css'), css, 'utf8');
  return dir;
}

function cleanFixture() {
  return {
    manifest: {
      name: '@fixture/pkg',
      version: '0.0.0',
      type: 'module',
      sideEffects: ['**/*.css'],
      files: ['dist'],
      exports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './theme.css': './dist/theme.css',
        './package.json': './package.json',
      },
      main: './dist/index.js',
      types: './dist/index.d.ts',
      peerDependencies: { react: '^19.0.0' },
    },
    indexJs: "'use client';\nexport const a = 1;\n",
    indexDts: 'export declare const a: number;\n',
    css: '.x {\n  color: red;\n}\n',
  };
}

/** Deep clone so a mutation in one case cannot leak into the next. */
function mutate(fn) {
  const fixture = cleanFixture();
  fixture.manifest = JSON.parse(JSON.stringify(fixture.manifest));
  fn(fixture);
  return fixture;
}

function selfTest({ external }) {
  const root = mkdtempSync(join(tmpdir(), 'nerey-exports-'));
  const dir = join(root, 'pkg');

  const CASES = [
    [
      'types-first',
      mutate((f) => {
        f.manifest.exports['.'] = { default: './dist/index.js', types: './dist/index.d.ts' };
      }),
    ],
    [
      'default-last',
      mutate((f) => {
        f.manifest.exports['.'] = {
          types: './dist/index.d.ts',
          default: './dist/index.js',
          import: './dist/index.js',
        };
      }),
    ],
    [
      'no-main-only',
      mutate((f) => {
        delete f.manifest.main;
      }),
    ],
    [
      'side-effects-css',
      mutate((f) => {
        f.manifest.sideEffects = false;
      }),
    ],
    [
      'files-includes-dist',
      mutate((f) => {
        f.manifest.files = ['README.md'];
      }),
    ],
    [
      'no-private',
      mutate((f) => {
        f.manifest.private = true;
      }),
    ],
    [
      'export-target-exists',
      mutate((f) => {
        f.manifest.exports['./theme.css'] = './dist/never-emitted.css';
      }),
    ],
    [
      'use-client-banner',
      mutate((f) => {
        f.indexJs = 'export const a = 1;\n';
      }),
    ],
    [
      'no-directive-in-dts',
      mutate((f) => {
        f.indexDts = "'use client';\nexport declare const a: number;\n";
      }),
    ],
  ];

  /**
   * Over-firing is the other way a gate is broken, and this one has two specific hazards: a
   * package with no build step at all (@nerey/eslint-config ships `index.js` from the package
   * root and must NOT carry a `'use client'` banner), and a clean checkout where `dist` does not
   * exist yet.
   */
  const ALLOWED = [
    ['the reference package layout', cleanFixture(), () => {}],
    [
      'an unbuilt config package',
      {
        manifest: {
          name: '@fixture/eslint-config',
          version: '0.0.0',
          type: 'module',
          files: ['index.js'],
          exports: { '.': './index.js', './package.json': './package.json' },
          main: './index.js',
          peerDependencies: { eslint: '^9.0.0' },
        },
        indexJs: null,
        indexDts: null,
        css: null,
      },
      (target) => writeFileSync(join(target, 'index.js'), 'export default [];\n', 'utf8'),
    ],
    [
      'a package whose dist is not built yet',
      cleanFixture(),
      (target) => rmSync(join(target, 'dist'), { recursive: true, force: true }),
    ],
  ];

  const outcomes = [];
  // Teardown happens BEFORE any process.exit() below — exit skips `finally`.
  try {
    for (const [rule, fixture] of CASES) {
      writeFixture(dir, fixture);
      const { problems } = checkPackage(dir, { external: false });
      outcomes.push([rule, problems.some((p) => p.rule === rule), '']);
    }

    for (const [name, fixture, after] of ALLOWED) {
      writeFixture(dir, fixture);
      after(dir);
      const { problems } = checkPackage(dir, { external: false });
      outcomes.push([`allows ${name}`, problems.length === 0, problems.map((p) => p.rule).join(', ')]);
    }

    // The external layer is third-party; what this repository owns there is the argument list.
    // ADR 0033 asks for fixture coverage of exactly that, and the fragile part is the attw CSS
    // exclusion — a `.css` subpath makes attw fail unless the entrypoint is excluded by its
    // literal name, and a broken exclusion looks identical to a working one from the outside.
    if (external) {
      writeFixture(dir, cleanFixture());
      const clean = checkExternal(dir, 'fixture', cleanFixture().manifest);
      outcomes.push([
        'allows a .css subpath through publint and attw',
        clean.length === 0,
        clean.map((p) => p.rule).join(', '),
      ]);

      const broken = mutate((f) => {
        f.manifest.main = './dist/does-not-exist.js';
        f.manifest.exports['.'] = { types: './dist/index.d.ts', default: './dist/does-not-exist.js' };
      });
      writeFixture(dir, broken);
      const rejected = checkExternal(dir, 'fixture', broken.manifest);
      outcomes.push(['external-tooling', rejected.length > 0, '']);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ');
    if (ok) {
      console.log(`  ✓ check-exports/${rule} — ${positive ? 'rejected its violator' : 'stayed silent'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-exports/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-exports/${rule} — fired on a LEGAL package [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const external = !argv.includes('--no-external');
const positional = argv.filter((a) => !a.startsWith('--'));

if (argv.includes('--self-test')) {
  process.exit(selfTest({ external }) === 0 ? 0 : 1);
}

const dirs = positional.length ? positional.map((p) => resolve(p)) : discoverPackages();

if (dirs.length === 0) {
  console.error('✗ exports gate: no packages found under packages/ — nothing was checked.');
  process.exit(1);
}

const { count, problems, notes } = run(dirs, { external });

if (problems.length) {
  console.error(`✗ exports gate: ${problems.length} violation(s) across ${count} package(s)\n`);
  for (const p of problems) {
    console.error(`  ${p.rel}:${p.line}  [${p.rule}] ${p.message}`);
    if (p.verbatim) {
      for (const line of p.verbatim.split('\n')) console.error(`      ${line}`);
      console.error('');
    }
  }
  // Notes are printed on the failure path too. Without them a reader sees six violations and
  // assumes the other three rules passed, when in fact they never ran.
  for (const note of notes) console.error(`  · ${note}`);
  console.error('\n  Reference: docs/decisions/0028-package-exports-policy.md');
  process.exit(1);
}

for (const note of notes) console.log(`  · ${note}`);
console.log(`✓ exports gate: ${count} package(s) clean${external ? '' : ' (publint / attw skipped)'}`);
