# Requirements: Nerey — headless Generative UI library with a separately shipped CSS Modules theme

## Overview

Extract the generative-UI kernel currently living in `osint-chat-client/src/shared/generative-ui/`
into **Nerey**, a standalone React library, and ship its visual layer as a **separate package** so
that adopting the behaviour never forces adopting the styling.

The system Nerey packages is a **registry-based** generative UI: the model never emits executable UI
code, it selects and parameterises a widget that the client has pre-declared. This is the pattern all
three 2024–2026 standards converged on independently — MCP Apps `ui://` resource templates, Google
A2UI's client-owned component catalog, and the Vercel AI SDK's tool→component bindings — so the
registry, not the renderer, is the load-bearing abstraction and the thing worth packaging.

Two packages, versioned independently:

- **`@nerey/core`** — headless. Registry, host contract, placement and lifecycle runtime, validation
  and degradation chain, persistence port, interaction contract, slot hosts, dev/mock layer. Ships
  **zero CSS** and has no opinion about markup beyond the DOM nodes it must own.
- **`@nerey/theme`** — the reference look. CSS Modules compiled at build time, driven entirely by a
  documented `--nerey-*` CSS custom-property surface. Optional, replaceable, and never imported by
  `@nerey/core`.

The split exists because a styled library is an anti-pattern for any consumer that owns a design
system: they pay for someone else's CSS, then pay again to override it. Nerey's default must be that
a consumer takes the behaviour and writes their own `.module.css` against a stable
data-attribute contract; taking `@nerey/theme` is the shortcut, not the path.

**Provenance.** Requirements below are grounded in three sources: the shipped implementation
(OSI-923 Phase 1, OSI-925 composed registry, OSI-2574 poll widget), the verified deep-research report
_Generative UI Components: Industry Standards & Best Practices (2024–2026)_, and the CSS Modules /
Base UI architecture decided for the chat redesign. Where the shipped code has a gap the report
flagged as unstandardised design space, it is called out as such rather than copied forward.

## Functional Requirements

### A. Packaging and boundaries

- FR-1: Publish `@nerey/core` and `@nerey/theme` as independently versioned ESM packages with bundled
  type declarations. `@nerey/core` must have **no dependency, direct or transitive, on `@nerey/theme`**,
  and must contain no `.css` file of any kind. Verified by a packaging test, not by convention.
- FR-2: Export via subpaths, not a mega-barrel: `@nerey/core`, `@nerey/core/mock`, `@nerey/theme`,
  `@nerey/theme/tokens.css`, `@nerey/theme/theme.css`. A single root barrel over the whole surface
  drags the client boundary and the full dependency list into every importing module.
- FR-3: `'use client'` is declared **inside the package**, on every module that uses React context,
  state, or effects — never delegated to the consumer. A consumer must be able to import Nerey from a
  React Server Component file without the directive spreading into their feature code.
- FR-4: Peer dependencies only: `react@^19`. `@nerey/core` must **not** depend on Zod, on a markdown
  renderer, on TanStack Query, on an HTTP client, or on any transport. Every one of these is a port
  (FR-11, FR-14, FR-16). The shipped implementation couples all four; decoupling them is the main
  extraction work.
- FR-5: Invert the app coupling. `adapter.ts`, `factory.tsx` and `MessageSlotHost` currently import
  `ApiChatMessageResponse` from `@/app/(dashboard)/chats/_lib/schemas/chat.schema`. Nerey defines its
  own minimal `NereyMessage` shape (`id`, `role`, `text`, `widget?`) and accepts a consumer-supplied
  `toNereyMessage` adapter at the host boundary. Domain names go with it: `chatId` → `conversationId`.

### B. Registry and widget contract

- FR-6: `createWidgetRegistry(entries)` builds an immutable registry keyed `` `${type}@${version}` ``,
  throwing `Duplicate widget registration: <key>` at construction time. `emptyRegistry` resolves every
  lookup to `undefined`. No global mutable registry, no `registerWidget` side-effect imports, no
  test-only reset hook — composition is explicit or it is not a library.
- FR-7: `composeRegistries(...registries)` merges Nerey's built-ins with consumer catalogs, so adding a
  widget is one line in the consumer's own catalog file and never a fork. Later registries win on key
  collision only when passed `{ override: true }`; otherwise a collision throws.
- FR-8: `defineWidget(entry)` is the authoring entry point and must preserve the `<P, S, E>` generics
  end-to-end, so a widget component's `payload`, `state` and reducer `event` are inferred, not asserted.
- FR-9: `WidgetRegistryEntry<P, S, E>` carries: `type`, `version`, `component`, `payloadSchema`,
  `stateSchema`, `placement`, `lifecycle`, and optional `reducer`, `updateStrategy`
  (`'optimistic' | 'pessimistic'`), `cancellable`, `migrate`.
- FR-10: Version resolution is **exact match on `type@version`**, with no implicit semver range. The
  poll widget shipped as `poll@1.0` precisely because the backend sends `"1.0"` and a registration as
  `"1.0.0"` would silently never match and fall back to text. Optional ranged resolution may be opted
  into per entry, never inferred.

### C. Validation, degradation, diagnostics

- FR-11: Payload and state validation goes through **Standard Schema v1**, so a consumer supplies Zod,
  Valibot or ArkType and `@nerey/core` depends on none of them. The schema keeps its documented dual
  role — prompt-side constraint for the model, runtime validation at the boundary.
- FR-12: Streamed partial payloads are **explicitly not validated**. Validation runs once the part
  reaches a terminal input state; before that the widget renders from partial data or from its
  loading branch (FR-21).
- FR-13: A four-step degradation chain, each step covered by its own test:
  1. unknown `type@version` → fallback renderer;
  2. payload fails schema validation → fallback renderer;
  3. component throws during render → error boundary → fallback renderer;
  4. no fallback renderer configured → `message.text` as plain text.
     Text-only fallback is a normative SHOULD in the MCP Apps specification; Nerey makes it
     unconditional.
- FR-14: The fallback renderer is **injected**, not bundled. `renderFallback: (text: string) => ReactNode`
  on the host value. `@nerey/core` must not ship `react-markdown`, `remark-gfm` or
  `rehype-external-links`; the current `markdown-fallback.tsx` moves out of core and becomes a
  documented recipe plus an optional `@nerey/fallback-markdown` adapter.
- FR-15: `onWidgetError(error)` receives a typed union — `UnknownWidgetError`, `InvalidPayloadError`,
  `WidgetRenderError`, `PersistenceError` — each carrying `type`, `version`, `messageId`. Nerey never
  logs to `console` on a consumer's behalf.

### D. Host and interaction contract

- FR-16: `WidgetHostProvider` supplies `{ registry, conversationId, sendUserMessage, persistence,
renderFallback, onWidgetError }` and `useWidgetHost()` returns a valid value with safe defaults when
  no provider is mounted, so widgets remain unit-testable in isolation.
- FR-17: `onInteraction(action, { text, meta? })` is the **only** outbound channel from a widget. The
  widget formulates the message; the host is the single place that knows about sending, optimistic
  insertion, thinking indicators and error handling. This mirrors the reverse contract both reference
  implementations settled on — `addToolOutput` + auto-resubmission in the AI SDK, host-mediated
  JSON-RPC in MCP Apps.
- FR-18: Widgets perform **no I/O**. Ship the boundary as a consumable ESLint config
  (`@nerey/eslint-config`) restricting imports of HTTP clients and app API modules inside a widgets
  directory — the rule that enforces this today lives in the app's `eslint.config.mjs` and does not
  travel with the extracted code.
- FR-19: `useWidgetState(messageId, initial)` provides optimistic update, debounced write, rollback on
  failure, and per-`messageId` isolation. Its transport is the injected `MessagePersistence` port
  (`updateWidgetState` / `getWidgetState`); `@nerey/core` ships an in-memory implementation and the
  TanStack-Query-backed one stays in the consumer.
- FR-20: A visual lock committed by a widget must be independent of persistence rollback. Once the
  reply is sent, a failed state write leaves the widget locked and surfaces `PersistenceError` — it
  must never re-enable and invite a duplicate reply.

### E. Placement, lifecycle, streaming

- FR-21: Widgets receive a `status` prop (`'streaming' | 'ready' | 'error'`) reflecting the four-state
  tool-part lifecycle the AI SDK standardised (`input-streaming` → `input-available` →
  `output-available` → `output-error`), so a widget can render a skeleton instead of the host
  guessing on its behalf.
- FR-22: `Placement` stays the discriminated union `{ slot: 'message' }` |
  `{ slot: 'input'; position?: 'above' | 'below' | 'replace' }` |
  `{ slot: 'overlay'; scope: 'chat' | 'page'; dismissible?: boolean }`, with all three slot hosts
  **actually implemented**. `InputSlotHost` and `OverlaySlotHost` are stubs today (a passthrough and a
  `return null`) — shipping them as stubs in a library is shipping a lie in the type signature.
- FR-23: Implement a lifecycle **runtime**, not just lifecycle types. `Lifecycle` declares
  `persist: 'forever' | 'ephemeral'`, `expiry: ExpiryRule[]`
  (`interact` / `interact+action` / `timeout` / `message` / `navigate` / `event`) and
  `afterExpiry: 'fallback' | 'hide' | 'snapshot'`. Nothing evaluates these rules today. Nerey must
  evaluate them and drive `readonly`. This is the deliberate core of the library: widget lifecycle is
  verifiably unstandardised — MCP Apps explicitly deferred widget-state persistence, and the OpenAI
  Apps SDK is the only system with a documented full contract. It is the one area where Nerey is not
  re-implementing a settled standard.
- FR-24: An acted-upon widget is **disabled, not removed**. `afterExpiry: 'snapshot'` renders the
  terminal state read-only; the transcript must stay legible on reload without re-firing any effect.
- FR-25: `migrate(fromVersion, payload)` on a registry entry converts historical payloads on read, so
  evolving a widget's contract does not break persisted messages. Schema versioning is the second gap
  the research pass found no primary-source practice for; a tolerant reader plus migration-on-read is
  the position Nerey takes and documents.

### F. The headless styling contract

- FR-26: Every DOM node Nerey owns carries stable, documented attributes: `data-nerey-widget="<type>"`,
  `data-nerey-part="<part>"`, `data-nerey-slot`, `data-state` (`idle` / `selected` / `submitting` /
  `locked` / `expired` / `error`), `data-readonly`. **This attribute surface is the public styling
  API** and is covered by contract tests — it is what lets a consumer style Nerey from their own CSS
  Modules with no class-name knowledge and no wrapper components.
- FR-27: Headless primitives in `@nerey/core` accept `className` and a polymorphic `render` prop. This
  is the layer whose entire purpose is being styled from outside; withholding the escape hatch here
  reproduces the `pt={{}}` problem one level down.
- FR-28: Interactive chrome that needs focus trapping, viewport-aware positioning, roving tabindex,
  typeahead, scroll lock or ARIA is built on **`@base-ui/react`**, wrapped and never re-exported, so
  the dependency stays swappable. Behaviour of that kind is expensive to write by hand and will be got
  wrong; everything without behaviour is Nerey's own markup.

### G. `@nerey/theme`

- FR-29: The theme is authored in CSS Modules — colocated `*.module.css`, camelCase class names, role-
  based naming, generated and committed `.d.ts` — and **compiled at build time** into a single plain
  `theme.css` with hashed class names. Consumers must not need to configure CSS Modules for
  `node_modules`; Next.js does not process them there by default.
- FR-30: `@nerey/theme/tokens.css` is a separate entry point declaring the entire `--nerey-*` surface
  and nothing else — no component rules, no reset, no `@import 'tailwindcss'`, no `@theme`, no
  `@apply`, no PrimeReact selectors. It is the file a Storybook preview loads on its own, which is
  what makes the workbench a truthful reference rather than an inheritor of the app's cascade.
- FR-31: Every declaration in `theme.css` reads its values through `var(--nerey-*, <fallback>)`. A
  consumer who imports `theme.css` without `tokens.css` gets a plain but correct component, never an
  unstyled or broken one.
- FR-32: The theme is **self-sufficient in the cascade**: it sets `box-sizing`, margins, list markers
  and image display on its own elements and must never rely on an inherited global reset. Nerey has no
  idea whether its consumer ships Preflight, `normalize.css`, or nothing — and a component that
  silently depends on the host's reset breaks on the day that reset is removed, everywhere at once.
- FR-33: Themed components expose `variant` / `size` / `tone`, **not** `className`. Per-instance
  deviation goes through CSS custom properties scoped to a container. A `className` on a themed
  component is passthrough styling of someone else's DOM under a new name, and it makes the theme
  unreplaceable — the exact failure the layer exists to prevent.
- FR-34: Ship light and dark. Token values respond to `prefers-color-scheme` **and** to an explicit
  `[data-nerey-theme="light" | "dark"]` override, with the explicit attribute winning in both
  directions.
- FR-35: Theming a Nerey app must be possible by redeclaring custom properties alone — no fork, no
  component override, no `!important`. That is the acceptance test for whether the token surface was
  factored correctly.

### H. Built-in widgets and the dev layer

- FR-36: `@nerey/core` ships exactly two built-in widgets: `text` (renders through the injected
  fallback renderer) and `confirmation` (the minimum interactive widget that exercises interaction,
  lifecycle and persistence end-to-end). `poll` ships as a reference widget in `@nerey/theme`, not in
  core — it is a design decision, not a primitive.
- FR-37: `@nerey/core/mock` ships the dev registry, fixture definitions, widget-command injection and
  in-memory persistence, so a consumer can build and demo a widget with no backend. This layer already
  exists in the shipped code and is a substantial part of what makes the system usable.
- FR-38: Ship a widget-authoring conformance test kit: given an entry, assert schema round-trip,
  fallback on invalid payload, no I/O imports, lifecycle transitions, and `data-*` contract stability.

### I. Non-goals (v1)

- FR-39 (negative): No transport. Nerey knows nothing about WebSocket, SSE, or polling. No LLM SDK
  binding, no MCP client, no iframe sandbox or `postMessage` bridge. No i18n layer — chrome strings are
  English and overridable. No markdown renderer. No charting. Each is a documented adapter point, and
  shipping any of them in v1 would make the package unadoptable by anyone whose stack differs by one
  choice.

## Technical Context

**Source of extraction** — `osint-chat-client/src/shared/generative-ui/`: `registry.ts`,
`registry.types.ts`, `widget-host.tsx`, `factory.tsx`, `adapter.ts`, `hosts/*`, `persistence/*`,
`mock/*`, `widgets/text`, `widgets/poll`, plus `__tests__/interaction-contract.test.tsx` which already
encodes the interaction narrowing as a compile-time assertion.

**Stack** — React 19 (React Compiler enabled: no manual `useMemo` / `useCallback` / `React.memo`
except for context-provider values), TypeScript with `noUncheckedIndexedAccess`, Vitest + React
Testing Library, `@base-ui/react` for behavioural primitives, `happy-css-modules` for the theme's
generated declarations. Build: library mode with CSS Modules compiled to a static stylesheet.

**Prior decisions carried in** — `open` / `defaultOpen` / `onOpenChange` as the state contract, since
it is the de-facto shared shape across Base UI, Radix, React Aria and Ark and makes a future primitive
swap mechanical. Props declared explicitly rather than derived via `ComponentProps<typeof Base.X>`,
which would leak the dependency into the public type. Compound APIs preserved under Nerey's own
namespace rather than flattened into prop soup. Explicit prop forwarding, no `{...rest}` into a root.

**Deliberately not carried in** — the `no ARIA attributes` convention. It was correct when PrimeReact
supplied ARIA for free; a headless library that emits interactive DOM must set roles and ARIA itself.

## UX Specifications

`@nerey/core` has no visual specification by construction. `@nerey/theme` covers, per widget: idle,
hover, tentative selection, submitting, locked/terminal, expired, error-fallback, and read-only
replay. Chat column widths of roughly 520 px (side panel open) and 740 px (closed) are the layout
targets. Reasoning and status surfaces must not be framed as transparency into the model: humans
identify causal relationships in reasoning traces at 29% accuracy against a 25% baseline, so the copy
describes activity, never explanation.

## Acceptance Criteria

- [ ] AC-1: `npm pack @nerey/core` contains zero `.css` files, and its dependency tree includes
      neither `@nerey/theme`, nor Zod, nor a markdown renderer, nor an HTTP client.
- [ ] AC-2: A fresh Next.js 16 app importing `@nerey/core` from a Server Component file compiles with
      no `'use client'` directive added by the consumer.
- [ ] AC-3: `createWidgetRegistry([entry, entry])` throws `Duplicate widget registration: <type>@<version>`
      at construction, not at first lookup.
- [ ] AC-4: `composeRegistries(builtIns, appWidgets)` resolves both catalogs; a colliding key throws
      unless `{ override: true }` was passed.
- [ ] AC-5: A widget registered as `poll@1.0.0` against a payload carrying `version: "1.0"` does not
      resolve, and the fallback renders — the exact-match rule is observable, not implicit.
- [ ] AC-6: Each of the four degradation steps (unknown type, invalid payload, component throw, no
      fallback configured) renders without throwing, and each emits its own typed error to
      `onWidgetError`.
- [ ] AC-7: With `status: 'streaming'`, a partial payload that would fail `payloadSchema` renders the
      widget's loading branch and triggers no validation error.
- [ ] AC-8: A widget importing `axios` inside the widgets directory fails lint under
      `@nerey/eslint-config` with the documented message.
- [ ] AC-9: `onInteraction('reply', { text: 'hi', meta: { a: 1 } })` calls the host's
      `sendUserMessage` exactly once with `'hi'`; `// @ts-expect-error` on `{ text: 123 }` compiles
      clean, proving the narrowing still holds.
- [ ] AC-10: A widget that submits, then receives a rejected persistence write, stays locked, surfaces
      `PersistenceError`, and sends no second reply.
- [ ] AC-11: Two widget instances in one conversation persist and restore state independently, keyed
      by `messageId`.
- [ ] AC-12: `lifecycle.expiry: [{ on: 'interact' }]` flips `readonly` to `true` after the first
      interaction; `{ on: 'timeout', ms }` after the interval; `afterExpiry: 'snapshot'` renders the
      terminal state read-only on reload and fires no effect.
- [ ] AC-13: A widget registered at `v2` with `migrate` reads a persisted `v1` payload and renders
      without a fallback.
- [ ] AC-14: A consumer styles every widget state from their own `.module.css` using only documented
      `data-nerey-*` and `data-state` attributes, importing neither `@nerey/theme` nor any class name.
      A snapshot test locks that attribute surface against silent change.
- [ ] AC-15: `import '@nerey/theme/theme.css'` in a Next.js app renders styled widgets with no CSS
      Modules configuration for `node_modules`.
- [ ] AC-16: Importing `theme.css` **without** `tokens.css` renders every component legibly via
      declared fallbacks — no invisible text, no zero-size boxes.
- [ ] AC-17: Redeclaring `--nerey-*` properties in `:root` produces a fully rebranded UI with no
      component override and no `!important` anywhere in the consumer's CSS.
- [ ] AC-18: A page that ships no CSS reset at all renders `@nerey/theme` identically to one that
      ships Preflight — verified by screenshot comparison in both configurations.
- [ ] AC-19: `data-nerey-theme` set to `light` or `dark` overrides `prefers-color-scheme` in both
      directions.
- [ ] AC-20: A Storybook loading only `@nerey/theme/tokens.css` plus the theme's own stylesheet renders
      every widget identically to the app — no Tailwind, no host design system, no cascade leak.
- [ ] AC-21: A widget authored against `@nerey/core/mock` alone renders, interacts and persists in
      Storybook with no backend and no network.
- [ ] AC-22: The conformance kit run against both built-in widgets passes, and fails on a deliberately
      seeded violation of each rule it checks.
- [ ] AC-23: `osint-chat-client` replaces `src/shared/generative-ui/` with `@nerey/core` and its own
      widget catalog; the poll widget's fifteen existing acceptance criteria still pass unchanged.

## Coverage Summary

| Category   | Status  | Notes                                                                                                                                                                                                               |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional | ✓ Clear | 39 requirements across packaging, registry, validation, host contract, lifecycle runtime, styling contract, theme, dev layer, non-goals                                                                             |
| Technical  | ✓ Clear | Extraction source mapped file-by-file; four couplings to break (app schema, Zod, markdown, Query); Base UI and Standard Schema as the only new architectural dependencies                                           |
| UX/Design  | ✓ Clear | Core has none by construction; theme covers 8 states per widget at two column widths, with an explicit constraint on reasoning-surface framing                                                                      |
| Acceptance | ✓ Clear | 23 criteria — packaging isolation, exact-version resolution, degradation chain, lifecycle runtime, migration, data-attribute contract, tokens-only theming, reset independence, and a real-consumer migration check |

## Open Questions

1. **Registry versioning strategy at scale.** Exact `type@version` matching (FR-10) is correct and was
   learned the hard way, but a consumer with thirty widgets will accumulate dead registrations. Does
   Nerey ship a deprecation channel, or is that the consumer's problem?
2. **Overlay scope ownership.** `{ slot: 'overlay', scope: 'page' }` implies Nerey portals outside the
   conversation subtree. That collides with a consumer's own portal and z-index layering, and there is
   no precedent in any surveyed standard to copy.
3. **Does `poll` belong in `@nerey/theme`?** FR-36 puts it there on the argument that it is a design
   decision. The counter-argument is that its select/lock/persist choreography is the most valuable
   thing the shipped code proved out, and burying it in the optional package hides it from anyone who
   takes core alone.
