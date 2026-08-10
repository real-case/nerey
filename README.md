<div align="center">

# Nerey

**Headless generative UI for React — with the theme shipped separately.**

[`@nerey/core`](packages/core) · [`@nerey/theme`](packages/theme) · [`@nerey/eslint-config`](packages/eslint-config)

</div>

---

A model does not generate interface code. It picks a widget you already declared and fills in
its payload. Nerey is the part that turns that payload into a rendered, interactive,
persistable component.

The behaviour and the look are two packages on purpose. If you own a design system, a styled
component library is a tax you pay twice — once for someone else's CSS, again to override it.
Nerey's default is that you take the behaviour and write your own `.module.css` against a
documented `data-*` contract. `@nerey/theme` is the shortcut, not the path.

```bash
npm install @nerey/core          # behaviour, zero CSS
npm install @nerey/theme         # optional: the reference look
```

## What you get

**`@nerey/core`** — a widget registry keyed on exact `type@version`, a four-step degradation
chain, a lifecycle runtime that actually evaluates expiry rules, an injected persistence port,
three slot hosts, and a `data-*` styling contract that is public API. One runtime dependency,
and it is types-only.

**`@nerey/theme`** — a complete visual layer in CSS Modules, driven entirely by `--nerey-*`
custom properties, built on [Base UI](https://base-ui.com) for focus management, floating
positioning, keyboard navigation and ARIA. Compiled to a static stylesheet at publish time, so
you never configure CSS Modules for `node_modules`. Re-theme it by redeclaring custom
properties — no fork, no overrides, no `!important`.

**`@nerey/eslint-config`** — the architectural boundaries as lint rules, so the invariant that
widgets perform no I/O survives being copied into a new project.

## The design in one table

| Decision                                             | Why                                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The model parameterises **pre-declared** widgets     | What MCP Apps, Google A2UI and the Vercel AI SDK independently converged on. A model that cannot emit executable UI cannot emit malicious UI. |
| Resolution is an **exact** `type@version` match      | An implicit semver range fails silently: `poll@1.0.0` against a payload saying `"1.0"` looks exactly like a widget you forgot to register.    |
| Validation via **Standard Schema v1**                | Core depends on the spec, not on a validator. Bring Zod 4, Valibot or ArkType.                                                                |
| **Streaming payloads are never validated**           | A partial object fails a complete schema by definition, so validating mid-stream turns every stream into a fallback.                          |
| A widget's only outbound channel is `onInteraction`  | The host owns sending, optimistic insertion and error handling. That is what makes a widget portable between hosts.                           |
| A failed persist **does not roll back**              | By then the reply is in the transcript. Re-enabling the widget invites a duplicate.                                                           |
| Lifecycle rules are **evaluated**, not just declared | Widget lifecycle is the one area with no standard to copy — MCP Apps explicitly deferred it.                                                  |
| `data-*` attributes are the **public styling API**   | You style Nerey from your own CSS knowing no class names. Renaming one is a MAJOR bump.                                                       |
| The theme is **self-sufficient in the cascade**      | It never relies on an inherited reset, so removing Tailwind's Preflight does not break every component at once.                               |

Each of these is recorded as an ADR under [`docs/decisions/`](docs/decisions), with the options
that were considered and rejected.

## Repository

```
packages/core            @nerey/core — headless runtime
packages/theme           @nerey/theme — CSS Modules theme on Base UI
packages/eslint-config   @nerey/eslint-config — the boundaries as lint rules
.storybook               the component workbench (loads tokens.css and nothing else)
docs/decisions           37 MADR architecture decision records
docs/design-system       generated token reference + committed contract baselines
docs/requirements.md     the functional requirement this implements
scripts                  deterministic gates, each self-testing
```

### Working on it

```bash
npm install
npm run storybook        # the workbench
npm test                 # unit (jsdom) + stories (real browser, with axe)
npm run check:all        # every gate
```

Node 24, npm workspaces. `npm run gen:tokens` after touching `tokens.css`;
`npm run gen:css-types` after adding a CSS Module class. CI drift-checks both.

### How the guardrails work

The approach is borrowed from
[real-case/claude-code-nextjs-starter](https://github.com/real-case/claude-code-nextjs-starter):
decisions are recorded before code depends on them, and every rule that matters is
machine-checkable rather than written down and hoped for.

- **ADRs first.** 37 records, each naming a fitness function in its `Confirmation` section.
- **Gates, not conventions.** `scripts/check-*.mjs` enforce token usage, core purity, the
  `data-*` contract, story coverage, the public API surface, the exports map and commit format.
- **Gates that test themselves.** `npm run check:gates` plants a violator for every rule and
  fails if the rule does not reject it. A gate that silently stopped firing is worse than no
  gate, because it is a green check over a real violation.
- **Edit-time hooks.** A `PreToolUse` guard refuses edits to accepted ADRs, generated artifacts
  and contract baselines; a `PostToolUse` dispatcher runs the fast, file-scoped gates the moment
  a file is written — reusing the same binaries, so each rule has one implementation and two
  triggers.

## Status

`0.x`. The public API is the export surface, the `data-*` attribute vocabulary and the
`--nerey-*` token names — all three are versioned as public API under
[ADR 0029](docs/decisions/0029-semantic-versioning-published-packages.md).

MIT.
