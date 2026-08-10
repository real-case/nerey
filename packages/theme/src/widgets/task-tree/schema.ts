import { z } from 'zod';

import type { Placement } from '@nerey/core';

/**
 * ADR 0011 — core depends on the Standard Schema *spec* and may never reach for a validator, so
 * its two built-ins hand-roll their schemas. The theme is under no such constraint: it is a
 * reference implementation, it already ships a runtime, and a widget author copying this file is
 * far better served by four lines of Zod than by forty lines of hand-written narrowing. Nothing
 * leaks either way — `defineWidget` takes a `StandardSchemaV1`, and Zod 4 implements it.
 */

export const TASK_TREE_TYPE = 'task-tree';
export const TASK_TREE_VERSION = '1.0.0';

/**
 * ADR 0017 — a task tree is a record of what the agent did, so it belongs in the transcript next
 * to the turn that produced it. Not `overlay`: an overlay is a notice that interrupts, and a tree
 * that covered the conversation every time a sub-agent started work would be unusable.
 */
export const TASK_TREE_PLACEMENT: Placement = { slot: 'message' };

export const taskStatusSchema = z.enum(['pending', 'running', 'done', 'error', 'skipped']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export type Task = {
  id: string;
  label: string;
  status: TaskStatus;
  detail?: string;
  children?: Task[];
};

/**
 * The recursion is declared twice — once as the TypeScript type above, once as the runtime schema
 * below — and the two are tied together by the explicit `z.ZodType<Task>` annotation.
 *
 * That annotation is not decoration. `z.lazy` defers the inner schema so `taskSchema` can refer to
 * itself, and a deferred schema has no inferable output type: without the annotation TypeScript
 * reports "'taskSchema' implicitly has type 'any' because it is referenced directly or indirectly
 * in its own initializer" and, under `noImplicitAny`, refuses to compile. Annotating the binding
 * gives the reference a type before the initializer is checked, which breaks the cycle.
 *
 * The cost is that the type is asserted rather than derived, so a field added below without being
 * added to `Task` is a compile error rather than a silent widening — which is the direction the
 * mistake should fail in.
 */
export const taskSchema: z.ZodType<Task> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    status: taskStatusSchema,
    detail: z.string().optional(),
    children: z.array(taskSchema).optional(),
  }),
);

export const taskTreePayloadSchema = z.object({
  title: z.string().optional(),
  tasks: z.array(taskSchema),
});

export type TaskTreePayload = z.infer<typeof taskTreePayloadSchema>;

/**
 * What the reader has changed about how the tree is displayed, recorded as a DIFF against the
 * default rather than as an absolute set of open nodes.
 *
 * The default is computed per task — a branch opens because its structure is the point, a failed
 * task opens because its detail is the point — so an absolute set would freeze whatever the
 * defaults happened to be at the moment the reader first touched the tree, and a later change to
 * those defaults would never reach a transcript anyone had scrolled through. A diff survives it:
 * an id is present only when the reader disagreed with the default, and disagreement is the thing
 * actually worth persisting.
 */
export const taskTreeStateSchema = z.object({ toggled: z.array(z.string()).optional() }).default({});

export type TaskTreeState = z.infer<typeof taskTreeStateSchema>;

/**
 * Exported so a host translates the five status words once instead of at every call site, and so
 * a test can assert against the same strings the component renders.
 */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  error: 'Failed',
  skipped: 'Skipped',
};

export const DEFAULT_TASK_TREE_TITLE = 'Tasks';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a task list out of a value that has NOT been through `taskTreePayloadSchema`.
 *
 * ADR 0019 — while `status === 'streaming'` the renderer skips validation entirely, because a
 * partial object fails a complete schema by definition. A tree is the widget that streams most:
 * tasks appear one at a time, and the last one in the list routinely arrives with a half-written
 * label and no status at all. So the component reads the payload through this total function
 * instead of trusting the declared type, and an entry that cannot be identified — no `id` — is
 * dropped rather than rendered as a row that will change identity on the next delta.
 *
 * It runs on validated payloads too. The extra pass is a few object allocations and it removes the
 * only interesting branch from the component: there is one shape to render, never two.
 */
export function readTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) return [];

  const out: Task[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;

    const id = raw['id'];
    if (typeof id !== 'string' || id === '') continue;

    const status = taskStatusSchema.safeParse(raw['status']);
    const task: Task = {
      id,
      label: typeof raw['label'] === 'string' ? raw['label'] : '',
      // A task whose status has not arrived yet has not started as far as anyone can tell.
      status: status.success ? status.data : 'pending',
    };

    if (typeof raw['detail'] === 'string' && raw['detail'] !== '') task.detail = raw['detail'];

    const children = readTasks(raw['children']);
    if (children.length > 0) task.children = children;

    out.push(task);
  }
  return out;
}

/** A task is a branch when it has children, and a disclosure when it has anything to disclose. */
export function isExpandable(task: Task): boolean {
  return hasChildren(task) || task.detail !== undefined;
}

export function hasChildren(task: Task): boolean {
  return (task.children?.length ?? 0) > 0;
}

/**
 * Open unless the reader says otherwise: a branch, because the shape of the work is the reason the
 * tree exists, and a failure, because an error nobody expands is an error nobody reads.
 */
export function expandedByDefault(task: Task): boolean {
  return hasChildren(task) || task.status === 'error';
}
