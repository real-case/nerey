---
status: 'proposed'
date: 2026-08-25
decision-makers: Yurii Anichkin
---

# 0043. The CI supply chain is pinned by digest and updated by Dependabot

## Context and Problem Statement

Every workflow in this repository names its actions by moving tag — `actions/checkout@v4`,
`actions/setup-node@v4`, `actions/cache@v4`. A tag is a pointer the action's owner can move at any
time, so what runs in CI is whatever `v4` meant this morning. That is the whole mechanism behind
the supply-chain incidents of the last two years: an attacker with write access to a popular action
repoints a tag, and every workflow that trusts the tag runs the new code on its next run, with
whatever permissions the job has.

The jobs here are not high-value — `contents: read` for CI — but `release.yml` has
`id-token: write` and publishes to npm through trusted publishing (ADR 0039). An action that runs
in that job can mint a token for the registry. Pinning is cheap and the exposure is not theoretical.

There is a second, duller problem. Nothing tells anybody that a dependency has moved. The
dependency set is pinned by `package-lock.json` and nothing scans it, so a published advisory in a
transitive package sits unnoticed until somebody happens to run `npm audit`.

And a third, created by this repository's own recent work: ADR 0042 pins the visual reference
rasteriser to `mcr.microsoft.com/playwright:v1.62.1-noble` and states that the image tag and the
`playwright` devDependency "must move together: a mismatched image is a different Chromium, and a
different Chromium is a different rasteriser". That is a written requirement with nothing enforcing
it — and Dependabot will make it worse, because **it does not update `container:` image references
in workflow files**. It will happily raise `playwright` to a new version and leave the image behind,
at which point the reference-regeneration path breaks: the Playwright client from
`package-lock.json` refuses to drive the browsers baked into the older image.

## Decision Drivers

- What runs in a job with `id-token: write` must be identified by something its author cannot
  silently change.
- Pinning must not mean freezing. An unmaintained pin is how a repository ends up three years
  behind with no path forward.
- A pin must stay readable. A bare 40-character hex string tells a reviewer nothing about what
  version they are approving.
- A version advisory should arrive as a pull request, not as something someone remembers to check.
- Update noise has to stay proportionate to one maintainer. A separate pull request per package per
  week is how Dependabot gets turned off.
- The coupling ADR 0042 states in prose has to become mechanical before Dependabot has a chance to
  break it.

## Considered Options

- Digest pins with a version comment, plus Dependabot, plus a gate that proves the pinning
- Digest pins, no Dependabot
- Tags, plus Dependabot
- Leave it, and rely on review

## Decision Outcome

Chosen option: "Digest pins with a version comment, plus Dependabot, plus a gate that proves the
pinning", because pinning without an updater rots, updating without pinning does not remove the
exposure, and neither of them notices the one coupling this repository has already written down.

**Every `uses:` is a commit SHA with the version in a trailing comment:**

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
```

The comment is not decoration. Dependabot reads it to know which version it is upgrading from, and
writes it back on update; a reviewer reads it to know what they are approving. A digest with no
comment is unreviewable, and Dependabot treats it as an opaque pin.

Actions are pinned at the **v4 line they currently use**, not raised to the current majors
(`checkout@v7`, `setup-node@v7`, `cache@v6`). Pinning and upgrading are two changes, and doing both
at once means a CI failure has two candidate causes. The majors arrive as Dependabot pull requests,
which is what an updater is for.

**Dependabot runs weekly on two ecosystems**, `npm` and `github-actions`, with updates grouped so
one week produces at most a few pull requests rather than a dozen. Patch and minor updates are
grouped together per ecosystem; majors come separately, because a major is a decision and a group
hides it.

**`npm run check:ci-pins` is the gate.** It fails when any `uses:` is not a full 40-character SHA,
when a pin carries no version comment, and — the part that exists because of ADR 0042 — when the
Playwright container image tag disagrees with the `playwright` version in `devDependencies`. The
prose requirement becomes a build failure, and it fails on the Dependabot pull request that would
have broken it, which is the only moment the failure is cheap.

### Consequences

- Good, because a job with `id-token: write` now runs code identified by content, not by a label
  its author controls.
- Good, because the ADR 0042 coupling is enforced where it was previously only asserted, and the
  enforcement fires on exactly the pull request that would have broken it.
- Good, because advisories arrive as reviewable pull requests with a changelog attached, instead of
  being discovered by running `npm audit` on a hunch.
- Neutral, because a weekly cadence with grouping is a guess at the right volume for one
  maintainer, and may need tuning once real traffic exists.
- Bad, because updating an action is now a two-part edit — SHA and comment — and doing it by hand is
  easy to get half right. The gate catches the half that is checkable; it cannot catch a comment
  that names the wrong version.
- Bad, because the container image is still updated by hand. Dependabot does not touch
  `container:`, so a Playwright bump means editing the tag in two files, and the gate is what makes
  that a failure rather than a surprise.
- Bad, because adopting Dependabot required narrowing one rule of ADR 0036. Dependabot's subject is
  the fixed string `Bump X from A to B` — capital included, with no setting to change it — and the
  `subject-style` rule rejects a capitalised description. Every one of its pull requests arrived
  red the moment this landed, on something nobody could fix.

  The capital check is therefore skipped for the `deps` scope, and only there. The rule exists so
  generated changelog entries read consistently, and `deps` commits are `build` or `ci`, neither of
  which produces a changelog section at all — so the reason for the rule does not apply to the
  commits being exempted. A `deps` subject must still name a real type and still may not end in a
  period. The alternative was leaving every dependency bump red, which teaches everyone that a red
  `quality` is normal, and that is how a gate stops being read.

### Confirmation

`npm run check:ci-pins` (`scripts/check-ci-pins.mjs`), registered in the ADR 0033 harness and
reached by `check:all`:

- `unpinned-action` — a `uses:` naming a tag or branch rather than a 40-character SHA. Fails.
- `undocumented-pin` — a SHA with no `# vX.Y.Z` comment after it. Fails, because a pin nobody can
  read is a pin nobody will review.
- `action-inconsistent` — one action pinned to two different digests across the workflow set, or
  to one digest under two different version comments. Fails.
- `image-drift` — the Playwright image tag in `.github/workflows/ci.yml` or in the
  `test:visual:update` script disagrees with `devDependencies.playwright`. Fails.
- `image-inconsistent` — the two places that name the image disagree with each other. Fails.

`action-inconsistent` was added after the first Dependabot majors arrived, because the rules above
it are all per-line and therefore blind to it. Dependabot computes a bump against the usages that
exist when it raises the pull request; a `main` that grows a job under an open branch leaves that
branch incomplete, and the usages it missed are still SHAs with honest version comments — legal
under every other rule here. `actions/checkout` running at v4 in one job and v7 in the next is not
a supply-chain hole so much as a quiet lie about what CI is, and it is exactly the state this
repository was one rebase away from: three action majors were open against a tree with four
`checkout` usages, and `main` had six by the time they were looked at.

It is the action-level twin of `image-inconsistent` and is justified the same way — when one name
resolves to two things, at most one of them is the thing anybody reviewed.

**What is still not confirmed:** that a version comment tells the truth about its SHA. Every rule
here is offline and reads only the repository, so a pin written as `@<sha-of-v4> # v7.0.1` passes
all of them. Resolving the tag needs the network and an external system, which would make this the
second gate in the class ADR 0044 had to argue for. It is left out because Dependabot is what
writes these pairs in practice, and a bump it did not write is a hand-edit that a reviewer is
looking at anyway. The six pairs in the tree were verified against the GitHub API by hand when the
majors landed; nothing keeps them verified.

Local actions (`./.github/actions/…`) are exempt, since they are this repository's own code and are
already pinned by being in the commit. There are none today; the exemption exists so adding one
does not require editing the gate.

`--self-test` plants a violator for each rule per ADR 0033.

## Pros and Cons of the Options

### Digest pins with a version comment, plus Dependabot, plus a gate

- Good, because the three parts cover each other's failure modes: the pin removes the exposure, the
  updater stops the pin rotting, and the gate stops either being half-applied.
- Good, because it is the arrangement GitHub's own hardening guidance describes, so a contributor
  meets nothing unfamiliar.
- Neutral, because it is one more gate and one more config file to keep true.
- Bad, because Dependabot pull requests need triage, and an ignored Dependabot is worse than none —
  it produces a wall of stale pull requests that trains everyone to ignore the tab.

### Digest pins, no Dependabot

- Good, because it removes the exposure with no ongoing pull-request volume at all.
- Bad, because a pin with no updater is a pin that ages. Within a year the actions are old enough
  that upgrading is a project rather than a review.
- Bad, because nothing surfaces advisories, which is half of what this record is for.

### Tags, plus Dependabot

- Good, because Dependabot keeps tags current and the diff is legible — `v4` to `v5` reads better
  than one hex string to another.
- Bad, because it leaves the exposure exactly where it is. The point of pinning is that a tag can
  be repointed between the review and the run, and no update cadence changes that.

### Leave it, and rely on review

- Good, because it costs nothing and the blast radius of this particular repository is small today.
- Bad, because it stays small only until the first release, after which a compromised action in
  `release.yml` can publish to npm as this project.
- Bad, because the ADR 0042 coupling then remains prose, and prose is what this repository has
  repeatedly found to be untrue when nothing checks it.

## More Information

Makes the coupling ADR 0042 states enforceable, and hardens the job ADR 0039 gives
`id-token: write`. Related: ADR 0033 (why the gate self-tests), ADR 0004 (the toolchain versions
the npm ecosystem tracks).

GitHub's hardening guidance for third-party actions:
<https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>.
Dependabot does not update `container:` images in workflow files — see
<https://github.com/dependabot/dependabot-core/issues/5819> — which is why `image-drift` is a rule
here rather than something the updater would have handled.
