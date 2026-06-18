/**
 * Theme context + types + `useTheme` hook.
 *
 * Lives in its own file (separate from `ThemeProvider.tsx`) so React Fast
 * Refresh stays happy — that lint rule requires each file to export ONLY
 * components OR only non-components, not both.
 */

import { createContext, useContext } from "react";

/** Tri-state user theme preference; "system" defers to OS. */
export type ThemeMode = "system" | "light" | "dark";

/** The actual scheme painted on screen at any given moment. */
export type ResolvedTheme = "light" | "dark";

/** Shape of the value provided by `ThemeProvider`. */
export interface ThemeContextValue {
  /** What the user picked ("system" | "light" | "dark"). */
  mode: ThemeMode;
  /** What's actually painted right now after resolving "system". */
  resolved: ResolvedTheme;
  /** Persist a new mode to localStorage and re-render. */
  setMode: (mode: ThemeMode) => void;
}

/** LocalStorage key under which the user's chosen mode is persisted. */
export const THEME_STORAGE_KEY = "thoughttracker.theme";

/** Context instance; `ThemeProvider` mounts the value. */
export const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Returns the current theme mode + resolved scheme + setter.
 * Throws if used outside `<ThemeProvider>`.
 *
 * @returns the current `ThemeContextValue`
 * @throws when called outside a `ThemeProvider`
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
