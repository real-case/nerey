# @nerey/eslint-config

The architectural boundaries of a Nerey-based generative UI, shipped as ESLint flat config.

```bash
npm install --save-dev @nerey/eslint-config
```

```js
// eslint.config.js
import nerey from '@nerey/eslint-config';

export default [...nerey.configs.recommended];
```

Peer: `eslint@^9`. No parser, no plugins, no stylistic rules — this package has exactly one job.

---

## Why this exists as a package

Nerey's most load-bearing invariant is that **a widget performs no I/O**. It is also the one
that does not survive being copied: the rule lives in the origin project's `eslint.config.mjs`,
somebody extracts the widget code into a new repo, the rule stays behind, and within a month a
widget is calling `fetch` directly. The invariant becomes folklore, then becomes false.

So it ships in the box, next to the code it constrains.

## What it enforces

### Widgets perform no I/O

Applied by default to `**/widgets/**/*.{ts,tsx}`.

Banned imports: `axios`, `ofetch`, `ky`, `got`, `superagent`, `@tanstack/react-query`,
`@tanstack/query-core`, `swr`, and anything matching `**/api/*` or `**/services/*`.
Banned globals: `fetch`, `XMLHttpRequest`, `WebSocket`.

A widget's only outbound channel is `onInteraction(action, { text })`; its only persistence
channel is `useWidgetState`, which routes through the `MessagePersistence` port the host
injects. That is what lets the same widget run in Storybook against an in-memory implementation
and in production against your real backend, with no branch inside the widget.

Point it at your own layout:

```js
...nerey.widgets({ files: ['src/chat/widgets/**/*.{ts,tsx}'] })
```

### A headless core stays headless

Applied by default to `**/packages/core/src/**/*.{ts,tsx}`.

Bans, from a core package: `.css` imports and `@nerey/theme` (the dependency arrow points
theme → core and never back), validation libraries (core validates through Standard Schema so a
consumer can bring their own), markdown renderers (the fallback renderer is injected), and
behavioural primitive libraries such as Base UI, Radix and React Aria (those belong to the
presentation layer).

Useful if you are building your own headless layer on the same split. Retarget with
`nerey.core({ files: [...] })`.

### One behavioural primitive library

Applied by default to `**/packages/theme/src/**/*.{ts,tsx}`.

A theme built on Base UI must not also import Radix, React Aria or Ark. The cost of a second
one is not bundle size — it is two focus traps, two portals with different z-index behaviour,
two Escape implementations and two tooltip positioning models. Users notice that long before
they notice kilobytes.

Retarget with `nerey.theme({ files: [...] })`.

---

## Composing

Each group is a function returning a flat-config array, so take only what applies:

```js
import { widgets, core, theme } from '@nerey/eslint-config';

export default [
  ...widgets({ files: ['src/features/chat/widgets/**/*.tsx'] }),
  // core() and theme() omitted — this project has no headless package of its own
];
```

Every rule fails with a message that says what the boundary is and what to do instead, not just
that something is disallowed. A lint error that does not tell you the alternative is a lint
error people disable.

MIT.
