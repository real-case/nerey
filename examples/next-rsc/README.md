# Next.js 16 RSC example

A private workspace (ADR 0051) that uses Nerey the way a Next.js App Router application would, and
the application CI builds against the packages **as published**.

```sh
npm run build                 # build the packages
npm run test:examples         # pack them, install the tarballs into a copy of this app, build, smoke
npm run app:dev -w @nerey-examples/next-rsc   # or work on it inside the workspace, on port 3100
```

## What it shows

| File                            | Runs on | Does                                                                                                                                                           |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/page.tsx`                  | server  | `describeRegistry(serverContracts, …)` from `@nerey/core/server`, and reads the stored transcript, widget state and expiry markers so the first frame is right |
| `lib/contracts.ts`              | server  | the catalog as React-free contracts: `themeWidgetContracts` from `@nerey/theme/server`, plus the app's own (ADR 0056)                                          |
| `lib/registry.tsx`              | client  | the same catalog as registry entries, composed with `composeRegistries`                                                                                        |
| `lib/widgets/offer/`            | both    | an application widget split the same way: `contract.ts` for the server, `entry.tsx` adds the component                                                         |
| `components/chat.tsx`           | client  | `useChat` with `WidgetHostProvider`; `respond` goes to `addToolOutput` (ADR 0048)                                                                              |
| `app/api/chat/route.ts`         | server  | a scripted model: AI SDK UI message chunks, no LLM and no wall clock                                                                                           |
| `app/api/widget-state/route.ts` | server  | the persistence port's backend (ADR 0047)                                                                                                                      |
| `app/layout.tsx`                | server  | imports `tokens.css` and `theme.css`; there is no CSS Modules configuration (AC-15)                                                                            |

## Determinism

Every timestamp comes from `lib/clock.ts`, which the scripted stream writes into message metadata and
the client hands to `host.now`. The seeded offer was made ten minutes before that clock and lasts one,
so the server render shows it closed. Nothing calls `Date.now()`.

## The smoke

`e2e/smoke.spec.ts` checks, against `next start`: the server-rendered HTML carries the registry
description and the expired offer as read-only; the page hydrates with no console error; the poll
streams in, its answer leaves as the tool call's output, and the scripted reply quotes it; after a
reload the poll is read-only in the server HTML and after hydration.
