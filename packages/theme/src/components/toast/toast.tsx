import { Fragment, useMemo } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { Toast as BaseToast } from '@base-ui/react/toast';

import { AlertCircleIcon, AlertTriangleIcon, CheckIcon, CloseIcon, InfoIcon } from '../icons/icons';
import styles from './toast.module.css';

/**
 * Transient notifications: a provider, a portalled viewport, and one card per live toast.
 *
 * ADR 0022 — Base UI owns the queue, the timers, the `role="region"` live area, swipe-to-dismiss
 * and the F6 focus jump. Nerey owns the prop surface and every pixel, and exposes NONE of Base's
 * types: `ToastItem` is an opaque handle carrying only `id`, because everything a caller could
 * read off it is already rendered by `Toast.Title` and `Toast.Description`, which read it
 * themselves. Keeping it opaque is what lets the vendor be swapped without a major release.
 *
 * `tone` is carried as Base UI's toast `type`, which surfaces as `data-type` on Root, Title,
 * Description, Action and Close — so the stylesheet keys off the vendor's own state attribute
 * rather than a parallel class this component would have to keep in step. Nerey's contribution is
 * the closed `ToastTone` union: `type` is a free-form string in Base, and a free-form string is
 * how a design system ends up with `success`, `Success` and `ok` all in production.
 *
 * Two ways to push a toast, and both are here on purpose:
 *   - `useToastManager()` inside the tree, for a component that has one.
 *   - `createToastManager()` outside it, for the code that does not — which is the case that
 *     matters here, because the overlay slot of ADR 0017 is fed by the runtime, not by a
 *     component's own event handler.
 */

export type ToastTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** The label on `Toast.Close` when the caller supplies none. Exported so it can be translated. */
export const DEFAULT_TOAST_CLOSE_LABEL = 'Dismiss notification';

/** The name of the live region. Exported for the same reason. */
export const DEFAULT_TOAST_VIEWPORT_LABEL = 'Notifications';

export type ToastActionOptions = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  title?: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds before the toast dismisses itself. `0` keeps it until it is dismissed. */
  timeout?: number;
  /** `high` announces assertively, interrupting the screen reader. Reserve it for failures. */
  priority?: 'low' | 'high';
  /** Reusing an existing id updates that toast in place and restarts its timer. */
  id?: string;
  /** A single button inside the toast. More than one and it is a dialog, not a notification. */
  action?: ToastActionOptions;
  onClose?: () => void;
};

/**
 * A live toast. Deliberately opaque: hand it straight back to `<Toast.Root toast={…}>` and use
 * `id` as the React key. Nothing else on it is public, so nothing else can become a contract.
 */
export type ToastItem = {
  readonly id: string;
};

export type ToastManager = {
  /** Queues a toast and returns its id. */
  add: (options: ToastOptions) => string;
  /** Closes one toast, or every toast when the id is omitted. */
  close: (id?: string) => void;
  /** Merges new options into a live toast, restarting its timer. */
  update: (id: string, options: ToastOptions) => void;
};

/**
 * Base UI's manager and hook are generic over a custom `data` payload, defaulting to `any`. Nerey
 * carries no payload, so the parameter is pinned to an empty record — which costs nothing and
 * keeps `any` out of every type derived from these two (ADR 0003).
 */
type ToastData = Record<string, never>;

function createBaseManager() {
  return BaseToast.createToastManager<ToastData>();
}

type BaseToastManager = ReturnType<typeof createBaseManager>;
type BaseAddOptions = Parameters<BaseToastManager['add']>[0];

/**
 * Nerey's manager is a facade, so the Base UI object behind it has to be findable again when the
 * provider mounts. A WeakMap keeps the association out of the public type — the alternative,
 * hanging the vendor object off a property, would put it in every consumer's autocomplete and
 * make it a de-facto part of the API within one release.
 */
const BASE_MANAGERS = new WeakMap<ToastManager, BaseToastManager>();

function toBaseOptions({ tone, action, ...rest }: ToastOptions): BaseAddOptions {
  return {
    ...rest,
    type: tone,
    // `actionProps` is a raw button prop bag in Base UI. Nerey narrows it to a label and a
    // handler: routing `className` and `style` back in through a nested object would undo
    // ADR 0026 for the one element that sits furthest from review.
    actionProps: action ? { children: action.label, onClick: action.onClick } : undefined,
  };
}

/**
 * Creates a manager that can be called from outside React — a runtime, a store subscription, an
 * error boundary's reporter. Pass it to `<Toast.Provider manager={…}>`.
 *
 * It deliberately has no `toasts` array. Rendering is React's job, and a manager that exposed a
 * mutable list would invite a second, stale source of truth alongside the one the viewport reads.
 */
export function createToastManager(): ToastManager {
  const base = createBaseManager();

  const manager: ToastManager = {
    add: (options) => base.add(toBaseOptions(options)),
    close: (id) => {
      base.close(id);
    },
    update: (id, options) => {
      base.update(id, toBaseOptions(options));
    },
  };

  BASE_MANAGERS.set(manager, base);
  return manager;
}

/** The same three methods, for a component that is already inside the provider. */
export function useToastManager(): ToastManager {
  const base = BaseToast.useToastManager<ToastData>();
  const { add, close, update } = base;

  return useMemo<ToastManager>(
    () => ({
      add: (options) => add(toBaseOptions(options)),
      close: (id) => {
        close(id);
      },
      update: (id, options) => {
        update(id, toBaseOptions(options));
      },
    }),
    [add, close, update],
  );
}

type NativeDivProps = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'color'>;
type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'color'>;

export type ToastProviderProps = {
  /** A manager from `createToastManager()`, for pushes that originate outside React. */
  manager?: ToastManager;
  /** Default milliseconds before auto-dismiss. `0` disables it for every toast. */
  timeout?: number;
  /** How many toasts show at once. The rest are marked `data-limited`, not dropped. */
  limit?: number;
  children?: ReactNode;
};

export type ToastPortalProps = {
  /** Where the viewport is mounted. Defaults to `document.body`. */
  container?: HTMLElement | null;
  children?: ReactNode;
};

export type ToastViewportProps = Omit<NativeDivProps, 'aria-label'> & {
  /** Names the live region. */
  label?: string;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type ToastListProps = {
  /** Renders one toast. Omit it for the standard card. */
  children?: (toast: ToastItem) => ReactNode;
};

export type ToastRootProps = NativeDivProps & {
  toast: ToastItem;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type ToastTitleProps = Omit<HTMLAttributes<HTMLHeadingElement>, 'className' | 'style' | 'color'> & {
  ref?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
};

export type ToastDescriptionProps = Omit<
  HTMLAttributes<HTMLParagraphElement>,
  'className' | 'style' | 'color'
> & {
  ref?: Ref<HTMLParagraphElement>;
  children?: ReactNode;
};

export type ToastActionProps = NativeButtonProps & {
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

export type ToastCloseProps = Omit<NativeButtonProps, 'aria-label' | 'aria-labelledby'> & {
  /** The button's accessible name. It has none of its own — its content is a glyph. */
  label?: string;
  ref?: Ref<HTMLButtonElement>;
};

const TONE_ICON: Record<ToastTone, ReactElement> = {
  neutral: <InfoIcon />,
  accent: <InfoIcon />,
  success: <CheckIcon />,
  warning: <AlertTriangleIcon />,
  danger: <AlertCircleIcon />,
};

const TONES = new Set<string>(['neutral', 'accent', 'success', 'warning', 'danger']);

function isTone(value: unknown): value is ToastTone {
  return typeof value === 'string' && TONES.has(value);
}

/**
 * Reads the tone back off a live toast.
 *
 * The parameter is structural rather than `ToastItem` so that the `type` field — Base UI's, and
 * not part of Nerey's public handle — can be read without a cast. An unrecognised value falls
 * back to `neutral` rather than throwing: a toast is usually what the system says when something
 * has already gone wrong, and a second failure on top of the first helps nobody.
 */
function toneOf(toast: { id: string; type?: unknown }): ToastTone {
  return isTone(toast.type) ? toast.type : 'neutral';
}

function ToastProvider({ manager, timeout, limit, children }: ToastProviderProps): ReactElement {
  return (
    <BaseToast.Provider timeout={timeout} limit={limit} toastManager={manager && BASE_MANAGERS.get(manager)}>
      {children}
    </BaseToast.Provider>
  );
}

function ToastPortal({ container, children }: ToastPortalProps): ReactElement {
  return <BaseToast.Portal container={container}>{children}</BaseToast.Portal>;
}

function ToastViewport({
  label = DEFAULT_TOAST_VIEWPORT_LABEL,
  children,
  ref,
  ...rest
}: ToastViewportProps): ReactElement {
  return (
    <BaseToast.Viewport ref={ref} aria-label={label} className={styles.viewport} {...rest}>
      {children}
    </BaseToast.Viewport>
  );
}

function defaultToast(toast: ToastItem): ReactNode {
  return (
    <ToastRoot toast={toast}>
      <ToastTitle />
      <ToastDescription />
      <ToastAction />
      <ToastClose />
    </ToastRoot>
  );
}

/**
 * Maps the live queue onto elements. This part is Nerey's, not Base UI's: the alternative is that
 * every consumer writes the same `toasts.map()` and the same `key={toast.id}`, and forgetting the
 * key produces a toast that inherits the previous one's exit animation — a bug that only shows up
 * when two arrive close together.
 */
function ToastList({ children = defaultToast }: ToastListProps): ReactElement {
  const { toasts } = BaseToast.useToastManager<ToastData>();

  return (
    <>
      {toasts.map((toast) => (
        <Fragment key={toast.id}>{children(toast)}</Fragment>
      ))}
    </>
  );
}

function ToastRoot({ toast, children, ref, ...rest }: ToastRootProps): ReactElement {
  return (
    <BaseToast.Root ref={ref} toast={toast} className={styles.root} {...rest}>
      <BaseToast.Content className={styles.content}>
        {/* The glyph is `aria-hidden` and carries no information a screen reader loses: the tone
            is already in the wording, and `priority: 'high'` is what makes urgency audible. */}
        <span className={styles.icon}>{TONE_ICON[toneOf(toast)]}</span>
        {children}
      </BaseToast.Content>
    </BaseToast.Root>
  );
}

function ToastTitle({ children, ref, ...rest }: ToastTitleProps): ReactElement {
  return (
    <BaseToast.Title ref={ref} className={styles.title} {...rest}>
      {children}
    </BaseToast.Title>
  );
}

function ToastDescription({ children, ref, ...rest }: ToastDescriptionProps): ReactElement {
  return (
    <BaseToast.Description ref={ref} className={styles.description} {...rest}>
      {children}
    </BaseToast.Description>
  );
}

function ToastAction({ children, ref, ...rest }: ToastActionProps): ReactElement {
  return (
    <BaseToast.Action ref={ref} className={styles.action} {...rest}>
      {children}
    </BaseToast.Action>
  );
}

function ToastClose({ label = DEFAULT_TOAST_CLOSE_LABEL, ref, ...rest }: ToastCloseProps): ReactElement {
  return (
    <BaseToast.Close
      ref={ref}
      aria-label={label}
      /*
       * Base UI sets `aria-hidden` on this button until the viewport is hovered or the button
       * itself takes focus, so that the live region does not read out a control nobody asked
       * about. Nerey removes it, and the reason is not cosmetic: Base leaves the button
       * `tabindex="0"` throughout, which means a keyboard user can Tab to a control that
       * assistive technology has been told is not there — a WCAG 4.1.2 failure that axe reports
       * as `aria-hidden-focus` and ADR 0032 fails the build over. Base repairs it on focus, but
       * the resting state is the state that gets evaluated, and the resting state is wrong. The
       * cost is one extra phrase in the announcement, which is what every other toast
       * implementation reads out too.
       */
      aria-hidden={undefined}
      className={styles.close}
      {...rest}
    >
      <CloseIcon />
    </BaseToast.Close>
  );
}

export const Toast = {
  Provider: ToastProvider,
  Portal: ToastPortal,
  Viewport: ToastViewport,
  List: ToastList,
  Root: ToastRoot,
  Title: ToastTitle,
  Description: ToastDescription,
  Action: ToastAction,
  Close: ToastClose,
} as const;
