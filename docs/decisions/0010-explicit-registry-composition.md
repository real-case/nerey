---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0010. Explicit registry composition instead of a global mutable registry

## Context and Problem Statement

ADR 0008 makes the registry the load-bearing abstraction: the model names a widget, the client owns it. That leaves the question of who builds the registry and when. The design being replaced answered it with a module-level singleton — a `registerWidget(entry)` call at module scope in each widget file, and a side-effect import somewhere in the app's startup path to make those modules evaluate. It is the shape most component-catalog libraries reach for, and it works right up until the point where it does not.

Its failure modes are all of the same kind: the registry's contents depend on which modules happened to be evaluated, in which order, in which bundle, in which process. A tree-shaker deletes registrations because a side-effect-only import looks like dead weight. A test file that registers a widget leaks it into the next test. Two copies of the module in a graph — a routine outcome of hot module replacement, of a monorepo with duplicate versions, or of a React Server Components build splitting client and server graphs — produce two registries, of which the renderer reads the empty one. A duplicate key is discovered on first lookup, in one conversation, in production.

For a library rather than an application this is disqualifying. A library cannot know its consumer's bundler, module graph, or rendering topology, and it cannot make a correctness property depend on any of them. The scope of this record is registry construction and merging in `@nerey/core`; the matching rule inside a built registry is ADR 0009.

## Decision Drivers

* Registry contents must be a function of the code that constructs them, not of module evaluation order or bundler behaviour.
* Adding a widget must be one line in the consumer's own catalog file and never a fork of `@nerey/core` (FR-7).
* Errors must surface at the earliest point where the information exists. A duplicate key is knowable at construction; deferring it to first lookup means discovering it in the one conversation that happened to use the widget.
* Tests must be isolable without a reset hook. A test-only `resetRegistry()` is an admission that the production design has global state, and it couples test order to correctness.
* `@nerey/core` must be tree-shakeable and declare `"sideEffects": false`, which is incompatible with registrations that only exist because a module was evaluated.
* The subpath export policy (ADR 0028) forbids deep imports and a mega-barrel; side-effect registration requires exactly the barrel import that policy bans, because the barrel is the only thing that guarantees evaluation.
* `'use client'` is declared inside the package (FR-3), so the module graph is genuinely split across server and client — a singleton would be per-graph, silently.

## Considered Options

* Explicit composition via `createWidgetRegistry` and `composeRegistries`
* Global mutable registry with side-effect registration
* Convention-based auto-discovery

## Decision Outcome

Chosen option: "Explicit composition via `createWidgetRegistry` and `composeRegistries`", because composition is explicit or it is not a library: a registry that depends on which modules a bundler decided to evaluate is not a value a consumer can reason about, test, or hand to two different hosts in the same process.

The shape is small and total:

* `createWidgetRegistry(entries)` takes an array of entries and returns a frozen registry keyed `` `${type}@${version}` ``. A repeated key throws `Duplicate widget registration: <type>@<version>` **at construction**, with both the type and version in the message.
* `emptyRegistry` resolves every lookup to `undefined` — the zero value, so a unit test or a degradation test never has to build one.
* `composeRegistries(...registries)` merges Nerey's built-ins (ADR 0035) with consumer catalogs. A colliding key throws by default; a later registry wins only when the call passes `{ override: true }`, which makes deliberate shadowing of a built-in a visible, greppable act.
* There is no `registerWidget`, no `getGlobalRegistry`, no `defaultRegistry`, and no test-only reset hook. The registry is passed to `WidgetHostProvider` as a value (FR-16), which means two hosts in one page can hold different catalogs without either knowing the other exists.

Construction-time failure is the substantive part. `createWidgetRegistry([entry, entry])` throws while the module that builds the catalog is being evaluated — which is app boot in production and the very first line of any test that touches the catalog. The alternative, discovering the collision on first lookup, means a duplicate `poll@1.0` sits latent until a conversation happens to contain a poll, and then surfaces as a rendering bug in a user's transcript rather than a crash in CI.

### Consequences

* Good, because the registry is a value with structural equality semantics: same input array, same registry, regardless of bundler, HMR state, or how many times the module was evaluated.
* Good, because tests get isolation for free. Each test constructs the registry it needs, or uses `emptyRegistry`; there is no shared mutable state to leak and therefore no reset hook and no test-order coupling (ADR 0006).
* Good, because `"sideEffects": false` is honest, so tree-shaking cannot silently delete a registration and consumers only pay for the widgets they compose.
* Good, because duplicate keys are a boot-time crash with an exact message rather than a runtime rendering anomaly (AC-3).
* Good, because it composes with the subpath export policy (ADR 0028): nothing needs to be imported for its side effects, so no barrel is required and no dependency graph is dragged along.
* Bad, because the consumer must write and maintain a catalog module and pass it to the host. This is a real ergonomic cost compared to "import the widget file and it appears", and it is the cost being deliberately paid.
* Bad, because dynamically loading a widget after the host has mounted requires constructing a new registry and re-providing it, rather than mutating in place. Lazy widget loading is therefore a composition-level concern, not a registry feature.
* Neutral, because `{ override: true }` is a small hole in the "collisions are errors" rule, kept because shadowing a built-in with a consumer's version is a legitimate need and is better done explicitly than by accident.

### Confirmation

* `packages/core/src/registry/__tests__/create-widget-registry.test.ts` — AC-3. Asserts the throw happens during `createWidgetRegistry`, not at first lookup, and matches the message string exactly (`Duplicate widget registration: poll@1.0`), not merely `toThrow()`. Also asserts `Object.isFrozen(registry)` and that mutation attempts on the returned value are inert.
* `packages/core/src/registry/__tests__/compose-registries.test.ts` — AC-4. Both catalogs resolve; a colliding key throws; the same call with `{ override: true }` resolves to the later entry and does not throw.
* `npm run check:public-api` — the API snapshot must never contain `registerWidget`, `getGlobalRegistry`, `defaultRegistry`, `resetRegistry` or `clearRegistry`. Reintroducing global registration would require an explicit, reviewed snapshot diff.
* ESLint, in `@nerey/eslint-config` (ADR 0005): a `no-restricted-syntax` selector rejecting module-scope call expressions whose callee matches `/^register[A-Z]/` anywhere under `packages/*/src/**`, so a side-effect registration cannot be reintroduced locally even under a different name.
* `npm run check:exports` — asserts `"sideEffects": false` is declared for every published package and that each subpath entry point can be imported in a fresh module registry with no observable global state created.
* `npm run check:gates` (ADR 0033) plants a duplicate-key catalog and a module-scope `registerFoo()` call and fails if either gate passes them.

## Pros and Cons of the Options

### Explicit composition via `createWidgetRegistry` and `composeRegistries`

`const registry = composeRegistries(builtInWidgets, appWidgets)`, passed to `WidgetHostProvider` as a prop.

* Good, because registry contents are determined by code the consumer wrote, not by evaluation order.
* Good, because duplicate detection happens at construction, where both colliding entries are in hand (AC-3).
* Good, because immutability makes the registry safe to share, memoise as a provider value, and hold in more than one host simultaneously.
* Good, because it needs no reset hook, so tests are independent by construction.
* Neutral, because it requires a catalog module in the consumer — one file, explicitly maintained.
* Bad, because widget-level code splitting has to be arranged by the consumer rather than falling out of the import graph.

### Global mutable registry with side-effect registration

`registerWidget(entry)` at module scope in each widget file, plus a side-effect import to force evaluation. This is the design being replaced, and it is what the shipped implementation started from.

* Good, because adding a widget is a single call in the widget's own file with nothing to wire up, which is genuinely the best authoring experience of the three.
* Good, because it requires no plumbing through providers, so any module can resolve a widget without access to a host value.
* Neutral, because the singleton is invisible until something goes wrong with it.
* Bad, because correctness depends on module evaluation, so a tree-shaker, a lazy route, or an unused-import lint rule can delete registrations silently.
* Bad, because duplicate keys are only discoverable at lookup, in the specific conversation that hits them.
* Bad, because tests contaminate each other and need a reset hook, which then exists in the public surface as a test-only escape hatch.
* Bad, because a split module graph — RSC, HMR, or duplicated package versions in a monorepo (ADR 0002) — yields more than one registry, and the renderer may read the wrong one.
* Bad, because it forces the barrel import that ADR 0028 forbids, dragging the client boundary and the full dependency list into every importing module.

### Convention-based auto-discovery

A build-time glob over `widgets/*/index.ts` assembles the registry. Vite's `import.meta.glob` and file-system routing make this a familiar and legitimate pattern.

* Good, because it removes the catalog file while keeping the result static and analysable at build time, unlike the singleton.
* Good, because it makes registrations impossible to forget.
* Neutral, because the widget's key would come from the directory name, which is a convention that must be documented and enforced.
* Bad, because `import.meta.glob` is bundler-specific. A published library cannot require its consumers to use Vite, and `@nerey/core` must build and be consumed under Next.js, Vite and plain `tsc` alike.
* Bad, because it cannot express `composeRegistries(builtIns, appWidgets)` across package boundaries — a glob does not reach into `node_modules` — so built-ins and consumer widgets would need two different mechanisms.
* Bad, because the version half of the key has no natural place in a file path, and encoding it as `widgets/poll@1.0/` makes directory names load-bearing in a way ADR 0009's exactness rule would then depend on.
* Bad, because a consumer with a widget outside the conventional directory has no supported path at all.

## More Information

Grounded in FR-6, FR-7 and FR-16; acceptance criteria AC-3 and AC-4. Builds on the envelope and registry-as-abstraction position in ADR 0008 and supplies the container whose matching rule ADR 0009 fixes. The built-in registry it composes with is scoped by ADR 0035, and the packaging constraints it must respect are ADR 0002 and ADR 0028. Test isolation properties assume the Vitest setup in ADR 0006, and the throw-at-construction assertion is protected by the planted-violator gate in ADR 0033.

Revisit if a consumer case demands genuinely dynamic post-mount widget loading; the likely answer is a documented recipe that rebuilds and re-provides a registry, not a mutable one.
