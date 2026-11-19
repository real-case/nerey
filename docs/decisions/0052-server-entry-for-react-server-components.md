---
status: "proposed"
date: 2026-11-19
decision-makers: Yurii Anichkin
---

# 0052. Core publishes a React-free server entry, `@nerey/core/server`

## Context and Problem Statement

The whole of `@nerey/core` is a client boundary. `packages/core/vite.config.ts` emits `'use client'`
as a banner on every chunk, because nearly every export touches React state, context or effects, and
ADR 0028 publishes three subpaths (`.`, `/mock`, `/testing`), all built the same way.

That is correct for rendering and wrong for one job that belongs on the server: telling the model what
it may render. ADR 0040 decided that the model's instructions are derived from the registry with
`describeRegistry(registry, { toJsonSchema })`. In an application built on React Server Components the
prompt is assembled on the server, next to the model call. A server module that imports
`describeRegistry` from `@nerey/core` gets a client reference, not a function, and cannot call it. The
same holds for `createWidgetRegistry` and `composeRegistries`. So today an RSC application either
describes its registry in the browser and ships the description back, which inverts ADR 0040, or
copies the descriptor logic, which is the retyping ADR 0040 exists to prevent.

The functions involved are already React-free. `registry.ts`, `describe.ts`, `validate.ts` and
`lifecycle/expiry.ts` import only types from `./types` and `@standard-schema/spec`. The problem is
packaging, not code.

## Decision Drivers

- The prompt is derived from the registry where the model is called (ADR 0040), which in an RSC
  application is the server.
- No new dependency and no runtime change to the client entry (ADR 0002, 0051).
- A subpath is a public surface: adding one is a MINOR, removing it is a break (ADR 0028, 0038). It
  should be added once, with the right contents.
- Nothing exported from a server entry may import React at runtime, or the boundary leaks back.

## Considered Options

- A separate `@nerey/core/server` subpath without `'use client'`, holding only React-free exports
- Leave everything client-side and describe the registry in the browser
- Drop the `'use client'` banner and mark individual modules instead

## Decision Outcome

Chosen option: "A separate `@nerey/core/server` subpath without `'use client'`, holding only React-free
exports", because it makes the server-side derivation in ADR 0040 possible without changing anything
the client entry already promises.

`@nerey/core/server` is built as its own entry with **no** `'use client'` banner, and exports:

- `createWidgetRegistry`, `composeRegistries`, `emptyRegistry`, `defineWidget`;
- `describeRegistry` and its types;
- the pure lifecycle evaluator (`firstFiredRule`, `isExpired`, `msUntilNextTimeout`) and the constants
  `NEVER_EXPIRES` and `EXPIRE_ON_INTERACT`;
- `validateSync` and its issue helpers;
- the public types: `NereyMessage`, `NereyWidgetEnvelope`, `WidgetRegistryEntry`, `WidgetRegistry`,
  `Lifecycle`, `ExpiryRule`, `Placement`.

The client entry keeps exporting all of these as well, so nothing that works today moves.

**The rule for adding to it**: a module reachable from the server entry imports nothing from `react`
or `react-dom` at runtime. Type-only imports are fine.

**What stays open, deliberately.** A registry entry holds a `component`. On the server, that component
comes from a `'use client'` module and is a client reference, which `describeRegistry` never calls, so
an application's own entries work. The built-in entries (`confirmationWidget`, `textWidget`) are
exported from the client bundle as whole objects, so on the server their `type` and `version` are not
readable. Whether the server entry also exports the built-ins' metadata, and in what shape, is decided
after the Next.js example (production-ready plan, phase 5) has shown which shape works, and recorded
as an amendment before the first publish of this subpath.

### Consequences

- Good, because an RSC application derives the model's instructions on the server from the same
  registry objects it renders with.
- Good, because the client entry and its `'use client'` guarantee are unchanged.
- Good, because the "no React at runtime" rule is checkable and keeps the entry honest as it grows.
- Bad, because the same functions are reachable from two entry points, and a consumer can import from
  the wrong one. The functions are identical, so the cost is confusion rather than a bug.
- Bad, because the built-in widgets' metadata is not yet solved on the server, and this record ships
  with that gap named rather than closed.
- Neutral, because a fourth subpath adds a fourth entry to the exports allowlist and the surface
  snapshots.

### Confirmation

- `npm run check:exports` (allowlist, `attw`, `publint`) lists `./server` with `types` first and no
  `'use client'` in its built file; the allowlist change is the reviewable line.
- `packages/core/src/server/server-entry.test.ts` (new): imports the built `dist/server/index.js` and
  asserts that its module graph loads no `react` or `react-dom` module, and that its first statement is
  not `'use client'`.
- `examples/next-rsc` (ADR 0051): a server module imports `@nerey/core/server`, calls
  `describeRegistry`, and `next build` completes with no client/server boundary error. The example is
  built in CI.
- `npm run check:public-api` and `check:api-signatures` gain the new barrel, re-blessed in the
  implementing commit.
- `npm run check:gates` plants a server module that imports React and requires the test above to fail
  (ADR 0033).

## Pros and Cons of the Options

### A separate `@nerey/core/server` subpath without `'use client'`, holding only React-free exports

- Good, because it solves the RSC case with packaging and no code change.
- Good, because its rule is simple and testable.
- Bad, because it duplicates exports across two entry points.
- Bad, because it leaves the built-in widgets' metadata open until the example settles it.

### Leave everything client-side and describe the registry in the browser

- Good, because nothing changes.
- Bad, because the description is computed in the browser and sent to the server, so the prompt depends
  on what a client says the registry is. That inverts ADR 0040 and gives a client a way to change the
  model's instructions.

### Drop the `'use client'` banner and mark individual modules instead

- Good, because there is one entry point and the right modules are client modules.
- Bad, because Rollup strips module-level directives when it bundles, which is why the banner exists.
  Keeping directives would mean `preserveModules` and a different output layout for every consumer.
- Bad, because one forgotten directive turns a hook module into a server module that crashes at
  import, and nothing short of an RSC build would notice.

## More Information

Adds to ADR 0028's published surface without changing its rules (`types` first, no pattern keys, no
`require`). Serves ADR 0040 (the registry describes itself) in the environment where the model is
called. The example that settles the open question is in ADR 0051's `examples/*`.
