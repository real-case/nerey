---
status: "accepted"
date: 2026-08-31
decision-makers: Yurii Anichkin
---

# 0042. Visual regression against committed, container-pinned reference images

## Context and Problem Statement

`@nerey/theme`'s entire product is appearance, and nothing in this repository looks at it.

The gates cover a great deal: `check:tokens` proves every tokenizable value goes through a
`var(--nerey-…, fallback)`, `gen:tokens` proves the token artifacts are current, the axe gate
(ADR 0032) proves 352 stories have no WCAG 2.2 AA violation, and the interaction tests prove the
behaviour. None of them can see that a component renders **wrongly**. A semantic token repointed at
the wrong ramp step, a spacing scale shifted one place, a `border-radius` that stopped applying
because a later rule won, a dark-mode override that silently stopped matching — every one of those
passes every check here and ships.

The one visual defect this repository has actually caught was caught by luck of category:
`--nerey-text-muted` measured 4.08:1 and axe failed it as a contrast violation. Had the same
mistake moved the colour to something with adequate contrast and the wrong hue, nothing would have
objected.

There is a reason nobody has written this yet, and it is not oversight. The theme's font tokens are
**system stacks** (ADR 0024) — `--nerey-font-sans` resolves to San Francisco on macOS and to
whatever the runner has on Linux — so the same component rasterises differently on a developer's
laptop and in CI. Any pixel comparison has to answer that first, or it produces a check that is red
for everybody except whoever generated the references.

## Decision Drivers

- The check must catch a change in *appearance*, which is the class every existing gate is blind
  to, without depending on a human noticing a screenshot.
- References must be **reviewable**. A reviewer should see what changed, not be told that something
  did.
- `npm test` must stay runnable and green on any machine. A default suite that fails on a laptop
  for reasons unrelated to the change is a suite people learn to ignore.
- No external service. Every other gate here runs from the repository, and a hosted comparison puts
  the definition of "correct" somewhere nobody can read it from a clean checkout.
- Flake is worse than absence. A visual gate that goes red on an anti-aliasing difference teaches
  people to re-bless without looking, which is strictly worse than not having it.
- The reference set must not be a hand-maintained list, for the reason ADR 0036 gives about scope
  vocabularies: the list is the part that rots, because adding a component does not touch it.

## Considered Options

- Committed reference images, captured by Vitest browser mode, authoritative in a pinned image
- Chromatic
- Computed-style snapshots instead of pixels
- Leave it uncovered and record the limitation

## Decision Outcome

Chosen option: "Committed reference images, captured by Vitest browser mode, authoritative in a
pinned image", because `@vitest/browser` already ships `toMatchScreenshot`, so it costs no new dependency
and reuses the Chromium that already runs the story suite — and because a PNG in a pull request is
the most reviewable artifact any of these gates produce.

Six things about the shape are decisions rather than details.

**One reference per story module, per colour scheme.** The set is computed by globbing the story
files and taking each module's **first** story, which by CSF convention is the canonical rendering.
Capturing all 352 stories would multiply the reference set sixfold to catch very little more, since
the later stories mostly vary state the interaction tests already assert (ADR 0031). A new
component arrives with no reference and the gate goes red until one exists, which is the correct
default: the alternative is a component nothing has ever looked at.

**Both colour schemes, through `data-nerey-theme`.** That attribute is the whole theming mechanism
(ADR 0027), so setting it is exercising the real contract. Dark mode is where a token override
silently stops matching, and it is exactly half of what nothing was checking.

**The container image is the only authority, and the platform token is deliberately dropped.**
Not the operating system — the image. Two Linux machines with different fonts installed render the
same component differently, which is measured rather than supposed: see `Confirmation`. Vitest's default
path template ends in `-${browserName}-${platform}`, which would let a macOS run quietly write a
second set of references beside the Linux ones and pass. Removing the token leaves exactly one
image per screenshot, so running the suite outside the container fails loudly. That is the correct
outcome rather than a shortcoming: this repository has already recorded twice that a green local
run is evidence about one machine.

**Its own config, not a third project.** `vitest.visual.config.ts` and `npm run test:visual` keep
`npm test` portable. Folding the visual run into the default suite would make it fail on a laptop
for a reason that has nothing to do with the change being made.

**References are produced in the official Playwright container**, by `npm run test:visual:update`,
which is the same Linux image CI compares against. Docker is therefore a requirement to *update*
references, never to run the rest of the repository.

**Motion is frozen and the tolerance is exactly zero.** Transitions, animations and the text caret
are disabled during capture, because a screenshot taken 40% through a fade differs from the same
screenshot at 60%.

Zero is the point of pinning the image, and it was arrived at by measurement. The first attempt
allowed `0.002` as a hedge against anti-aliasing; a planted regression — `--nerey-radius-md` from
`0.375rem` to `0.875rem`, a token **seventeen stylesheets use** — moved only **2 of 90** references,
because a corner radius touches a few dozen pixels. At zero the same change fails **38**. A hedge
against a rasteriser you do not control is pointless once you control it, and a gate that absorbs a
visible change to seventeen components is a gate that only looks like it works.

### Consequences

- Good, because the class of regression that had no check now has one, and its failure output is a
  picture of the difference rather than a description of it.
- Good, because it costs no dependency and no service: `@vitest/browser` already had the matcher
  and CI already installs the browser.
- Neutral, because the repository grows by roughly two megabytes of PNG, and grows again whenever a
  visual change lands. That is what a design system's history looks like.
- Bad, because updating references requires Docker. A contributor without it can run every other
  gate but cannot re-bless this one, and must ask.
- Bad, because only the first story of each module is captured, so a regression confined to a
  variant — a `tone="danger"` button, a disabled field — is still invisible. The set is a floor.
- Bad, because a portal-based component's first story usually shows only its trigger: a dialog's
  popup is not in the DOM until it opens, so what is captured is the button that opens it.

### Confirmation

`npm run test:visual` (`vitest.visual.config.ts`) renders every captured story in both colour
schemes and compares against `packages/theme/src/visual/__screenshots__/`. A mismatch fails the
build with the actual, expected and diff images attached.

It runs in CI as its **own job, pinned to the container image**, not as a step on the ordinary
runner. That distinction was learned rather than designed: the first wiring ran it on
`ubuntu-latest` on the reasoning that Linux plus Chromium was enough, and **78 of 90 references
disagreed**. A GitHub runner and the Playwright image ship different font sets, and the theme's
font tokens are system stacks — so "same operating system" is not "same rasteriser", and only the
image the references came out of can be trusted to reproduce them.

`npm run test:visual:update` regenerates the whole set inside
`mcr.microsoft.com/playwright:v1.62.1-noble` — the image CI's browser comes from — so the
references and the comparison come from one rasteriser.

Two guard rules keep the references honest, both in `scripts/hooks/guard-protected-files.mjs`
(ADR 0034):

- Editing or deleting a file under `__screenshots__/` is blocked. Deleting a reference is how a
  visual regression becomes a green run: the gate compares against what is on disk, so an absent
  image passes by having nothing to disagree with.
- The pre-existing block on `vitest --update` is narrowed to exempt this config by name. It exists
  to stop the public-API and data-attribute snapshots being re-blessed silently; the visual config
  includes only `*.visual.test.tsx` and carries no contract snapshot, so blocking it was the rule
  firing on the word `--update` rather than on what the command rewrites.

What no rule can enforce is that somebody **looks** at a changed reference before approving it.
Unlike a JSON baseline, though, a changed PNG renders in the pull request as a before-and-after
picture, which is as close to forcing the look as a repository can get.

## Pros and Cons of the Options

### Committed reference images, captured by Vitest browser mode, authoritative in a pinned image

- Good, because the references live in the repository, so "correct" is readable from a clean
  checkout and diffable in review.
- Good, because it reuses the existing browser, provider and CI browser install.
- Neutral, because Docker becomes a requirement for one workflow. It is already how the Playwright
  project itself recommends stabilising screenshots across machines.
- Bad, because binary files in git are binary files in git: they do not diff textually and they do
  not compress on subsequent changes.

### Chromatic

- Good, because it solves the platform problem completely — capture happens on their
  infrastructure, so a developer's operating system never enters into it.
- Good, because its review UI is purpose-built, with per-story accept/reject and change history,
  which is materially better than looking at a PNG in a diff.
- Good, because it snapshots every story rather than one per module, so variant regressions are
  caught too.
- Bad, because it is a paid external service, and the definition of "correct" then lives somewhere
  a clean checkout cannot read. Every other gate in this repository is a file.
- Bad, because it requires publishing the built Storybook to a third party on every run, which is a
  decision about where this project's work goes, not merely a tooling choice.

### Computed-style snapshots instead of pixels

- Good, because the output is text: it diffs, it reviews, and it is completely platform-independent
  — no fonts, no anti-aliasing, no container.
- Good, because it would state exactly which property changed, which a pixel diff never does.
- Bad, because it checks the inputs to rendering rather than the rendering. A cascade regression
  where a later rule wins changes the computed value and would be caught; a layout that breaks
  because two correct values interact badly would not.
- Bad, because choosing which properties to snapshot is a hand-maintained list — the exact
  rot-prone artifact this record's driver rejects — and snapshotting all of them produces an
  unreadable diff on every change.

### Leave it uncovered and record the limitation

- Good, because it is free, and `docs/verification.md` already names the gap honestly.
- Bad, because the gap is in the one thing `@nerey/theme` exists to provide. A library whose
  product is appearance and whose checks all look elsewhere is checking the easy half.

## More Information

Related: ADR 0031 (the stories this reuses), ADR 0032 (the a11y gate that shares the browser and
cannot see this class), ADR 0024 (the system font stacks that make the platform problem real),
ADR 0027 (the attribute both schemes are captured through), ADR 0033 (why the guard rules are
mechanical), ADR 0034 (where they live).

The Playwright image tag is pinned to the `playwright` version in `devDependencies`. They must move
together: a mismatched image is a different Chromium, and a different Chromium is a different
rasteriser, which is the whole thing this record is trying to hold still.
