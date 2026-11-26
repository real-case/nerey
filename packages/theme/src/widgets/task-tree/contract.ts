import { NEVER_EXPIRES, defineWidgetContract } from '@nerey/core/server';

import {
  TASK_TREE_PLACEMENT,
  TASK_TREE_TYPE,
  TASK_TREE_VERSION,
  taskTreePayloadSchema,
  taskTreeStateSchema,
} from './schema';
import type { TaskTreePayload, TaskTreeState } from './schema';

/**
 * The React-free half of `taskTreeWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const taskTreeContract = defineWidgetContract<TaskTreePayload, TaskTreeState>({
  type: TASK_TREE_TYPE,
  version: TASK_TREE_VERSION,
  description: 'Show a hierarchy of tasks with their statuses. Display only — it reports nothing back.',
  placement: TASK_TREE_PLACEMENT,
  // `NEVER_EXPIRES` is exactly the lifecycle argued for above, and naming the constant is what tells
  // the conformance kit the empty `expiry` is deliberate rather than a copy-paste artefact.
  lifecycle: NEVER_EXPIRES,
  payloadSchema: taskTreePayloadSchema,
  stateSchema: taskTreeStateSchema,
});
