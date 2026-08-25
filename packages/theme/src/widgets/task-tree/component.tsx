import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import { WidgetPart, WidgetRoot, useWidgetState } from '@nerey/core';
import type { NereyState, WidgetComponentProps } from '@nerey/core';

import { Badge } from '../../components/badge/badge';
import type { BadgeTone } from '../../components/badge/badge';
import { Collapsible } from '../../components/collapsible/collapsible';
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  DotsHorizontalIcon,
  MinusIcon,
  SpinnerArcIcon,
} from '../../components/icons/icons';
import { Spinner } from '../../components/spinner/spinner';
import { Text } from '../../components/text/text';
import { cx } from '../../internal/cx';
import {
  TASK_TREE_PLACEMENT,
  TASK_TREE_TYPE,
  TASK_TREE_VERSION,
  expandedByDefault,
  hasChildren,
  isExpandable,
  readTasks,
} from './schema';
import type { Task, TaskStatus, TaskTreePayload, TaskTreeState } from './schema';
import { useNereyLabels } from '../../labels/labels';
import styles from './task-tree.module.css';

export type TaskTreeWidgetProps = WidgetComponentProps<TaskTreePayload, TaskTreeState>;

/**
 * A `role="tree"` of agent work, keyed off real ARIA state rather than a parallel class vocabulary.
 *
 * ## Why the treeitem is a `<div>` and not the disclosure button
 *
 * The obvious build — `Collapsible.Trigger` carrying `role="treeitem"` — produces a tree whose
 * leaves are plain text and whose branches are buttons, so half the rows are in the tab order and
 * half are not, and arrow keys do nothing anywhere. A tree is a COMPOSITE widget: the container
 * owns one tab stop, and the arrow keys move a roving `tabIndex` between items (APG). That contract
 * cannot be delegated to a button per row, so it is implemented here, and `Collapsible` is used for
 * what it is uniquely good at — measuring the panel and animating its height — with the treeitem
 * itself driving `open`.
 *
 * ## Why the group nests inside the treeitem
 *
 * `role="group"` must be a child of the treeitem that owns it, or be pointed at by `aria-owns`. The
 * child form is used because `aria-owns` re-parents the accessibility tree away from the DOM, and
 * every subsequent reader of this file would have to hold both trees in their head. It also keeps
 * axe's `aria-required-children` happy the easy way: the tree's own children are exactly treeitems,
 * and everything else — the detail paragraph, the panel wrapper — is inside one, where the rule
 * stops descending. Anything rendered as a SIBLING of the treeitems would be reported as an
 * unallowed child of `tree`, which is why the streaming footer sits outside the tree entirely.
 *
 * ## What it does not do
 *
 * It sends nothing. A task tree is output: the agent is reporting, not asking, and a widget that
 * offered "retry this step" would be inventing a capability the payload cannot describe (ADR 0014).
 * Its only persistence is which nodes the reader collapsed (ADR 0016).
 */

const STATUS_CLASS: Record<TaskStatus, string | undefined> = {
  pending: undefined,
  running: styles.statusRunning,
  done: styles.statusDone,
  error: styles.statusError,
  skipped: styles.statusSkipped,
};

const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  pending: 'neutral',
  running: 'accent',
  done: 'success',
  error: 'danger',
  skipped: 'neutral',
};

/** Shared and frozen: a fresh `{}` per render is a new `initial` identity for `useWidgetState`. */
const EMPTY_STATE: TaskTreeState = Object.freeze({});

const NO_TOGGLES: ReadonlySet<string> = new Set<string>();

/** The glyph size that sits level with `--nerey-font-size-md` text without dominating the row. */
const MARKER_SIZE = 14;

/**
 * One visible row, flattened. The keyboard contract is index arithmetic over this list — "the next
 * visible item" is the next entry, and `parentIndex` makes ArrowLeft an O(1) jump rather than a
 * second walk of the tree.
 */
type TreeNode = {
  task: Task;
  level: number;
  expandable: boolean;
  expanded: boolean;
  /** Index into the same flat list, or `-1` for a task at the root of the tree. */
  parentIndex: number;
};

function isExpanded(task: Task, toggled: ReadonlySet<string>): boolean {
  // XOR against the default — see `taskTreeStateSchema` for why the record is a diff.
  return isExpandable(task) && expandedByDefault(task) !== toggled.has(task.id);
}

function flatten(
  tasks: readonly Task[],
  toggled: ReadonlySet<string>,
  level: number,
  parentIndex: number,
  out: TreeNode[],
): void {
  for (const task of tasks) {
    const expanded = isExpanded(task, toggled);
    const index = out.length;
    out.push({ task, level, expandable: isExpandable(task), expanded, parentIndex });
    // Collapsed children are unmounted by `Collapsible.Panel`, so they are not merely hidden —
    // they are gone, and a keyboard contract that could still reach them would focus nothing.
    if (expanded && task.children) flatten(task.children, toggled, level + 1, index, out);
  }
}

function countTasks(tasks: readonly Task[], counts: { total: number; done: number; failed: number }): void {
  for (const task of tasks) {
    counts.total += 1;
    if (task.status === 'done') counts.done += 1;
    if (task.status === 'error') counts.failed += 1;
    if (task.children) countTasks(task.children, counts);
  }
}

function indexTasks(tasks: readonly Task[], into: Map<string, Task>): void {
  for (const task of tasks) {
    into.set(task.id, task);
    if (task.children) indexTasks(task.children, into);
  }
}

type MarkerProps = { status: TaskStatus; frozen: boolean };

/**
 * `frozen` is the read-only case, and it is the whole reason `SpinnerArcIcon` exists in the icon
 * set. A replayed transcript that keeps spinning is asserting that work is happening right now,
 * which is false and unfalsifiable — the static arc says "this was in progress" without claiming
 * it still is.
 */
function Marker({ status, frozen }: MarkerProps): ReactElement {
  const labels = useNereyLabels();
  if (status === 'running') {
    return frozen ? (
      <SpinnerArcIcon size={MARKER_SIZE} />
    ) : (
      // The label is carried by the treeitem's own `aria-label`; a live region per running row
      // would announce "Running" once for every task the moment the tree mounted.
      <Spinner size="sm" label={labels.taskTree.status.running} />
    );
  }
  if (status === 'done') return <CheckIcon size={MARKER_SIZE} />;
  if (status === 'error') return <AlertCircleIcon size={MARKER_SIZE} />;
  if (status === 'skipped') return <MinusIcon size={MARKER_SIZE} />;
  return <DotsHorizontalIcon size={MARKER_SIZE} />;
}

type NodeProps = {
  task: Task;
  level: number;
  position: number;
  setSize: number;
  toggled: ReadonlySet<string>;
  activeId: string | undefined;
  /** The run is being replayed rather than watched: nothing may animate as though it were live. */
  frozen: boolean;
  interactive: boolean;
  onToggle: (id: string, next: boolean) => void;
  onActivate: (id: string) => void;
  registerNode: (id: string, node: HTMLDivElement | null) => void;
};

function TaskNode(props: NodeProps): ReactElement {
  const labels = useNereyLabels();
  const {
    task,
    level,
    position,
    setSize,
    toggled,
    activeId,
    frozen,
    interactive,
    onToggle,
    onActivate,
    registerNode,
  } = props;

  const expandable = isExpandable(task);
  const expanded = isExpanded(task, toggled);
  const children = task.children ?? [];

  const row = (
    <div
      className={cx(styles.row, STATUS_CLASS[task.status], expandable && interactive && styles.rowActionable)}
      onClick={
        expandable && interactive
          ? () => {
              onToggle(task.id, !expanded);
            }
          : undefined
      }
    >
      {/* Hidden as one unit rather than glyph by glyph: the status is already in the treeitem's
          accessible name and in the badge beside it, so everything in this slot is duplication. */}
      <span className={styles.marker} aria-hidden="true">
        <Marker status={task.status} frozen={frozen} />
      </span>
      <span className={styles.label}>{task.label}</span>
      <Badge size="sm" tone={STATUS_TONE[task.status]}>
        {labels.taskTree.status[task.status]}
      </Badge>
      {expandable && (
        <span className={styles.chevron} aria-hidden="true">
          <ChevronRightIcon size={MARKER_SIZE} />
        </span>
      )}
    </div>
  );

  const panel = (
    <>
      {task.detail !== undefined && (
        <WidgetPart
          part="detail"
          as="p"
          className={cx(styles.detail, task.status === 'error' && styles.detailDanger)}
        >
          {task.detail}
        </WidgetPart>
      )}
      {children.length > 0 && (
        <div role="group" className={styles.group}>
          {children.map((child, index) => (
            <TaskNode
              key={child.id}
              task={child}
              level={level + 1}
              position={index + 1}
              setSize={children.length}
              toggled={toggled}
              activeId={activeId}
              frozen={frozen}
              interactive={interactive}
              onToggle={onToggle}
              onActivate={onActivate}
              registerNode={registerNode}
            />
          ))}
        </div>
      )}
    </>
  );

  return (
    <WidgetPart
      part="task"
      state={task.status === 'error' ? 'error' : undefined}
      className={styles.item}
      render={(partProps) => (
        <div
          {...partProps}
          ref={(node) => {
            registerNode(task.id, node);
          }}
          role="treeitem"
          aria-level={level}
          aria-posinset={position}
          aria-setsize={setSize}
          /*
           * Named explicitly rather than from content. `treeitem` takes its name from its subtree
           * by default, and its subtree here contains every descendant task — so focusing a branch
           * would announce the whole tree under it. The status word is part of the name because a
           * coloured glyph is not information a screen reader can reach.
           */
          aria-label={`${task.label} — ${labels.taskTree.status[task.status]}`}
          aria-expanded={expandable ? expanded : undefined}
          tabIndex={task.id === activeId ? 0 : -1}
          onFocus={(event) => {
            // React's `onFocus` is `focusin`, which bubbles: without this guard a nested item
            // receiving focus would move the roving tab stop onto each of its ancestors in turn.
            if (event.target === event.currentTarget) onActivate(task.id);
          }}
        />
      )}
    >
      {expandable ? (
        <Collapsible.Root
          open={expanded}
          onOpenChange={(next) => {
            onToggle(task.id, next);
          }}
        >
          {row}
          <Collapsible.Panel>{panel}</Collapsible.Panel>
        </Collapsible.Root>
      ) : (
        row
      )}
    </WidgetPart>
  );
}

export function TaskTreeWidget(props: TaskTreeWidgetProps): ReactElement {
  const { messageId, payload, state, readonly, status } = props;
  const labels = useNereyLabels();

  const { state: persisted, setState } = useWidgetState<TaskTreeState>(messageId, state ?? EMPTY_STATE);

  // `payload?.` rather than `payload.`: while streaming the value is whatever has arrived so far
  // and has been through no schema at all (ADR 0019), so the declared type is a promise about the
  // finished object, not about this render.
  const tasks = useMemo(() => readTasks(payload?.tasks), [payload]);
  const toggled = useMemo<ReadonlySet<string>>(
    () => (persisted.toggled ? new Set(persisted.toggled) : NO_TOGGLES),
    [persisted.toggled],
  );

  const nodes = useMemo(() => {
    const out: TreeNode[] = [];
    flatten(tasks, toggled, 1, -1, out);
    return out;
  }, [tasks, toggled]);

  const byId = useMemo(() => {
    const map = new Map<string, Task>();
    indexTasks(tasks, map);
    return map;
  }, [tasks]);

  const counts = useMemo(() => {
    const totals = { total: 0, done: 0, failed: 0 };
    countTasks(tasks, totals);
    return totals;
  }, [tasks]);

  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerNode = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) nodesRef.current.set(id, node);
    else nodesRef.current.delete(id);
  }, []);

  /**
   * Resolved rather than stored, because the flat list changes under it: a stream adds rows, a
   * collapse removes them. If the remembered row is gone the tab stop falls back to the first one,
   * so the tree always has exactly one — a tree with none is unreachable by keyboard, and a tree
   * with several puts every row in the page's tab order, which is what the composite role exists
   * to avoid.
   */
  const activeIndex = Math.max(
    nodes.findIndex((node) => node.task.id === focusedId),
    0,
  );
  const activeId = nodes[activeIndex]?.task.id;

  /**
   * ADR 0018 — read-only means the terminal appearance and nothing fired. Collapsing is the one
   * thing this widget can do, so read-only makes the tree inert; the defaults already open every
   * branch and every failure, so nothing a reader needs is left behind a disclosure they cannot
   * work.
   */
  const interactive = !readonly;

  const setExpanded = useCallback(
    (id: string, next: boolean) => {
      if (!interactive) return;
      const task = byId.get(id);
      if (!task) return;

      setState((previous) => {
        const nextToggled = new Set(previous.toggled ?? []);
        // Recorded only where the reader disagrees with the default, so agreeing again clears the
        // entry rather than pinning it.
        if (next === expandedByDefault(task)) nextToggled.delete(id);
        else nextToggled.add(id);
        return { toggled: [...nextToggled] };
      });
    },
    [interactive, byId, setState],
  );

  const focusNode = useCallback((id: string | undefined) => {
    if (id === undefined) return;
    setFocusedId(id);
    nodesRef.current.get(id)?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const node = nodes[activeIndex];
      if (!node) return;

      const moveTo = (index: number): void => {
        focusNode(nodes[Math.min(Math.max(index, 0), nodes.length - 1)]?.task.id);
      };

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveTo(activeIndex + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveTo(activeIndex - 1);
          break;
        case 'Home':
          event.preventDefault();
          moveTo(0);
          break;
        case 'End':
          event.preventDefault();
          moveTo(nodes.length - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          // APG: the first press opens a closed node, the second walks into it. Splitting the two
          // is what lets a keyboard user survey a level without falling into every branch on it.
          if (!node.expandable) break;
          if (!node.expanded) setExpanded(node.task.id, true);
          else if (hasChildren(node.task)) moveTo(activeIndex + 1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          if (node.expandable && node.expanded) setExpanded(node.task.id, false);
          else moveTo(node.parentIndex >= 0 ? node.parentIndex : activeIndex);
          break;
        case 'Enter':
        case ' ':
          if (!node.expandable) break;
          event.preventDefault();
          setExpanded(node.task.id, !node.expanded);
          break;
        default:
          break;
      }
    },
    [nodes, activeIndex, focusNode, setExpanded],
  );

  const scope = useId();
  const titleId = `${scope}title`;
  const title = payload?.title ?? labels.taskTree.title;

  /**
   * `error` covers both a payload that arrived broken and a run that reported a failure. The second
   * is the useful one: a consumer styling `[data-nerey-widget='task-tree'][data-state='error']` is
   * asking "did this go wrong", and a tree with a failed task did — so it outranks `locked`, which
   * only says the host has stopped letting anyone touch this.
   */
  const rootState: NereyState =
    status === 'error' || counts.failed > 0 ? 'error' : readonly ? 'locked' : 'idle';

  return (
    <WidgetRoot
      type={TASK_TREE_TYPE}
      version={TASK_TREE_VERSION}
      slot={TASK_TREE_PLACEMENT.slot}
      status={status}
      state={rootState}
      readonly={readonly}
      className={styles.root}
      /*
       * `WidgetRoot` forwards a fixed prop list with no `{...rest}` (ADR 0021), so ARIA belonging
       * to this widget alone is attached here instead of widening the primitive for everyone.
       *
       * `role="group"` on a `<div>`, not a `<section>`: a named `<section>` is a `region` landmark,
       * and a widget dropped into someone else's transcript has no business adding a landmark to a
       * page whose structure it cannot see. `group` names the widget without claiming to be part
       * of the document's skeleton.
       */
      render={(rootProps) => <div {...rootProps} role="group" aria-labelledby={titleId} />}
    >
      {/*
       * A `<div>`, not a `<header>`. `<header>` outside `article`/`aside`/`main`/`nav`/`section` is
       * a `banner` landmark, and `role="group"` on the root above does not scope it away — so the
       * semantically tidier-looking element would announce this widget as the page's banner. The
       * region is already named for styling by `data-nerey-part="header"` (ADR 0020).
       */}
      <WidgetPart part="header" className={styles.header}>
        {/*
         * Not a heading. This widget is dropped into someone else's transcript, and it cannot see
         * the document outline it would be inserting a level into — an `<h3>` here is a guess that
         * is wrong in every host whose messages are already headed. The tree is named by
         * `aria-labelledby` instead, which needs no level to be correct.
         */}
        <Text id={titleId} as="p" weight="semibold">
          {title}
        </Text>
        {counts.total > 0 && (
          <Badge
            size="sm"
            tone={counts.failed > 0 ? 'danger' : counts.done === counts.total ? 'success' : 'neutral'}
          >
            {counts.failed > 0 ? `${counts.failed} failed` : `${counts.done}/${counts.total} done`}
          </Badge>
        )}
      </WidgetPart>

      {tasks.length > 0 ? (
        <WidgetPart
          part="tree"
          className={styles.tree}
          render={(partProps) => (
            <div {...partProps} role="tree" aria-labelledby={titleId} onKeyDown={onKeyDown} />
          )}
        >
          {tasks.map((task, index) => (
            <TaskNode
              key={task.id}
              task={task}
              level={1}
              position={index + 1}
              setSize={tasks.length}
              toggled={toggled}
              activeId={activeId}
              frozen={readonly}
              interactive={interactive}
              onToggle={setExpanded}
              onActivate={setFocusedId}
              registerNode={registerNode}
            />
          ))}
        </WidgetPart>
      ) : (
        status !== 'streaming' && (
          <WidgetPart part="empty" as="p" className={styles.empty}>
            No tasks were recorded for this run.
          </WidgetPart>
        )
      )}

      {status === 'streaming' && (
        /*
         * Outside the tree, not inside it. `role="tree"` may own only treeitems and groups, so a
         * status row among the rows would be an `aria-required-children` violation — and it would
         * also be a lie, because "still planning" is not a task.
         */
        <WidgetPart part="progress" className={styles.streaming}>
          <Spinner size="sm" label="Still planning" />
          <Text as="span" size="sm" tone="muted">
            Planning the remaining steps…
          </Text>
        </WidgetPart>
      )}
    </WidgetRoot>
  );
}
