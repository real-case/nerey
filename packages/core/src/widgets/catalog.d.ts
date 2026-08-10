import type { AnyWidgetRegistryEntry } from '../types';
/**
 * ADR 0035 — the only file that knows the built-in composition. Adding a widget is one line
 * here, and nothing anywhere registers itself as a side effect of being imported (ADR 0010).
 *
 * The array is deliberately short. A library that ships thirty widgets is shipping thirty
 * design decisions a consumer has to undo; `text` and `confirmation` are the two that earn
 * their place because the first is unavoidable and the second is the smallest thing that
 * proves the interaction, lifecycle and persistence contracts fit together.
 */
export declare const builtInWidgets: readonly AnyWidgetRegistryEntry[];
//# sourceMappingURL=catalog.d.ts.map
