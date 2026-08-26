---
status: 'proposed'
date: 2026-08-25
decision-makers: Yurii Anichkin
---

# 0044. Publish the workbench to GitHub Pages, and build it on every pull request

## Context and Problem Statement

Storybook is not a development convenience here — for a library of components and widgets it **is**
the documentation. ADR 0031 makes it the workbench, ADR 0032 makes it the accessibility gate, and
ADR 0042 now takes the visual references from it. It contains 352 stories across 45 components and
widgets, every one of them interactive.

It exists only on a developer's machine. `npm run build-storybook` produces a 12 MB static site that
nothing does anything with, so somebody evaluating whether to adopt these packages has to clone the
repository and run a dev server to see what they look like. For a library whose selling point is
appearance and behaviour, that is the wrong first impression to require work for.

There is a second, sharper problem, and `docs/verification.md` already records it as a known
limitation:

> The Storybook test-runner smoke pass over a _built_ Storybook is not wired. The Vitest browser
> project covers the same stories against the dev build; the static-build-only failure mode is
> uncovered.

The story suite runs against Vite's **dev** server. A static build is a different pipeline — it
bundles, it hashes assets, it inlines the story index — and it can fail, or succeed and produce
something broken, without any check in this repository noticing. Nothing has ever run
`build-storybook` outside a developer's terminal.

## Decision Drivers

- Somebody evaluating the packages should be able to look at them without cloning anything.
- The static build must be **verified**, not merely deployed. A publish step that is the first
  thing to run the build is a publish step that discovers breakage in production.
- Nothing may publish an artifact that failed to build.
- No external service and no cost, consistent with every other decision here.
- The deploy needs `id-token: write`, which is the second job in this repository to hold it
  (ADR 0039 has the other), so what runs in it must be pinned by digest (ADR 0043).

## Considered Options

- GitHub Pages, deployed from Actions, with the build running on every pull request
- Vercel or Netlify
- Build in CI and keep it as a downloadable artifact
- Leave it unpublished

## Decision Outcome

Chosen option: "GitHub Pages, deployed from Actions, with the build running on every pull request",
because it publishes from the repository with no third party involved, and because splitting build
from deploy turns the publish into a gate rather than only a distribution step.

The workflow has two jobs and the split is the decision:

- **`build` runs on every pull request and every push to `main`.** It is the gate: it is the only
  thing in this repository that has ever run `build-storybook`, so a static-build-only failure now
  fails a pull request instead of being discovered by whoever next tried to publish. It closes the
  limitation quoted above by the cheapest possible means — running the command.
- **`deploy` runs only on `main`, and only after `build` succeeded.** It cannot publish a build that
  did not happen, and a pull request cannot publish at all.

`id-token: write` is granted to the deploy job alone, not to the workflow, so the build job — the
one that runs arbitrary story code from a pull request — cannot mint a token for anything.

### Consequences

- Good, because the workbench becomes a URL, which is what a library like this should hand somebody
  who asks what it looks like.
- Good, because the static build is now verified on every pull request. That limitation has been
  recorded since the initial build and cost one job to close.
- Good, because it costs nothing and involves nobody: Pages is part of the repository, so the
  published artifact and its source are the same object.
- Neutral, because every pull request grows by a Storybook build, roughly a minute. That is the
  price of the check, and the check is the point.
- Bad, because the published site is always `main`, so a reviewer cannot see a pull request's
  stories without checking it out. Per-branch previews need an environment per branch and are not
  worth it for one maintainer.
- Bad, because GitHub Pages has to be enabled on the repository, in its settings, by a human. Until
  it is, the deploy job fails — and it fails on `main`, after merge, where a red run is most
  annoying. Nothing in this repository can turn it on or check that it is on.

### Confirmation

The `build` job **is** the fitness function, and it is deliberately not a `check:*` script: it runs
`npm run build-storybook` on every pull request, and a failure blocks the merge. There is nothing to
assert beyond the command succeeding — a static build either produces a site or it does not.

`npm run check:ci-pins` (ADR 0043) covers the new workflow like the others: every action in it is a
commit SHA with a version comment, which matters more here than elsewhere because the deploy job
holds `id-token: write`.

What is **not** confirmed, and is worth naming rather than implying: nothing checks that the
published site *works*. The build succeeding proves it was produced, not that its story index loads
or its assets resolve. A smoke pass over the built site — the second half of the limitation
`docs/verification.md` records — would need a test runner pointed at the artifact, and is not
written.

## Pros and Cons of the Options

### GitHub Pages, deployed from Actions, with the build running on every pull request

- Good, because it is free, first-party, and needs no account anywhere else.
- Good, because the deployment is described in the same repository as the thing being deployed, so
  there is no dashboard holding configuration nobody can read from a checkout.
- Neutral, because it requires a one-time settings change a human must make.
- Bad, because Pages serves one site per repository, so this uses up that slot — a future
  documentation site would have to share it or live elsewhere.

### Vercel or Netlify

- Good, because per-pull-request preview deployments are the feature this option exists for, and
  they are genuinely useful for reviewing a visual change.
- Good, because both handle the build themselves, so CI shrinks rather than grows.
- Bad, because it is an external service holding a deploy token and a configuration that a clean
  checkout cannot read — the same objection ADR 0042 made to a hosted visual-comparison service.
- Bad, because the build then happens somewhere the repository's own checks do not run, so the
  static-build gate this record is half about would not exist.

### Build in CI and keep it as a downloadable artifact

- Good, because it closes the verification gap — the build runs — with no Pages, no settings change
  and no permissions.
- Good, because it is the smallest possible change.
- Bad, because a zip behind a CI run is not documentation. Nobody evaluating a library downloads an
  artifact from a workflow run to look at a button.

### Leave it unpublished

- Good, because it costs nothing and the packages are not published yet, so there is nobody to show
  it to.
- Bad, because that ordering is backwards: the workbench is what makes somebody want the packages,
  and it should exist before the first release rather than after somebody asks.
- Bad, because the static build stays unverified, which is a recorded limitation with a one-job fix.

## More Information

Serves ADR 0031 (the workbench itself) and closes half of the limitation `docs/verification.md`
records about the static build. Related: ADR 0043 (why the actions in it are pinned), ADR 0039 (the
other job holding `id-token: write`), ADR 0032 (the a11y gate that runs against the dev build, not
this one).

The one-time step nothing here can perform: **Settings → Pages → Source: GitHub Actions**. The
deploy job fails until that is set, and it fails on `main`.
