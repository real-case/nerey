---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0029. Semantic versioning for published packages

## Context and Problem Statement

`@nerey/core`, `@nerey/theme` and `@nerey/eslint-config` are published to npm and versioned independently (ADR 0002). Consumers will pin them with caret ranges, because that is what npm writes by default, which makes the version number a machine-consumed promise about what a minor upgrade can do to their build.

The complication is that Nerey's public surface is not the usual one. For an ordinary React library, "public API" means the named exports and their types, and TypeScript catches a violation of that promise at compile time in the consumer's own build. Nerey has deliberately promoted two further surfaces to API status:

* ADR 0020 makes `data-nerey-widget`, `data-nerey-part`, `data-nerey-slot`, `data-state` and `data-readonly` the public styling API. FR-26 and AC-14 require a consumer to style every widget state from their own `.module.css` using only those attributes, with no class-name knowledge and no wrapper components. That is the entire point of the headless split.
* ADR 0024 makes the `--nerey-*` custom properties the theming API. FR-30 and AC-17 require a full rebrand by redeclaring custom properties alone, with no component override and no `!important`.

Both surfaces are consumed from CSS. Rename `data-nerey-part="option"` to `data-nerey-part="choice"`, or `--nerey-color-accent` to `--nerey-accent`, and the consumer gets no type error, no runtime exception, and no build failure — just a selector that stops matching and a component that renders unstyled or with a default fallback colour. The failure is silent, visual, and discovered in production.

So the question is not whether to use semantic versioning. It is what "public API" means for these packages, and whether a change confined to CSS-facing names is a breaking change or an implementation detail.

## Decision Drivers

* A consumer must be able to accept a MINOR or PATCH upgrade without visual regression, not merely without a compile error.
* The surfaces that break silently are exactly the ones the architecture deliberately exposed; treating them as internal would nullify the guarantee that justified the headless split.
* The bump decision must be mechanically verifiable, because a surface with hundreds of attribute values and token names cannot be diffed reliably by eye.
* Independent versioning means three separate answers per release, so the rules must be per-package and unambiguous about which package a change moves.
* `@nerey/eslint-config` is a published package whose output is other people's build failures, which gives "breaking" a different shape there than in a runtime library.
* Pre-1.0 development must not become an excuse to break consumers without saying so.

## Considered Options

* SemVer 2.0.0 per package, with the public API defined to include the styling-attribute contract and the token names
* SemVer 2.0.0 per package, with the public API defined as the TypeScript export surface only, treating attributes and token names as implementation detail
* Lockstep versioning across all three packages, on a calendar scheme, with a written migration guide per release

## Decision Outcome

Chosen option: "SemVer 2.0.0 per package, with the public API defined to include the styling-attribute contract and the token names", because the styling and token surfaces are public by construction — ADR 0020 and ADR 0024 exist precisely to make consumers depend on them — and a versioning contract that excludes the parts of the surface that break silently promises nothing where the promise is most needed.

**The public API of a published Nerey package is:**

1. Every named export reachable through a subpath declared in `exports` (ADR 0028), together with its type signature. Anything not reachable through a declared subpath is internal, which is what makes the deep-import ban in ADR 0028 load-bearing here.
2. Every `data-nerey-*` attribute name, every `data-nerey-part` value, and every `data-state` value emitted by a shipped component or primitive, as locked by the ADR 0020 contract snapshot.
3. Every `--nerey-*` custom property name read by `theme.css`, together with its documented inline fallback semantics (ADR 0024). The token *values* are not API; the names and the fallback guarantee are.
4. For `@nerey/eslint-config`: the exported config entry points, the rule identifiers they enable, and the documented failure message for each restriction (AC-8).

**MAJOR** — removing or renaming anything in 1 through 4; narrowing a parameter type or widening a return type on an exported signature; removing a shipped widget (ADR 0035); changing exact `type@version` resolution semantics (ADR 0009); dropping a `data-state` value a component previously emitted; removing a token or removing its inline fallback; raising the `react` peer range floor or the `engines.node` floor (ADR 0004); and, for `@nerey/eslint-config`, adding a restriction that fails code which previously passed, since a shared lint config's minor upgrade must never turn a green build red.

**MINOR** — new exports, new `exports` subpaths, new optional fields on a registry entry, new tokens that ship with fallbacks, new opt-in config entry points, and **new `data-state` values**. The last is a MINOR only because ADR 0020's contract requires the attribute surface to be additive-safe: a component's base presentation must not be keyed on the *absence* of a state, and an unrecognised `data-state` must render as the base presentation. A consumer who wrote an exhaustive state selector set is not broken by a new state; they are un-styled for one new state and legible throughout. That property is a design obligation on core, not an assumption about consumers, and it is what makes state-machine evolution possible without a MAJOR per state.

**PATCH** — behaviour-preserving fixes, internal refactors, token *value* corrections, and dependency bumps that do not change the emitted DOM. Base UI is wrapped and never re-exported (ADR 0022) specifically so that its own MAJOR bumps can be absorbed as our PATCH, provided the DOM and the attribute contract are unchanged; if a Base UI upgrade changes emitted markup, that surfaces through the ADR 0020 snapshot and is our MAJOR.

**Pre-1.0.** The packages ship `0.x` through the extraction. The same classification applies, shifted one place: a MAJOR-class change bumps MINOR on `0.x`, and MINOR and PATCH classes both bump PATCH. The `!` marker on the commit (ADR 0036) is still mandatory — the shift is in the arithmetic the release performs, never in whether the break is declared. `1.0.0` is cut when AC-23 passes: `osint-chat-client` running on the published packages with the poll widget's existing acceptance criteria unchanged.

### Consequences

* Good, because a consumer who styles Nerey from their own CSS Modules — the intended default per the requirements, not the exception — gets the same upgrade safety as a consumer who only calls the TypeScript API.
* Good, because the three surfaces each acquire a snapshot artifact, which makes the API reviewable as a diff. A rename shows up as a removal plus an addition in a committed file, in the PR, before publication.
* Good, because the additive-safety rule for `data-state` converts an open-ended versioning problem into a design constraint on core that can be tested once and relied on thereafter.
* Good, because wrapping Base UI (ADR 0022) pays off concretely: its major upgrades are ours to absorb, and the snapshot tells us when they cannot be.
* Bad, because the MAJOR surface is much wider than for a comparable library, so Nerey will cut major versions more often than a library whose only contract is its exports. Renaming a `data-nerey-part` value for clarity is now a release event, which is a real deterrent to cosmetic improvement.
* Bad, because the attribute and token surfaces need review discipline early. Names chosen carelessly before 1.0 are cheap to fix and expensive afterwards, which front-loads naming work that would otherwise be deferred.
* Bad, because `@nerey/eslint-config` can effectively never tighten a rule in a minor release, so useful new restrictions queue up behind major versions or ship as opt-in entry points that most consumers will not enable.
* Neutral, because independent versioning means the three packages drift apart numerically and consumers cannot infer compatibility from matching version numbers. The `peerDependencies` range on `@nerey/theme` states the compatible `@nerey/core` range explicitly, which is the only reliable signal.

### Confirmation

`npm run check:public-api` (`scripts/check-public-api.mjs`) is the release gate. It builds all three surfaces into committed snapshots under `api/` and compares the working tree against the snapshot for the last published version of each package:

* Exports and signatures via API Extractor, into `api/<package>.api.md`.
* The attribute surface into `api/<package>.attributes.json`, generated from the ADR 0020 contract test output rather than from a separate scan, so the gate and the test cannot disagree.
* Token names and their fallback presence into `api/theme.tokens.json`, generated from the token source (ADR 0024).
* The `@nerey/eslint-config` rule set and messages into `api/eslint-config.rules.json`.

Any removal or rename between snapshot and working tree fails the gate unless the release range contains a commit carrying the `!` breaking marker for that scope (ADR 0036). That is the two-signal design: the author declares the bump, the gate derives it, and disagreement blocks the release.

Three supporting gates run continuously rather than only at release, each fixture-covered per ADR 0033:

* `npm run check:data-contract` — locks the emitted attribute surface (AC-14's snapshot).
* `npm run check:tokens` — locks token names and asserts every `var(--nerey-*)` reference carries an inline fallback, which is the FR-31 half of the contract that makes token *values* safe to change in a PATCH.
* `npm run check:exports` — asserts every public entry point is reachable through a declared subpath and that nothing else is (ADR 0028), which is what keeps definition 1 well-defined.

Packaging isolation (AC-1) is checked by `npm run check:core-purity` against the `npm pack` output rather than the source tree, because the promise is about the tarball.

What the gates cannot judge is whether a *behavioural* change is breaking. Reordering the degradation chain (ADR 0012), changing when a lifecycle rule fires (ADR 0018), or altering debounce timing in `useWidgetState` can break a consumer with an identical API surface, identical attributes and identical tokens. No snapshot detects that. It is manual review at release, informed by the acceptance criteria those records name, and it is the reason the release gate is a floor on the bump rather than the final word on it.

## Pros and Cons of the Options

### SemVer per package, public API includes the styling and token contracts

Three surfaces, three snapshots, one release gate.

* Good, because it makes the version number mean the same thing for both intended consumption modes — importing the API and styling the DOM — rather than covering only the one TypeScript happens to police.
* Good, because it is enforceable. Attribute values and token names are enumerable, so the gate is a set diff against a committed snapshot rather than a judgement.
* Good, because it puts pressure on naming at the right time: a name that is API gets argued about before 1.0, which is when arguing is cheap.
* Good, because it makes the headless promise credible. A library that tells consumers to depend on its data attributes and then reserves the right to rename them in a patch has not actually offered a contract.
* Neutral, because it costs three generated snapshots and an API Extractor step in the release pipeline. Real setup work, no ongoing cost once wired.
* Bad, because major versions come more often, and each one costs consumers a migration read even when the change was cosmetic.
* Bad, because the snapshots must be regenerated and reviewed on every intentional change, and a large regeneration diff invites rubber-stamping, which is the failure mode this gate is most exposed to.

### SemVer per package, public API is the TypeScript export surface only

The conventional reading, shipped by most component libraries: exports are contract, DOM and CSS variables are implementation.

* Good, because it is simple, universally understood, and needs no custom tooling — API Extractor alone covers it.
* Good, because it leaves internal markup and naming free to evolve, which keeps refactoring cheap and major versions rare.
* Good, because it matches consumer expectations formed by every other React library, so nothing has to be explained.
* Neutral, because it would be the right answer for a library that ships its own styles and treats its DOM as private. Nerey is not that library, by explicit design.
* Bad, because it contradicts ADR 0020 and ADR 0024 directly. Those records tell consumers to write selectors against the attribute surface and to theme through the token names; declaring those same names non-API means the documented integration path has no versioning protection at all.
* Bad, because the breakage it permits is silent and visual. A consumer's CI stays green, their types compile, and their UI renders wrong — the worst possible failure profile for a dependency upgrade.
* Bad, because it would push consumers toward defensive pinning of exact versions, which forfeits the benefit of semantic ranges entirely.

### Lockstep calendar versioning across all three packages

One version number for the repository, bumped on a date scheme, with a migration guide per release.

* Good, because compatibility between the packages is obvious from the number: matching versions are known to work together, and no peer range needs reading.
* Good, because it removes the per-change bump judgement entirely; the release date decides the number.
* Good, because the migration guide, being mandatory per release, tends to be better written than generated release notes.
* Neutral, because it is a reasonable fit for applications and for tightly coupled suites released together. Nerey's packages are deliberately not coupled — a consumer taking core alone and writing their own CSS is the documented default path.
* Bad, because it conveys no upgrade-risk information. A consumer cannot tell a bug fix from a rename without reading prose, which defeats automated dependency updates and range-based resolution.
* Bad, because it forces a version bump on `@nerey/core` whenever `@nerey/theme` releases, which contradicts the independence FR-1 exists to establish and makes core look churn-heavy to anyone evaluating it.
* Bad, because the migration guide is the only safety mechanism, and it is prose written by the person least likely to notice what they changed by accident.

## More Information

Specification: <https://semver.org/spec/v2.0.0.html>. The surfaces this record calls public are defined in `docs/requirements.md` at FR-26 and FR-30, and locked by AC-14 and AC-17.

The bump is declared by the commit contract in ADR 0036 and verified against the API snapshots by `check:public-api`; ADR 0028 is what makes the export surface enumerable in the first place; ADR 0022 is why a Base UI major upgrade is normally a PATCH here; ADR 0035 is why removing a built-in widget is a MAJOR rather than a catalogue change; ADR 0004 covers the runtime floors. All three continuous gates are fixture-covered under ADR 0033.

Revisit at the 1.0 cut, when the shifted pre-1.0 arithmetic stops applying, and again if the token surface grows past the point where a full snapshot diff can be reviewed attentively — at that scale the token contract likely needs its own stability tiers (stable, experimental) rather than a single flat set where every name is equally binding.
