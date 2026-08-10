import { defineWidget } from '@nerey/core';

import { TaskTreeWidget } from './component';
import {
  TASK_TREE_PLACEMENT,
  TASK_TREE_TYPE,
  TASK_TREE_VERSION,
  taskTreePayloadSchema,
  taskTreeStateSchema,
} from './schema';
import type { TaskTreePayload, TaskTreeState } from './schema';

/**
 * The lifecycle is the part of this record worth arguing about.
 *
 * `persist: 'forever'` — a completed task tree is the answer to "what did it actually do", and that
 * question is asked days later. It outlives the session (ADR 0016).
 *
 * `expiry: []` — nothing expires it, and each rule was rejected for a reason. `{ on: 'interact' }`
 * is meaningless: collapsing a branch is reading, not deciding. `{ on: 'message' }` would freeze the
 * tree the moment the agent said anything, which is exactly when a long run is still streaming rows
 * into it. `{ on: 'timeout' }` would put a clock on a record that is not time-sensitive.
 *
 * `afterExpiry: 'snapshot'` — unreachable while `expiry` is empty, and stated anyway, because it is
 * the answer if a host ever forces the widget read-only: keep rendering the tree. `fallback` would
 * replace the structure with one line of prose and `hide` would delete the only account of the run.
 */
export const taskTreeWidget = defineWidget<TaskTreePayload, TaskTreeState>({
  type: TASK_TREE_TYPE,
  version: TASK_TREE_VERSION,
  component: TaskTreeWidget,
  placement: TASK_TREE_PLACEMENT,
  lifecycle: {
    persist: 'forever',
    expiry: [],
    afterExpiry: 'snapshot',
  },
  payloadSchema: taskTreePayloadSchema,
  stateSchema: taskTreeStateSchema,
});

export { TaskTreeWidget } from './component';
export type { TaskTreeWidgetProps } from './component';
export {
  DEFAULT_TASK_TREE_TITLE,
  TASK_STATUS_LABEL,
  TASK_TREE_PLACEMENT,
  TASK_TREE_TYPE,
  TASK_TREE_VERSION,
  expandedByDefault,
  hasChildren,
  isExpandable,
  readTasks,
  taskSchema,
  taskStatusSchema,
  taskTreePayloadSchema,
  taskTreeStateSchema,
} from './schema';
export type { Task, TaskStatus, TaskTreePayload, TaskTreeState } from './schema';
