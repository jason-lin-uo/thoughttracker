/**
 * Toast context + types + the `useToast` hook.
 *
 * Lives in its own file (separate from `ToastProvider.tsx`) so React Fast
 * Refresh stays clean — the lint rule disallows mixing component and
 * non-component exports in the same module.
 */

import { createContext, useContext } from "react";

/** Visual severity of a toast. Drives icon + color scheme. */
export type ToastKind = "success" | "error" | "info" | "warning";

/** A single toast instance, as held in the provider's internal state. */
export interface Toast {
  /** Stable identifier; used as React key and for dismissal. */
  id: string;
  /** Severity → icon + colour. */
  kind: ToastKind;
  /** Optional short heading (bold). */
  title?: string;
  /** Body text. */
  message: string;
  /** Auto-dismiss timeout in ms. `0` keeps it open until dismissed manually. */
  durationMs: number;
}

/** Shape of the value provided by `ToastProvider`. */
export interface ToastContextValue {
  /** Currently visible toasts (oldest first). */
  toasts: Toast[];
  /**
   * Enqueue a new toast. Returns its id so the caller can dismiss it
   * programmatically.
   *
   * @param toast - subset of `Toast` fields; `id` and `durationMs` defaulted
   * @returns the generated toast id
   */
  showToast: (
    toast: Omit<Toast, "id" | "durationMs"> & { durationMs?: number },
  ) => string;
  /** Remove a specific toast by id. No-op if not found. */
  dismissToast: (id: string) => void;
  /** Remove every visible toast. */
  clearToasts: () => void;
}

/**
 * Toast primitive: toast context.
 */
export const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Returns the toast API: `{ toasts, showToast, dismissToast, clearToasts }`.
 *
 * @throws when called outside a `ToastProvider`
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
