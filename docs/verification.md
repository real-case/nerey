# Verification record

State of the repository as of 2026-08-10, at the end of the initial build. Every number below
was produced by running the command named next to it, not by reading a summary.

## Gates

| Command                       | Result                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| `npm run typecheck`           | PASS — `tsc --noEmit`, 258 source files, 0 errors                |
| `npm run lint`                | PASS — 0 errors, 0 warnings                                      |
| `npm run format:check`        | PASS                                                             |
| `npm run gen:check`           | PASS — 127 tokens and 44 CSS Module declarations current         |
| `npm run build`               | PASS — both packages, JS + CSS + declarations                    |
| `npm run check:tokens`        | PASS — 44 stylesheets                                            |
| `npm run check:core-purity`   | PASS — 36 shipped source files, manifest and dist                |
| `npm run check:data-contract` | PASS — 9 attributes, 6 states, 200 source files                  |
| `npm run check:public-api`    | PASS — 472 symbols across 4 barrels                              |
| `npm run check:stories`       | PASS — 45 components, 45 with stories, 45 with play functions    |
| `npm run check:a11y`          | PASS — 2 documented waivers, none expired                        |
| `npm run check:citations`     | PASS — 1753 citations across 327 files resolve to 37 records     |
| `npm run check:commits`       | PASS (vacuous — no commits yet)                                  |
| `npm run check:boundaries`    | PASS — 116 modules, 370 dependencies, 0 violations               |
| `npm run check:exports`       | PASS — manifests, artifacts, `publint`, `attw`                   |
| `npm run check:gates`         | PASS — **12 gates registered, 12 self-tests passed, 0 warnings** |

## Tests

| Suite                                         | Result                                                                |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `vitest --project unit` (jsdom)               | 751 tests, 29 files, all passing                                      |
| `vitest --project storybook` (Chromium + axe) | 352 tests, 45 files, all passing                                      |
| Merged coverage                               | statements 95.05% · branches 89.04% · functions 97.19% · lines 96.98% |

Thresholds are 80 / 75 / 80 / 80. Coverage is **merged across both projects** — running only
`--project unit` reports 44%, because most of the theme is covered by stories rather than by
unit tests, and reading that number alone would be reading half the evidence.

The browser suite was confirmed over 18 consecutive full-suite runs, five of them with
`--sequence.shuffle`. That was not ceremony: one failure in it (`Disclosure/Tabs`) was a race
that reproduced roughly one run in three, and a single green run would not have been evidence.

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

## Known limitations

- `check:commits` is vacuous until there is history — the repository has no commits.
- `check:spelling` is outside `check:all`: `cspell` has no project dictionary and reports
  several hundred unknown words, which makes it noise rather than a gate. Recorded in
  `CHECK_ALL_EXEMPT` inside `check-gates.mjs`.
- The Storybook test-runner smoke pass over a _built_ Storybook is not wired. The Vitest browser
  project covers the same stories against the dev build; the static-build-only failure mode is
  uncovered.
- CI has never run. `.github/workflows/ci.yml` is written and its commands are the ones verified
  here, but no GitHub Actions runner has executed it.
- Coverage excludes barrels and `tokens.generated.ts`. Covering a generated union proves nothing.
- The two a11y waivers are element-scoped exclusions for Base UI's own focus-manager sentinels,
  not rule disables, and both expire 2027-08-01.

## Deviations

Five places where the code and an accepted ADR disagree are recorded in
[deviations.md](deviations.md), each with the direction of the fix. None is a silent divergence:
every one was surfaced by a gate or by an agent reading a record against the code.
