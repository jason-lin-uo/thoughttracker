/**
 * Theme provider component.
 *
 * Resolves a tri-state user preference ("system" | "light" | "dark") against
 * the OS's `prefers-color-scheme` and exposes the result via `ThemeContext`.
 *
 * Three modes:
 * - "system" (default): follow prefers-color-scheme; live-update on changes
 * - "light": force light regardless of system
 * - "dark": force dark regardless of system
 *
 * Type/hook/context shape lives in `themeContext.ts` so Fast Refresh works
 * (the rule disallows mixing component and non-component exports in a file).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ThemeContext,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode,
} from "./themeContext";

/**
 * Read the stored mode from localStorage, falling back to "system".
 * Safe to call during SSR / before window is defined.
 */
function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/** True if the OS reports a dark color scheme preference right now. */
function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply the resolved theme to the document root (adds/removes `dark` class). */
function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.setAttribute("data-theme", resolved);
}

/**
 * Wraps the app and provides the `ThemeContext`. Persists user choice to
 * localStorage and live-updates when the OS preference changes (only when
 * `mode === "system"`).
 *
 * @param children - the rest of the app tree
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    systemPrefersDark(),
  );

  /* Track OS preference changes for "system" mode. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    /* Mirror live OS theme flips into state; only matters while mode === "system". */
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const resolved: ResolvedTheme =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  /*
   * Public setter exposed via context: update state and persist the choice so
   * it survives reloads (and is read back by the index.html boot script).
   */
  const setMode = (next: ThemeMode) => {
    setModeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    }
  };

  /*
   * Memoized context payload so consumers only re-render when the resolved
   * theme or mode actually changes (setMode is stable across renders).
   */
  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/*
 * NOTE: An inline boot script in index.html mirrors the theme resolution above
 * to prevent a flash of light-theme paint before React hydrates. If you change
 * THEME_STORAGE_KEY or the resolution algorithm here, update index.html too.
 */
