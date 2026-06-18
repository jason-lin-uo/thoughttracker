import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, NavLink } from "react-router-dom";
import clsx from "clsx";
import { strings } from "../i18n/en";
import { AppHeader } from "./AppHeader";
import { ThemeToggle } from "./ThemeToggle";
import {
  prefetchCommonRouteData,
  prefetchRouteData,
} from "../lib/routePrefetch";

/**
 * Primary navigation entries rendered in both the desktop sidebar and the
 * mobile drawer. Order here is the order users see in both places — moving
 * an entry up/down in this array moves it up/down in the chrome.
 *
 * Each entry is:
 * - `to`: react-router path the entry navigates to.
 * - `label`: human-readable string, sourced from the i18n dictionary so a
 * future locale swap doesn't require touching this file.
 * - `icon`: small emoji used as a visual anchor; rendered with
 * `aria-hidden` so screen-reader users only hear the label.
 *
 * The Compare entry between Creators and Videos is intentionally near the
 * creator-oriented entries so a recruiter scanning the nav understands it
 * as a creator workflow, not a video workflow.
 */
const NAV = [
  { to: "/", label: strings.nav.dashboard, icon: "📊" },
  { to: "/imports", label: strings.nav.imports, icon: "⬇️" },
  { to: "/add-creators", label: strings.nav.addCreators, icon: "➕" },
  { to: "/creators", label: strings.nav.creators, icon: "👤" },
  { to: "/compare", label: strings.nav.compare, icon: "⚖️" },
  { to: "/videos", label: strings.nav.videos, icon: "🎬" },
  { to: "/topics", label: strings.nav.topics, icon: "🏷️" },
  { to: "/evidence", label: strings.nav.evidence, icon: "📌" },
  { to: "/reports", label: strings.nav.reports, icon: "📑" },
];

/**
 * AppLayout — the top-level chrome wrapping every routed page.
 *
 * Responsibilities:
 * - Render a persistent sidebar on `lg+` viewports and a sticky top bar +
 * slide-in drawer on smaller viewports. The two navigation surfaces share
 * the same `NAV` array so they never drift out of sync.
 * - Provide the "Skip to main content" accessibility shortcut as the very
 * first focusable element, so keyboard + screen-reader users can bypass
 * the navigation on every page load (WCAG 2.1 SC 2.4.1).
 * - Render the full-width `<AppHeader>` brand banner at the top of the
 * content column on `lg+` viewports (it's `hidden lg:block`, so on mobile
 * the top bar owns the chrome and no second header row stacks). The banner
 * carries the wordmark + global actions (search, add-creator, theme toggle).
 * - Host the main content region (`<main id="main">`) where each routed
 * page renders its children. `tabIndex={-1}` lets the skip link
 * programmatically move focus into the region without making it part of
 * the normal tab order.
 * - Constrain the content column to `max-w-[1400px]` so long reports and
 * transcript dumps stay readable on ultra-wide monitors.
 *
 * This component does NOT own routing, theme state, toasts, or React Query
 * — those providers wrap AppLayout from `main.tsx`. AppLayout's job is
 * purely chrome + accessibility scaffolding.
 *
 * @param props.children - The routed page content (one of the
 * `<Route element={...} />` payloads from `App.tsx`).
 * @returns A full-viewport flex container that holds the navigation,
 * the mobile drawer, the skip link, and the main content region.
 */
export function AppLayout({ children }: { children: ReactNode }) {
  /*
   * Mobile drawer open/closed state. Lives at the layout level (not the
   * top bar) so the overlay backdrop and the drawer body can share it.
   */
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const id = window.setTimeout(
      () => prefetchCommonRouteData(queryClient),
      800,
    );
    return () => window.clearTimeout(id);
  }, [queryClient]);

  function prefetch(to: string) {
    prefetchRouteData(queryClient, to);
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/*
       * "Skip to main content" link — visually hidden by `sr-only` until it
       * receives keyboard focus, at which point it pops into the top-left
       * corner so the user can press Enter to jump straight into the
       * routed page. Without this, keyboard users would have to tab past
       * 8 nav links on every navigation.
       */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-3 focus:py-2 focus:bg-brand-600 focus:text-white focus:rounded-md"
      >
        {strings.brand.skipToContent}
      </a>

      {/* Persistent desktop sidebar — hidden on small screens via Tailwind's `lg:` breakpoint. */}
      <Sidebar onPrefetch={prefetch} />

      {/* Mobile top bar + slide-in drawer — mirror images of the desktop chrome. */}
      <MobileTopBar open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <MobileDrawer onClose={() => setOpen(false)} onPrefetch={prefetch} />
      )}

      {/* Content column: a full-width brand banner across the top, then the
 padded, width-constrained page content below it. */}
      <div className="flex-1 flex flex-col min-w-0">
        <AppHeader />
        <main
          id="main"
          tabIndex={-1}
          className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-[1400px] w-full mx-auto"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Sidebar — the persistent navigation column shown on `lg+` viewports
 * (≥1024 px). Renders the full brand lockup (the "T" mark + "ThoughtTracker"
 * wordmark + tagline) in the top-left corner — the conventional product-identity
 * anchor, so the corner doesn't read as empty — and the primary nav list.
 * Footer: a restrained authorship line for portfolio context without adding
 * another product wordmark.
 *
 * Visibility is controlled by Tailwind's `hidden lg:flex` pair so the
 * sidebar never appears on small screens — the mobile drawer takes over
 * there. Background is the brand-dark `ink-900` palette (with a deeper
 * `ink-950` in dark mode) so the chrome reads as distinct from the
 * white-ish content area in both themes.
 */
function Sidebar({ onPrefetch }: { onPrefetch: (to: string) => void }) {
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-ink-900 text-ink-100 px-5 py-7 dark:bg-ink-950 dark:border-r dark:border-ink-800">
      <Brand />
      <nav className="mt-8 flex flex-col gap-1" aria-label="Primary">
        {NAV.map((item) => (
          <NavItem key={item.to} {...item} onPrefetch={onPrefetch} />
        ))}
      </nav>
      <p className="mt-auto pt-6 text-xs text-ink-300">
        {strings.brand.authorByline}
      </p>
    </aside>
  );
}

/**
 * MobileTopBar — the sticky header shown on screens narrower than `lg`.
 *
 * The desktop AppHeader banner is hidden below `lg`, so this bar is the ONLY
 * chrome row on mobile — it owns the brand mark (left) plus the theme toggle
 * and hamburger (right). Keeping the theme toggle here (rather than only in the
 * hidden banner) means dark/light is reachable on mobile without opening the
 * drawer; search + Add Creators live in the drawer nav. Hamburger announces its
 * expanded state via `aria-expanded` and points at the drawer via
 * `aria-controls` so assistive tech can convey the relationship.
 *
 * @param props.open - Whether the mobile drawer is currently open.
 * Drives the icon swap (☰ ↔ ✕) and the aria-label.
 * @param props.onToggle - Fires when the user activates the hamburger;
 * parent layout flips the `open` state.
 */
function MobileTopBar({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="lg:hidden flex items-center justify-between bg-ink-900 text-ink-100 px-4 py-3 sticky top-0 z-30 dark:bg-ink-950">
      <Brand compact />
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <button
          type="button"
          className="p-2 -mr-2 rounded-md hover:bg-ink-800"
          aria-label={open ? strings.brand.closeNav : strings.brand.openNav}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={onToggle}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>
    </div>
  );
}

/**
 * MobileDrawer — the slide-in navigation panel shown on screens narrower
 * than `lg` when the hamburger has been activated.
 *
 * Layout is a full-viewport overlay with two layers:
 * 1. A dark, semi-transparent backdrop that closes the drawer on click.
 * Implemented as a `<button>` (not a `<div>`) so it's reachable by
 * keyboard and announced as interactive. The cursor is forced to
 * `cursor-default` so it doesn't look like a button visually.
 * 2. A right-aligned `<aside>` containing the same brand + nav list as
 * the desktop sidebar.
 *
 * Each nav item is given an `onClick` that closes the drawer, so tapping
 * a destination both navigates AND collapses the panel in one gesture.
 *
 * Accessibility (it's a modal dialog, so it must trap focus):
 * - Rendered as `role="dialog" aria-modal="true"`.
 * - On open, focus moves into the panel (first nav link).
 * - Escape closes the drawer.
 * - Tab / Shift+Tab cycle within the panel's focusable elements (focus
 * trap) so keyboard users can't tab out into the obscured page behind it.
 * - On close, focus returns to whatever was focused before opening
 * (the hamburger toggle), per WCAG 2.4.3 (Focus Order).
 *
 * @param props.onClose - Fires when the user dismisses the drawer (backdrop
 * click, Escape, or selecting a nav item). Parent
 * layout flips `open` to false.
 */
function MobileDrawer({
  onClose,
  onPrefetch,
}: {
  onClose: () => void;
  onPrefetch: (to: string) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  /*
   * Focus management: capture the previously-focused element, move focus
   * into the drawer, restore it on unmount, and wire Escape + Tab-trap.
   */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    /* Collect the drawer's focusable elements (links + buttons). */
    const getFocusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    /* Move focus into the panel on open. */
    getFocusable()[0]?.focus();

    /* Escape closes the drawer; Tab/Shift+Tab wrap focus within it. */
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      /*
       * Tab trap: wrap focus around the first/last focusable element so it
       * never escapes the open drawer.
       */
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      /* Return focus to the trigger so the user lands back where they were. */
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="lg:hidden fixed inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-label={strings.brand.navMenu}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 w-full h-full cursor-default"
        onClick={onClose}
        aria-label={strings.brand.closeNav}
      />
      <aside
        ref={panelRef}
        id="mobile-nav"
        className="absolute right-0 top-0 bottom-0 w-72 bg-ink-900 text-ink-100 p-5 dark:bg-ink-950"
      >
        <Brand onClick={onClose} />
        <nav className="mt-6 flex flex-col gap-1" aria-label="Primary">
          {NAV.map((item) => (
            <NavItem
              key={item.to}
              {...item}
              onClick={onClose}
              onPrefetch={onPrefetch}
            />
          ))}
        </nav>
        <p className="mt-8 text-xs text-ink-300">
          {strings.brand.authorByline}
        </p>
      </aside>
    </div>
  );
}

/**
 * Brand — the "T" mark + wordmark/tagline lockup, used by the desktop sidebar,
 * the mobile top bar, and the mobile drawer.
 *
 * Like the AppHeader banner's brand, the whole lockup is a `<Link to="/">` — a
 * click anywhere on the mark, name, or tagline returns home to the dashboard.
 * Layout: the mark sits on the same row as the wordmark (so they line up), with
 * the tagline on its own line underneath. The sidebar deliberately carries the
 * wordmark in the top-left corner (the conventional product-identity anchor)
 * even though the banner shows it too; both placements are intentional. The
 * vestigial THIRD copy (the old sidebar footer) is the only one we dropped.
 *
 * @param props.compact - When `true`, render only the mark (no name/tagline).
 * Used by the mobile top bar where horizontal space is
 * tight and the hamburger needs to sit on the right.
 * @param props.onClick - Optional click handler fired alongside navigation —
 * the mobile drawer passes its `onClose` so tapping the
 * brand both navigates home AND collapses the drawer.
 */
function Brand({
  compact,
  onClick,
}: { compact?: boolean; onClick?: () => void } = {}) {
  return (
    <Link
      to="/"
      onClick={onClick}
      aria-label={strings.brand.name}
      className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-brand-600 grid place-items-center text-white text-lg font-bold transition-colors group-hover:bg-brand-500">
          T
        </div>
        {!compact && (
          <p className="font-semibold text-base text-white">
            {strings.brand.name}
          </p>
        )}
      </div>
      {!compact && (
        <p className="mt-1 text-xs text-ink-400">{strings.brand.tagline}</p>
      )}
    </Link>
  );
}

/**
 * NavItem — a single entry in the primary navigation list, shared between
 * the desktop sidebar and the mobile drawer.
 *
 * Renders a React-Router `<NavLink>` so the entry's active state is
 * driven by the current URL (no manual `location.pathname` comparison
 * needed). The `end={to === "/"}` exception ensures the Dashboard entry
 * only highlights for the exact "/" route — without it, every page would
 * match the prefix `/` and the Dashboard entry would never deactivate.
 *
 * Active state is conveyed visually (brand background) and via
 * `<NavLink>`'s built-in `aria-current="page"` attribute (no extra ARIA
 * needed). The icon is given `aria-hidden` so screen readers announce
 * only the label, not the emoji name.
 *
 * @param props.to - Destination path (`/`, `/imports`, etc.).
 * @param props.label - Visible nav text from the i18n dictionary.
 * @param props.icon - Emoji rendered before the label for visual anchoring.
 * @param props.onClick - Optional callback fired when the entry is tapped.
 * Used by the mobile drawer to close itself after
 * a navigation; ignored by the desktop sidebar.
 * @param props.onPrefetch - Warms the destination page's first API payload.
 */
function NavItem({
  to,
  label,
  icon,
  onClick,
  onPrefetch,
}: {
  to: string;
  label: string;
  icon: string;
  onClick?: () => void;
  onPrefetch: (to: string) => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      onFocus={() => onPrefetch(to)}
      onMouseEnter={() => onPrefetch(to)}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
          isActive
            ? "bg-brand-600 text-white"
            : "text-ink-300 hover:text-white hover:bg-ink-800",
        )
      }
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}
