/**
 * Toast notification system.
 *
 * Mount `<ToastProvider>` near the root (inside `ThemeProvider` is fine).
 * Trigger a toast from any descendant with `useToast().showToast(...)`.
 *
 * Toasts:
 * - auto-dismiss after `durationMs` (default 4000; pass 0 to keep open)
 * - render in a fixed bottom-right region with WCAG-compliant `role="status"`
 * - stack newest-on-top, with a max of 5 visible (oldest evicted)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToastContext, type Toast, type ToastKind } from "./toastContext";
import { strings } from "../i18n/en";

const MAX_VISIBLE = 5;
const DEFAULT_DURATION_MS = 4000;

/**
 * Provides toast state + the `showToast` API to descendants.
 * Renders the toast viewport itself (bottom-right by default).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  /* Track auto-dismiss timers so we can clear them on manual dismiss. */
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /*
   * Remove one toast by id and cancel its pending auto-dismiss timer (if any)
   * so it can't fire later and try to dismiss an already-gone toast.
   */
  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback<
    (
      toast: Omit<Toast, "id" | "durationMs"> & { durationMs?: number },
    ) => string
  >(
    (toast) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const durationMs = toast.durationMs ?? DEFAULT_DURATION_MS;
      setToasts((prev) => {
        const next = [...prev, { id, durationMs, ...toast }];
        /* Evict oldest beyond cap. */
        if (next.length > MAX_VISIBLE)
          next.splice(0, next.length - MAX_VISIBLE);
        return next;
      });
      if (durationMs > 0) {
        /*
         * durationMs === 0 is the "sticky" opt-out — only schedule auto-dismiss
         * for positive durations, and remember the handle so dismissToast/cleanup
         * can cancel it.
         */
        const timer = setTimeout(() => dismissToast(id), durationMs);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismissToast],
  );

  /*
   * Dismiss every toast at once (e.g. on route change / logout), cancelling
   * all outstanding auto-dismiss timers first so none linger after the reset.
   */
  const clearToasts = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setToasts([]);
  }, []);

  /* Cleanup all timers on unmount. */
  useEffect(() => {
    const timersMap = timers.current;
    return () => {
      for (const timer of timersMap.values()) clearTimeout(timer);
      timersMap.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ toasts, showToast, dismissToast, clearToasts }),
    [toasts, showToast, dismissToast, clearToasts],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

/**
 * The visible region where toasts render. Pinned bottom-right on desktop,
 * full-width across the bottom on mobile.
 */
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/** One toast card. Visual treatment driven by `kind`. */
function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const tone: Record<ToastKind, string> = {
    success:
      "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-100",
    error:
      "bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/60 dark:border-rose-800 dark:text-rose-100",
    info: "bg-brand-50 border-brand-200 text-brand-900 dark:bg-brand-950/60 dark:border-brand-800 dark:text-brand-100",
    warning:
      "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-100",
  };
  const icon: Record<ToastKind, string> = {
    success: "✓",
    error: "✕",
    info: "ℹ",
    warning: "⚠",
  };
  return (
    <div
      role={
        toast.kind === "error" || toast.kind === "warning" ? "alert" : "status"
      }
      className={
        "pointer-events-auto sm:w-80 max-w-md shadow-card border rounded-xl px-3 py-2 flex items-start gap-2 " +
        tone[toast.kind]
      }
    >
      <span aria-hidden className="font-semibold text-sm leading-5 mt-px">
        {icon[toast.kind]}
      </span>
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-semibold leading-5">{toast.title}</p>
        )}
        <p className="text-sm leading-5">{toast.message}</p>
      </div>
      <button
        type="button"
        aria-label={strings.toasts.dismiss}
        className="text-sm opacity-60 hover:opacity-100 transition-opacity"
        onClick={() => onDismiss(toast.id)}
      >
        ✕
      </button>
    </div>
  );
}
