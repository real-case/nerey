import { asAnyWidget } from '@nerey/core';
import type { AnyWidgetRegistryEntry } from '@nerey/core';

import { choiceChipsWidget } from './choice-chips';
import { citationsWidget } from './citations';
import { confirmationWidget } from './confirmation';
import { dataTableWidget } from './data-table';
import { filterPanelWidget } from './filter-panel';
import { formWidget } from './form';
import { pollWidget } from './poll';
import { progressTrackerWidget } from './progress-tracker';
import { taskTreeWidget } from './task-tree';
import { textWidget } from './text';
import { toastNoticeWidget } from './toast-notice';

/**
 * The theme's catalog — the only file that knows the composition. Adding a widget is one line
 * here, and nothing registers itself as a side effect of being imported (ADR 0010).
 *
 * Compose it AFTER core's, with the override flag:
 *
 *   composeRegistries({ override: true }, builtInWidgets, themeWidgets)
 *
 * The order and the flag are both load-bearing. `text` and `confirmation` appear in both catalogs
 * at the same `type@version`, because the theme's versions are styled replacements for core's
 * built-ins rather than new widgets (ADR 0035): a producer emits `confirmation@1.0.0` and gets
 * whichever entry the registry resolved, with the same payload contract either way. Later wins,
 * so the theme's entries take those two keys and the rest of the catalog is added alongside.
 * Without `{ override: true }` the duplicate throws, which is the right default everywhere else —
 * two people registering the same key is almost never intentional, and last-write-wins would
 * otherwise make the outcome depend on array order.
 *
 * A consumer who wants the theme's look for everything EXCEPT one widget composes their own entry
 * last. A consumer who wants core's headless `text` back drops `themeWidgets` and lists the theme
 * entries they do want individually; nothing here is all-or-nothing.
 */
export const themeWidgets: readonly AnyWidgetRegistryEntry[] = [
  // The two that override a core built-in, first and named as such.
  asAnyWidget(textWidget),
  asAnyWidget(confirmationWidget),

  // The theme's own, alphabetical — the order carries no meaning beyond being greppable.
  asAnyWidget(choiceChipsWidget),
  asAnyWidget(citationsWidget),
  asAnyWidget(dataTableWidget),
  asAnyWidget(filterPanelWidget),
  asAnyWidget(formWidget),
  asAnyWidget(pollWidget),
  asAnyWidget(progressTrackerWidget),
  asAnyWidget(taskTreeWidget),
  asAnyWidget(toastNoticeWidget),
];
