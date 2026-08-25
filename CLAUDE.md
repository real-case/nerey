# CLAUDE.md

> **What this is.** Nerey is a headless generative-UI library for React, published as
> `@nerey/core` (behaviour, zero CSS), `@nerey/theme` (a CSS Modules + CSS-custom-property
> theme built on Base UI) and `@nerey/eslint-config` (the architectural boundaries, shipped as
> lint rules). The **Stack / Commands / Conventions / Restrictions** sections below are a
> summary of the **accepted** ADRs under `docs/decisions/`. Where this file and an ADR
> disagree, the ADR wins — this is a convenience index, not a second source of truth.

## ADR Process

Architectural decisions are recorded **before** any code depends on them.

- **Location:** `docs/decisions/`, `NNNN-kebab-case-title.md`. Numbers are permanent IDs.
- **Template:** MADR **full** template — `Context and Problem Statement`, `Decision Drivers`,
  `Considered Options` (at least two, and the rejected one must be the option a competent
  engineer would actually reach for), `Decision Outcome` (opening `Chosen option: "…", because
…`), `Consequences`, `Confirmation`, `Pros and Cons of the Options`, `More Information`.
  Canonical source: `.claude/skills/adr/assets/adr-template.md`.
- **Confirmation must name a machine-checkable fitness function** — an npm script, a lint rule,
  a test file, a gate under `scripts/`. "Manual review" is allowed only where nothing can be
  automated, and the record must say why.
- **Lifecycle:** `proposed → accepted`. An accepted record is **never edited in place**; it is
  replaced by a superseding record. A `PreToolUse` hook enforces this at write time.
- **Tooling** (`npm run adr -- <cmd>`, wrapping `.claude/skills/adr/scripts/adr.py`):
  `next` · `index` (regenerate `docs/decisions/README.md`) · `lint` · `accept NNNN` ·
  `supersede --old --new`.
- **Citations** are written bare — `ADR 0018` — so they are greppable. `npm run check:citations`
  fails on a number that does not resolve.
- The bootstrap corpus 0001–0037 was accepted in bulk by the repo owner on 2026-08-09, before
  any package contained code. The `proposed → accepted` transition first runs for real on 0038.

When a change needs a decision no ADR covers: record the ADR first, then implement.

## Stack

- **React 19** (peer `^19`), **TypeScript strict** + `noUncheckedIndexedAccess` +
  `noImplicitOverride`, `any` banned (0003).
- **Node 24**, **npm workspaces**; three published packages, `@nerey/core` never depends on
  `@nerey/theme` (0002, 0004).
- **Vite 8** library builds; declarations from `tsc --emitDeclarationOnly`. CSS Modules are
  compiled at build time into one static `theme.css` with hashed class names, because a
  consumer must never configure CSS Modules for `node_modules` (0023).
- **Standard Schema v1** for validation — core depends on the _spec_ (types only), so a
  consumer brings Zod 4, Valibot or ArkType (0011). `@nerey/theme` uses Zod 4 for its own
  widget schemas.
- **Base UI 1.7** (`@base-ui/react`) for behaviour — focus trap, floating positioning, roving
  tabindex, typeahead, scroll lock, ARIA. Wrapped, never re-exported (0022).
- **Vitest 4** — two projects: `unit` (jsdom, colocated tests) and `storybook` (real browser
  via `@storybook/addon-vitest` + Playwright). One merged coverage gate at 80% (0006, 0007).
- **Storybook 10** on `@storybook/react-vite`, CSF 3, colocated stories, `addon-a11y` running
  axe at WCAG 2.2 AA as a **failing** check (0031, 0032).
- **ESLint flat config + Prettier**; the repo lints itself with the boundary rules it publishes
  (0005, 0015).
- **Deterministic gates** under `scripts/`, each self-testing (0033); **Claude Code hooks**
  dispatch the fast ones at edit time (0034).

## Commands

- `npm run typecheck` · `npm run lint` · `npm run format:check`
- `npm test` — both Vitest projects; `npm run test:unit` — the fast jsdom loop;
  `npm run test:coverage` — merged, fails below 80%.
- `npm run storybook` — the workbench; `npm run build-storybook` — static build.
- `npm run build` — build every package (Vite + declarations).
- `npm run gen:tokens` — regenerate the token union, lint allowlist and agent-rules reference
  from `packages/theme/src/tokens.css`. **Run after every token change**; CI drift-checks it.
- `npm run gen:css-types` — regenerate the committed `*.module.css.d.ts` declarations. **Run
  after adding or renaming a class.**
- `npm run check:all` — every gate. `npm run check:gates` — the meta-harness that proves each
  gate still rejects its own violator.
- `npm run check:api-signatures` — diffs every exported symbol's rendered signature against
  `docs/design-system/api-signatures.json` (0038). `check:public-api` covers names, this covers
  shapes; a changed signature is a break both would otherwise pass. Re-bless with
  `-- --update-baseline`, never by editing the file.
- `npm run gen:release -- --package @nerey/core [--dry-run]` — prepare one package's release:
  derives the bump from the commit range, writes the manifest version and `CHANGELOG.md`, prints
  the tag commands. Writes files only — the tag publishes, and CI does the publishing (0039).
  Runbook: `docs/releasing.md`.
- `npm run adr -- lint` / `npm run adr -- index`.

## Conventions

**The generative-UI model (0008–0010, 0030)**

- The model **parameterises pre-declared widgets**; it never emits executable UI. This is the
  security spine and it is not negotiable.
- Registry lookup is an **exact match on `type@version`**. Registering `poll@1.0.0` against a
  payload carrying `"1.0"` silently never matches and falls back to text — the most common
  wiring bug in this design, and why exact-by-default is right.
- Registries are built by **explicit composition** (`createWidgetRegistry`,
  `composeRegistries`). No global mutable map, no `registerWidget()` at import time.
- What the model is told is **derived from the registry**, never retyped beside it:
  `describeRegistry(registry, { toJsonSchema })` emits `type`, `version`, `key`, `description` and
  the converted payload schema. The converter is injected — core depends on the Standard Schema
  spec, which has no conversion in it (0040). An entry's `description` is what a model chooses on.
- Evolve a widget's payload with `migrate` on the entry — a tolerant reader, applied on read,
  before validation.

**Contracts (0011–0016, 0019)**

- Validate through Standard Schema; never import a validator into `@nerey/core`.
- The degradation chain is: unknown `type@version` → invalid payload → component throw →
  no fallback configured. Every step renders something readable and emits a typed error.
- **A streaming payload is never validated.** A partial object fails a complete schema by
  definition, so validating it would turn every stream into a fallback.
- A widget's only outbound channel is `onInteraction(action, { text, meta })`; its only
  persistence channel is `useWidgetState`. Widgets perform **no I/O** — enforced by
  `@nerey/eslint-config`, which ships in the box precisely so the rule survives extraction.
- The message a widget sends must read like something a human typed. The agent consumes it as
  user input.
- **A failed persist does not roll back a committed widget.** By then the reply is already in
  the transcript, and re-enabling the widget invites a duplicate.

**Lifecycle and placement (0017, 0018)**

- Nerey **evaluates** `ExpiryRule`s and drives `readonly` from them. Declaring lifecycle types
  and evaluating nothing is what the origin implementation did; it is the gap this library
  exists to close.
- An acted-upon widget is **disabled, not removed**. `afterExpiry: 'snapshot'` re-renders the
  terminal state on reload without firing an effect.
- `OverlaySlotHost` does not portal. `scope: 'page'` would collide with a consumer's own portal
  and z-index layering, and no surveyed standard has a precedent to copy.

**Styling (0020, 0021, 0023–0027)**

- The `data-*` surface — `data-nerey-widget`, `data-nerey-part`, `data-nerey-slot`,
  `data-state`, `data-readonly` — is **public API**. Changing it is a MAJOR bump.
- Core primitives accept `className` and `render` (that layer exists to be styled from
  outside). Themed components accept `variant` / `size` / `tone` and **never** `className` —
  a className passthrough makes the theme unreplaceable.
- Every CSS value is `var(--nerey-token, <fallback>)`. **The fallback is mandatory**: a
  consumer who loads `theme.css` without `tokens.css` must still get a legible component.
- Components read the **semantic** token layer. The primitive ramps (`--nerey-color-*`) exist
  so the semantic layer has something to point at.
- Stylesheets are **self-sufficient**: they set their own `box-sizing`, margins, list markers
  and image display. Nerey ships no reset and assumes none exists.
- Light/dark is a token-value override responding to `prefers-color-scheme` and to
  `[data-nerey-theme]`, with the explicit attribute winning. A component never branches on
  theme.
- Class names are camelCase and describe the element's role, not its appearance.

**Testing and stories (0006, 0007, 0031, 0032)**

- Tests are colocated. Cover the failure branches — for most of this codebase they are the
  point.
- Every component and widget ships colocated CSF 3 stories with an explicit `title`.
  Interactive ones require a `play` function using `storybook/test` (not `@storybook/test`).
- Stories are deterministic: no `Date.now()`, no `Math.random()`, no network.
- Widget stories render through `WidgetRenderer` inside `MockWidgetHost`, not by calling the
  component directly — that is what proves the whole chain.

**Commits (0036)** — Conventional Commits. Scope vocabulary is computed from the workspaces
list, so it cannot drift. A `Refs: ADR NNNN` footer is checked.

## Restrictions

- `any` is banned; use `unknown` and narrow. The one sanctioned generic erasure is
  `asAnyWidget` (0003).
- No `console.*` in library code. Errors reach the consumer through `onWidgetError` — a library
  that logs shows up in someone else's error budget (0013).
- `@nerey/core` ships **zero CSS** and depends only on `@standard-schema/spec`. No validator,
  no markdown renderer, no HTTP client, no query library, no Base UI (0002, 0011, 0012, 0037).
- No transport, no LLM SDK binding, no MCP client, no iframe sandbox, no i18n, no charting —
  each is a documented adapter point, not a dependency (0037).
- Never `@apply` / `@tailwind` / `@reference` in a `*.module.css`. They cannot see a utility
  framework's theme from a separately bundled module (0023).
- Never a raw colour or size literal outside a `var()` fallback in a tokenizable property
  (0024).
- Never `ComponentProps<typeof Base.X>` — that leaks Base UI into Nerey's public type and makes
  it unswappable (0022).
- Never re-export Base UI. Never add a second behavioural primitive library: two focus traps
  and two Escape implementations are what users actually notice (0022).
- The "no ARIA attributes" convention carried over from the origin codebase is **deliberately
  not adopted**. It was correct when a styled library supplied ARIA for free, and is actively
  harmful for a headless library that emits interactive DOM (0022, 0032).
- Generated files are never hand-edited: `tokens.generated.ts`, `tokens.allowlist.json`,
  `docs/design-system/tokens.agent-rules.md`, `*.module.css.d.ts`, `docs/decisions/README.md`.
  A `PreToolUse` hook blocks it.
- Contract baselines (`docs/design-system/data-contract.json`, `public-api.json`,
  `api-signatures.json`) are updated **deliberately, in the same commit as the version bump** —
  never to make a check pass (0029, 0038). Each has an `--update-baseline` flag that prints what
  it blessed; a `PreToolUse` hook blocks editing them by hand.
- CSF 2 (`Template.bind({})`, `storiesOf`) fails lint. MDX never defines stories (0031).
- a11y opt-outs only as an explicit, reviewed per-story `a11y` parameter with a stated reason
  (0032).
- Accepted ADRs are never edited in place (0001).
