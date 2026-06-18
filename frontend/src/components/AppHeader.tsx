import { Link } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";
import { strings } from "../i18n/en";

/**
 * AppHeader — the full-width brand banner across the top of every page.
 *
 * Spans the content column edge-to-edge (a banner, not a floating card) and is
 * the page's primary identity: the "ThoughtTracker" wordmark is sized LARGER
 * than any per-page title so the eye lands on the product first. The background
 * is neutral with a slim amber accent keyline along the bottom — the navy
 * wordmark carries the color, and amber stays reserved for "caution" meaning
 * elsewhere (AI disclaimer / caveats) rather than washing the whole bar. The
 * always-reachable actions sit on the right: the primary create action and
 * the light/dark toggle. Desktop-only (`lg:`): on
 * mobile the existing top bar owns the chrome, so we never stack two header rows.
 */
export function AppHeader() {
  return (
    <header className="hidden border-b-2 border-amber-400 bg-white py-4 lg:block dark:border-amber-500/70 dark:bg-ink-950">
      {/* The horizontal padding + max-width live on the INNER row (not the
 <header>) so the wordmark's left edge lines up exactly with the page
 content's gridline below — <main> uses the same `max-w-[1400px] mx-auto`
 + `px` combo. The bar background and amber keyline still span the full
 column width because the <header> itself has no horizontal padding. */}
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-10">
        {/* Brand lockup — links home; sized to be the most prominent thing on the page. */}
        <Link to="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white shadow-sm">
            T
          </span>
          <span className="bg-gradient-to-r from-brand-700 via-brand-500 to-brand-400 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent sm:text-3xl dark:from-brand-300 dark:via-brand-300 dark:to-brand-500">
            {strings.brand.name}
          </span>
        </Link>

        {/* Always-reachable actions, right-aligned. */}
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/add-creators"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400"
          >
            <span aria-hidden>＋</span>
            <span className="hidden sm:inline">
              {strings.header.addCreator}
            </span>
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
