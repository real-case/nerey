# Verification record

State of the repository as of 2026-11-19, on `main` after phase 2 of the production-ready plan
(commit 7cca749) plus the security policy. Every number below was produced by running the command
named next to it, on Node 24 in the Linux container, not by reading a summary. The first record,
taken at the end of the initial build on 2026-08-10, is kept in git history; the two sections after
the tables are from that build and remain true as history.

## Gates

| Command                         | Result                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`             | PASS — `tsc -p tsconfig.json`, 0 errors                                 |
| `npm run lint`                  | PASS — 0 errors, 0 warnings                                             |
| `npm run format:check`          | PASS                                                                    |
| `npm run gen:check`             | PASS — 127 tokens and 44 CSS Module declarations current                |
| `npm run build`                 | PASS — three packages, JS + CSS + declarations                          |
| `npm run check:tokens`          | PASS — 44 stylesheets                                                   |
| `npm run check:core-purity`     | PASS — 38 shipped source files, manifest and dist                       |
| `npm run check:data-contract`   | PASS — 11 attributes, 6 states, 203 source files                        |
| `npm run check:public-api`      | PASS — 487 symbols across 4 barrels                                     |
| `npm run check:api-signatures`  | PASS — 487 signatures across 4 barrels                                  |
| `npm run check:entry-fields`    | PASS — all 11 fields of `WidgetRegistryEntry` read by core              |
| `npm run check:mutants`         | PASS — 5 of 5 planted defects across 3 suites killed                    |
| `npm run check:stories`         | PASS — 45 components, 45 with stories, 45 with play functions           |
| `npm run check:a11y`            | PASS — 2 documented waivers, none expired                               |
| `npm run check:citations`       | PASS — 2292 citations across 345 files resolve to 53 records            |
| `npm run check:commits`         | PASS — every commit in the range conforms                               |
| `npm run check:boundaries`      | PASS — 235 modules, 695 dependencies, 0 violations                      |
| `npm run check:ci-pins`         | PASS — 3 workflows, every action pinned by digest                       |
| `npm run check:workflow-gates`  | PASS — 3 workflows, 2 on pull requests, no shared concurrency group     |
| `npm run check:widget-labels`   | PASS — 11 widgets read all 32 chrome strings through the labels context |
| `npm run check:eslint-rules`    | PASS — 52 boundary lines across 4 surfaces                              |
| `npm run check:security-policy` | PASS — private channel named, 3 packages covered, threat model linked   |
| `npm run check:spelling`        | PASS — 68 Markdown files, 0 issues                                      |
| `npm run check:exports`         | PASS — 3 packages: manifests, artifacts, `publint`, `attw`              |
| `npm run check:gates`           | PASS — **22 gates registered, 22 self-tests passed, 0 warnings**        |

`npm run test:visual` and `npm run check:published-site` run in CI only (the pinned Playwright
image, and the deploy job with network), so they are not in this table.

## Tests

| Suite                                         | Result                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `vitest --project unit` (jsdom)               | 839 tests, 37 files, all passing                                   |
| `vitest --project storybook` (Chromium + axe) | 352 tests, 45 files, all passing                                   |
| Merged coverage (`vitest run --coverage`)     | statements 95% · branches 89.91% · functions 96.86% · lines 97.01% |

Thresholds are 80 / 75 / 80 / 80. Coverage is **merged across both projects** — running only
`--project unit` reports far less, because most of the theme is covered by stories rather than by
unit tests, and reading that number alone would be reading half the evidence.

## What the gates caught that review would not have

Recorded because each is the specific argument for the gate that found it.

**A contrast defect in the palette.** `--nerey-text-muted` was `slate-500`, which measures
4.08:1 on the canvas surface — below the 4.5:1 AA threshold for normal text. Nobody looking at
it would have noticed; axe failed a `Text` story. Moved a ramp step darker (5.85:1).

**A stranded popup in the layout.** `.positioner { display: flex }` is an author declaration and
beats the UA's `[hidden] { display: none }` at equal specificity. Base UI force-mounts a closed
Select's positioner so the trigger's typeahead keeps its item labels — so a closed select left
its entire option list in the layout at opacity 0, exposed to axe and to assistive technology.
Testing-library's `queryByRole` honours `hidden` and axe does not, which is why every story
asserted the popup was gone while the gate saw it.

**An unnamed listbox.** Base UI sets a Select popup's role, id and orientation and stops. An
unnamed listbox escapes axe only while some `role="combobox"` points `aria-controls` at it, a
relationship the trigger drops on close. The wrapper now threads the trigger's label through.

**A scroll container nobody could reach.** The `text` widget gave `<pre>` `overflow-x: auto`,
making it a scroll container — and a scroll container must be keyboard reachable or the code
past the right edge is pointer-only. The theme could not fix it by adding `tabIndex`: the `<pre>`
comes from the _host's_ injected renderer. Fixed by removing the scroll.

**A half-applied registry override.** `createWidgetRegistry` pruned a replaced entry from its
exact-match map but not from the ranged-resolution list, so `get('chart', '1.0.0')` returned the
replacement while `get('chart', '9.9.9')` still resolved through the old entry. Found by an
agent writing tests against the spine, on the path nobody tries first.

**A packaging defect invisible to every bundler.** The emitted `.d.ts` files carried
extensionless relative imports, which do not resolve under `node16`. `attw` reported it as an
internal resolution error. Every bundler resolves it fine, so it would have broken only for the
consumer who type-checks with `moduleResolution: 'nodenext'` — and then broken completely.

**A gate that restored its own violator.** `process.exit()` terminates immediately and does not
run `finally`, so `gen-tokens --self-test` left its planted drift on disk and the next gate run
failed against a corrupted artifact. Every gate's teardown now happens before any exit.

## What CI caught that every local run had missed

The repository was pushed to [real-case/nerey](https://github.com/real-case/nerey) on
2026-08-10. CI failed twice before going green, each time on something a local run had
reported as passing.

**Coverage measured over half the evidence.** The `test` job ran
`vitest run --project unit --coverage`, which reports 44% and fails the 80% threshold — not
because coverage is bad, but because ADR 0007 defines the threshold over the **merged** number
and most of `@nerey/theme` is covered by stories rather than unit tests. The workflow was written
to a brief that named the wrong command. One `vitest run --coverage` across both projects is the
measurement the ADR actually describes.

**Twenty-two build artifacts committed as source.** A `tsc` run with the wrong project had
emitted `.d.ts` files next to their sources inside `packages/core/src`, and the initial
`git add -A` swept them in. They are in no tsconfig `include`, so eslint's project service
rejects them outright. The local run passed because the files happened to resolve there; on a
clean checkout they do not. Untracked and gitignored, with explicit negations for the two kinds
of `.d.ts` that genuinely are source — and the negations were verified with `git check-ignore`
rather than assumed, since a broad ignore shadowing them would silently stop future generated
declarations from ever being committed.

**A test suite that depended on a prior build.** The second run got `quality` green and failed
`test` on `Failed to resolve import "@nerey/core"` from every theme widget. The workspace
symlink sends resolution through core's `exports` map to `dist/index.js`, and the test job has
no build step — so the whole suite quietly required someone to have run `npm run build` first.
It passed locally only because a `dist` directory was lying around. `@nerey/core` now aliases to
source in both `vitest.config.ts` and `.storybook/main.ts`, mirroring the `paths` mapping
`tsconfig.json` already uses. Verified by deleting both `dist` directories and running the CI
command: 1103 tests across 74 files, 94.99% statements.

All three are the same class of defect: a check that passes locally for a reason that does not
survive a fresh environment. It is the specific thing CI exists to find, and it is why "the
commands are verified locally" was recorded as a limitation rather than as a pass.

The lesson worth keeping: **a green local run is evidence about one machine.** Every one of
these was invisible until the code met a clean checkout, and none of them would have been found
by more careful reading.

## Known limitations

- The Storybook test-runner smoke pass over a _built_ Storybook is not wired. The Vitest browser
  project covers the same stories against the dev build; the static-build-only failure mode is
  uncovered.
- Coverage excludes barrels and `tokens.generated.ts`. Covering a generated union proves nothing.
- The two a11y waivers are element-scoped exclusions for Base UI's own focus-manager sentinels,
  not rule disables, and both expire 2027-08-01.

## Deviations

Nine places where the code and an accepted ADR disagreed are recorded in
[deviations.md](deviations.md), each with the direction of the fix. All nine are resolved: D-1 to
D-6 and D-8 by code or a superseding record, D-7 by code, and D-9 by an in-place edit of ADR 0018
that the repo owner authorised. None was a silent divergence: every one was surfaced by a gate or
by an agent reading a record against the code.
