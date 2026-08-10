---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0032. Accessibility gate: axe at WCAG 2.2 AA, failing not advisory

## Context and Problem Statement

The source codebase carried a convention of writing no ARIA attributes by hand. That convention was correct in its original setting: PrimeReact supplied roles, labelling and focus semantics, and hand-written ARIA on top of it produced duplicate or contradicting announcements. Nerey deliberately does not carry it forward, and ADR 0022 explains why — Base UI is wrapped and never re-exported, so it covers only the chrome that needs focus trapping, roving tabindex, typeahead or scroll lock. Everything without that kind of behaviour is Nerey's own markup: the confirmation widget's buttons, the disabled and locked surfaces, the streaming placeholder, the fallback text container. For all of it, accessibility is now something this project produces rather than inherits.

That inverts the enforcement question. When correctness arrives from a component library, an accessibility panel is a reasonable place to notice regressions. When a headless library emits the interactive DOM itself, and its explicit contract is that consumers style it from the outside via `data-nerey-*` attributes (ADR 0020) without touching markup, a defect in that markup is shipped to every consumer with no layer left to fix it. The states most likely to be wrong are also the ones least likely to be inspected: `data-state="locked"` and `data-readonly` are set by the lifecycle runtime (ADR 0018) after an interaction, `status="streaming"` (ADR 0019) exists only mid-stream, and both are visually obvious while being trivially inaudible.

So: is accessibility checking a panel a developer may consult, or a gate that fails the build — and if it is a gate, against exactly which rule set?

## Decision Drivers

* ADR 0022's consequence: nothing upstream supplies accessibility for free, and the DOM in question is Nerey's, not a consumer's.
* Visual state and programmatic state must not diverge. `data-state` and `data-readonly` drive appearance (ADR 0020); a widget that looks locked and is still operable by keyboard is a correctness bug, and it is the specific bug FR-20 says must never re-enable a reply.
* WCAG 2.2 AA is the procurement baseline for the consumers this library targets; shipping to 2.1 means shipping a known gap in target size, focus appearance and dragging alternatives.
* Advisory tooling accumulates debt monotonically. A warning that has been present for six sprints is indistinguishable from a warning nobody will ever fix.
* ADR 0031 already runs every story in a real browser after its `play` function, which is precisely the post-interaction DOM where the locked and expired states exist.
* Rule sets drift. axe-core's default rule selection changes between releases; an unpinned configuration means a patch bump silently alters what "passing" means, in either direction.

## Considered Options

* `@storybook/addon-a11y` with `test: 'error'` and an explicitly pinned axe tag set, running inside the Storybook Vitest project
* `@storybook/addon-a11y` in advisory mode (panel plus `test: 'todo'`), with accessibility handled in code review and a periodic manual audit
* A separate axe pass in CI over the built `storybook-static`, via `@axe-core/cli` or an axe-Playwright runner, decoupled from the test run

## Decision Outcome

Chosen option: "`@storybook/addon-a11y` with `test: 'error'` and an explicitly pinned axe tag set, running inside the Storybook Vitest project", because it is the only option that audits the DOM as it exists *after* the `play` function — the submitting, locked and expired states — and the only one where a violation stops a merge in the same command that already runs the tests.

Concretely:

* `parameters.a11y.test = 'error'` in `.storybook/preview.ts`. A violation is a failed test, not a panel entry.
* The tag set is pinned to exactly `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']`, passed as axe's `runOnly: { type: 'tag', values: [...] }`. Pinning is not conservatism about new rules — it is the requirement that a change in what this project considers a defect arrives as a reviewed diff to one line of configuration, with the resulting failures fixed in that same change, rather than as a red build on an unrelated dependency bump. Best-practice and experimental axe tags are excluded on purpose: they encode opinions, and an opinion that fails a build needs to have been agreed to.
* Opt-outs exist, are per-story, and are narrow. Disabling the accessibility test for a whole story is forbidden outright; only individual rule ids may be disabled, via `parameters.a11y.config.rules`, and every disabled id must have a matching entry in a `nereyA11yWaivers` parameter carrying `rule`, a non-empty `reason` and an `expires` date. Waivers at the preview (global) level are forbidden in all forms — a global waiver is how a rule set silently becomes a smaller rule set.
* The audit runs on the post-`play` DOM. This is the whole reason the gate lives in the story runner: the interesting accessibility surface of this library is not the idle render, it is the moment a widget commits and locks.

The rule that most frequently earns its keep here is the one connecting the two ADRs: a locked widget styled through `data-state="locked"` and `data-readonly` must also carry `aria-disabled` (or a real `disabled` attribute) and must not be reachable as an operable control. That is exactly the class of divergence between "looks done" and "is done" that killed the no-ARIA convention when PrimeReact stopped supplying the other half.

### Consequences

* Good, because the accessibility contract is enforced on the same DOM a consumer receives, including the states that only a `play` function can reach.
* Good, because it costs no new infrastructure: ADR 0031's runner, ADR 0006's project structure and ADR 0007's coverage report are already in place, and this is a parameter plus one gate script.
* Good, because the waiver mechanism produces an auditable list. "Which rules are we currently not honouring, why, and until when" is answerable by grepping one parameter name.
* Good, because it forces the ARIA work to be done at the point where a widget is authored — the story is written to reach the locked state anyway (ADR 0031), so the audit of that state is free.
* Neutral, because axe adds runtime to the Storybook test project proportional to story count. At the scale of two built-in widgets in core (ADR 0035) plus the theme's reference widgets, this is not currently a constraint worth optimising.
* Bad, because a WCAG 2.2 AA gate will occasionally block work on a rule that is genuinely not applicable to a component rendered in isolation — colour contrast against a transparent Storybook background is the classic case. The waiver mechanism exists for that, and every use of it is a small tax.
* Bad, because passing axe is a floor, not a ceiling, and a green gate invites the belief that accessibility is handled. The manual residue below is not optional.

### Confirmation

* **`npm test`** runs the Storybook project (ADR 0006, ADR 0031); with `a11y.test = 'error'` every story fails on any violation at the pinned tag set, evaluated after `play` completes. This is the primary fitness function and it is the same command CI already runs.
* **`npm run check:a11y`** (`scripts/check-a11y-waivers.mjs`, appended to the `check:all` chain) parses `.storybook/preview.ts` and every `*.stories.tsx` and fails on: a tag set that is not exactly the five pinned values; `a11y.test` set to anything other than `'error'` at the preview level; any story-level `a11y.test` override; any `a11y.config.rules` entry at preview level; any disabled rule id without a matching `nereyA11yWaivers` entry; any waiver with an empty `reason` or an `expires` date in the past.
* **Widget-level assertions.** Announcement correctness that axe cannot judge is asserted directly in the widget's own test file: that committing the confirmation widget sets `aria-disabled="true"` alongside `data-state="locked"`, that the streaming placeholder is announced through a polite live region and the terminal state is not re-announced on replay (FR-24), and that the fallback container from the degradation chain (ADR 0012) is readable text rather than a decorative node. These are machine-checkable and belong to the widget, not to axe.
* **Gate self-test** per ADR 0033: `scripts/check-a11y-waivers.mjs` ships planted violators — an unpinned tag list, a story-level `test: 'off'`, a rule disabled with no waiver, an expired waiver — and its own test asserts a non-zero exit for each. Separately, a fixture story rendering a control with no accessible name asserts that the Storybook runner itself fails, which proves `test: 'error'` is actually wired and not silently defaulting to advisory.

Manual review remains for the judgement-dependent criteria no automated rule covers: whether focus order through a widget's controls is logical, whether an announcement fires at a moment that is useful rather than merely present, and whether the copy read aloud makes sense out of visual context. That last one has a hard constraint from the UX specification — reasoning and status surfaces describe activity and must never be framed as explanation of the model. A screen-reader pass over the confirmation widget's full interact → lock → replay sequence is a per-release manual step, documented as such because no assertion can stand in for it.

## Pros and Cons of the Options

### `@storybook/addon-a11y` with `test: 'error'` and an explicitly pinned axe tag set, running inside the Storybook Vitest project

* Good, because it audits the post-`play` DOM, which is the only way the locked, submitting and expired states are ever inspected automatically.
* Good, because failures land in the existing test command, in the same feedback loop and the same reporter as everything else — no separate CI job to be skipped when it gets slow.
* Good, because per-story parameters give exactly the granularity waivers need: one rule, one story, one stated reason.
* Good, because pinning the tag set turns "what do we consider a defect" into a reviewable one-line diff.
* Neutral, because it couples the accessibility gate to the story corpus: a component with no story is a component with no audit. ADR 0031's colocation and gate make that a visible omission rather than a silent one.
* Bad, because axe runs per story, so the wall-clock cost scales with the matrix of states rather than with the number of components.
* Bad, because component-in-isolation rendering produces some structurally false positives (heading order, landmark containment, contrast against no background), each of which has to be adjudicated once and waived with a reason.

### `@storybook/addon-a11y` in advisory mode (panel plus `test: 'todo'`), with accessibility handled in code review and a periodic manual audit

* Good, because it is zero friction to adopt and never blocks a merge.
* Good, because the panel still shows a developer the violations if they choose to look.
* Neutral, because the configuration is nearly identical to the chosen option — the difference is one parameter value, which is precisely what makes advisory mode tempting and hollow.
* Bad, because it enforces nothing. The violations this library is most likely to ship are in states a reviewer does not open, and a reviewer who does not open the story cannot see the panel for it.
* Bad, because a periodic audit against a released library is discovered too late: the `data-*` contract is public (ADR 0020) and consumers style against the DOM shape, so fixing markup after release risks being a breaking change under ADR 0029's versioning.
* Bad, because it leaves ADR 0022's central claim — that this project now owns accessibility outright — with no mechanism behind it.

### A separate axe pass in CI over the built `storybook-static`, via `@axe-core/cli` or an axe-Playwright runner, decoupled from the test run

* Good, because it audits the same artefact that gets published as documentation, in a real browser at full page scale, and can catch page-level issues that per-story rendering cannot.
* Good, because it is independent of Storybook's addon and test integration, so it survives changes to either.
* Neutral, because it can share the pinned tag set; the WCAG 2.2 AA target itself is not what distinguishes these options.
* Bad, because it sees only each story's initial render. A confirmation widget's locked state is unreachable without executing the `play` function, so the states this decision exists to protect would go unaudited — the single disqualifying fact.
* Bad, because it requires a full Storybook build before it can run, moving the feedback from seconds during development to minutes in CI.
* Bad, because waivers become a URL or selector allowlist in a config file, detached from the story they describe, and such lists go stale without anyone noticing.
* Bad, because it introduces a second browser toolchain alongside the Vitest browser mode already chosen in ADR 0006, with its own version skew and its own flakiness budget.

## More Information

This record is the enforcement half of the note in the requirements' technical context: the no-ARIA convention is deliberately not carried in, because it was correct only while PrimeReact supplied ARIA for free. ADR 0022 removes that supply by wrapping Base UI narrowly and keeping everything behaviour-free as Nerey's own markup; without an automated gate, that pair of decisions would have removed the source of correctness and put nothing in its place.

Related records: ADR 0031 provides the story corpus and the `play` functions this gate audits; ADR 0006 provides the browser-mode project it runs in; ADR 0020 defines the `data-state` / `data-readonly` attributes whose programmatic counterparts are being checked; ADR 0018 drives those attributes from the lifecycle runtime; ADR 0019 defines the streaming status that needs a live region; ADR 0033 requires the waiver gate to prove itself against planted violators; ADR 0034 runs it at edit time on story files.

Revisit when WCAG 2.3 reaches recommendation, or if the waiver list grows past a handful of entries — a long waiver list means the rule set and the component design disagree, and the correct response is to fix the components or to change the pinned set deliberately, not to keep filing exceptions.
