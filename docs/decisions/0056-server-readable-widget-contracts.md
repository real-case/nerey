---
status: "accepted"
date: 2026-11-27
decision-makers: Yurii Anichkin
---

# 0056. Widget contracts are React-free and published on the server entries

## Context and Problem Statement

ADR 0052 gave core a server entry so a React Server Component can call `describeRegistry` where the
prompt is built. It left one question open on purpose: a registry entry holds a `component`, and every
entry Nerey ships is exported from a `'use client'` bundle. In a Next.js server module, an export of a
client module is a client reference. Reading `pollWidget.type` on it throws ("cannot dot into a client
module from a server component"), so the server cannot describe the theme's catalog, or core's
built-ins, at all. ADR 0052 asked for the answer to come out of the Next.js example (production-ready
plan, phase 5) and to be recorded before the subpath is published. This is that record.

Everything a producer needs from an entry is already React-free: `type`, `version`, `description`,
`placement`, `lifecycle` and the three Standard Schemas. Only `component` is not. The problem is that
the two halves live in one object literal, in the same module as the component import.

## Decision Drivers

- The prompt is derived from the same objects the client renders with (ADR 0040); nothing is retyped
  beside the registry.
- The `@nerey/ai-sdk` server helper (`toolsFromRegistry`, ADR 0051) has the same need on the same
  objects.
- No new dependency, and no change to what the client entries already export (ADR 0002, 0028).
- The server can validate a tool call's input against the real schema, not only describe it.

## Considered Options

- React-free widget contracts, published on `@nerey/core/server` and a new `@nerey/theme/server`, with
  each client entry built from its contract
- Generate a JSON descriptor file for each catalog at build time and ship it
- Leave it to the application: describe only its own widgets on the server

## Decision Outcome

Chosen option: "React-free widget contracts, published on `@nerey/core/server` and a new
`@nerey/theme/server`, with each client entry built from its contract", because it closes the gap ADR
0052 named with the same objects the client renders, so the description cannot drift from the registry.

- **`WidgetContract<Payload, State>`** is `WidgetRegistryEntry` without `component`. Core exports the
  type and `defineWidgetContract`, an identity function that keeps the generics, from both entries.
- **Each widget declares its contract in a module with no React import**, and its entry is
  `defineWidget({ ...contract, component })`. The contract is the only place the metadata is written.
- **`describeRegistry` accepts a registry or a list of contracts.** A `WidgetRegistry` is accepted as
  before, so nothing that works today changes; the list form is what a server passes.
- **Core's server entry exports `textContract`, `confirmationContract` and `builtInWidgetContracts`.**
- **`@nerey/theme/server`** is a new subpath, built like core's (ADR 0052): a separate pass with no
  `'use client'` banner. It exports each widget's contract and `themeWidgetContracts`, in the same
  order as `themeWidgets`. Its modules import from `@nerey/core/server` and `zod` only.

### Consequences

- Good, because a server describes, and validates against, exactly what the client registers.
- Good, because the adapter's server helper and the example use one shape, the same one an application
  uses for its own widgets.
- Good, because the change is additive: every existing export keeps its value and signature, apart
  from `describeRegistry`'s parameter, which widens.
- Bad, because each widget is now two declarations (contract and entry) instead of one, and a widget
  author can still write an entry without a contract. The catalog test catches that for the shipped
  catalogs; an application's own widgets are its own concern.
- Bad, because a second published subpath on the theme is a second surface to snapshot and version.
- Neutral, because the constants shared between core's two bundles (`NEVER_EXPIRES`,
  `EXPIRE_ON_INTERACT`) are two frozen copies with equal contents; nothing compares them by identity.

### Confirmation

- `packages/theme/src/server/server-entry.test.ts` builds `@nerey/theme/server` from source and fails
  on any import other than `zod` and `@nerey/core/server`, or a leading `'use client'`.
- `packages/theme/src/widgets/catalog.test.ts` asserts that every entry in `themeWidgets` is its
  contract plus a component, field by field, in the same order as `themeWidgetContracts`; the core
  catalog test asserts the same for `builtInWidgets` and `builtInWidgetContracts`.
- `npm run check:exports` applies `server-entry-no-banner` (ADR 0052) to the theme's `./server`.
- `npm run check:public-api` and `check:api-signatures` gain the theme barrel, re-blessed in the
  implementing commit.
- `npm run check:mutants` re-plants a `@nerey/core` (client entry) import in a theme contract module and
  requires the theme's server-entry test to fail.
- `examples/next-rsc`: a server component describes `themeWidgetContracts` and `next build` completes.

## Pros and Cons of the Options

### React-free widget contracts on the server entries

- Good, because there is one declaration of each widget's metadata, used on both sides.
- Good, because the server keeps the Standard Schemas and can validate, not only describe.
- Bad, because it touches every shipped widget once.

### Generate a JSON descriptor file for each catalog at build time

The theme's build would run `describeRegistry` with Zod's converter and ship `descriptors.json`.

- Good, because the server reads plain data and no module boundary is involved.
- Bad, because the theme picks the JSON Schema converter and its options, which ADR 0040 left to the
  consumer, and the file cannot be merged with an application's own entries through the same call.
- Bad, because the server gets no Standard Schema, so it cannot validate a tool call's input.

### Leave it to the application

- Good, because nothing changes in the packages.
- Bad, because the shipped catalogs cannot be described on the server, so an application either
  retypes their metadata, which ADR 0040 exists to prevent, or describes them in the browser, which ADR
  0052 rejected.

## More Information

Closes the question ADR 0052 left open, and adds to its server entry under its rule (nothing reachable
imports React at runtime). Serves ADR 0040 on the server and ADR 0051's adapter server helper. The
prototype that settled the shape is `examples/next-rsc`.
