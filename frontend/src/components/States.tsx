import type { ReactNode } from "react";
import clsx from "clsx";
import { strings } from "../i18n/en";

/**
 * Field — an accessible form-field wrapper that pairs a visible label with
 * the input that owns it. Renders as a real `<label>` element so the
 * browser handles focus delegation natively (clicking the label focuses
 * the input it wraps), with no need for callers to thread `htmlFor`/`id`
 * pairs through every form.
 *
 * Visual style: small all-caps label sits above the input with subtle
 * tracking, matching the muted "section eyebrow" treatment used elsewhere
 * in the app. Both light and dark mode tones are baked in.
 *
 * Use this for every form input across the app to keep WCAG 1.3.1 (info
 * & relationships) and 3.3.2 (labels or instructions) compliance baked
 * in — manual `<label htmlFor>` pairing is too easy to break in a refactor.
 *
 * @param props.label - The visible label text shown above the input.
 * @param props.children - The input element(s) wrapped by the label.
 * Typically a single `<input>`, `<select>`, or
 * `<textarea>` with our shared `.input` class.
 * @param props.className - Optional extra Tailwind classes for the
 * wrapping `<label>` (e.g. to set grid placement).
 */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="block text-xs font-medium text-ink-600 mb-1 uppercase tracking-wide dark:text-ink-400">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Skeleton — a low-contrast placeholder block used while a query is
 * loading. Reduces the "blank page → snap to content" jank that's
 * especially obvious on slow networks or cold-started backends.
 *
 * Implementation detail: `aria-hidden` is set so screen readers skip
 * the placeholders entirely — they don't add information, and announcing
 * empty boxes is just noise. The pulsing animation is purely visual.
 *
 * @param props.className - Tailwind sizing classes (e.g. `h-5 w-2/3`).
 * Without these the skeleton has no dimensions
 * and is invisible — callers MUST size them.
 * @param props.rounded - Tailwind corner-radius utility. Defaults to
 * `rounded-md`; pass `rounded-full` for avatar
 * placeholders or `rounded-none` for chart bars.
 */
export function Skeleton({
  className,
  rounded = "rounded-md",
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      aria-hidden
      className={clsx(
        "animate-pulse bg-ink-200 dark:bg-ink-800",
        rounded,
        className,
      )}
    />
  );
}

/**
 * CardSkeleton — a pre-composed Skeleton arranged to look like a typical
 * card (title bar + a few body rows). Drop into a grid in place of a real
 * card while the underlying query is loading.
 *
 * @param props.lines - How many body rows to render below the title.
 * Defaults to 3, matching most of our card layouts.
 * Pass a smaller number for compact cards.
 */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card card-pad space-y-3">
      <Skeleton className="h-5 w-2/3" />
      {Array.from({ length: lines }).map((_, i) => (
        /*
         * Index is fine here: skeleton rows are never reordered, added,
         * or removed once mounted — they exist only for the loading
         * tick before real data arrives.
         */
        // eslint-disable-next-line react/no-array-index-key
        <Skeleton key={`skel-${i}`} className="h-3 w-full" />
      ))}
    </div>
  );
}

/**
 * LoadingState — a friendly "still working…" panel rendered when the
 * caller can't easily decide which Skeleton shape to use, or when the
 * loading state is intentionally minimal.
 *
 * Accessibility:
 * - `role="status"` + `aria-live="polite"` cause screen readers to
 * announce the label once when it appears, without interrupting any
 * ongoing speech.
 *
 * @param props.label - Override the default "Loading…" copy when the
 * context warrants something more specific (e.g.
 * "Generating report…"). Sourced from i18n by default.
 */
export function LoadingState({
  label = strings.common.loading,
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="card card-pad flex items-center justify-center text-ink-500 dark:text-ink-400 text-sm py-10"
    >
      <span className="animate-pulse">{label}</span>
    </div>
  );
}

/**
 * EmptyState — a centered card shown when a query succeeded but returned
 * zero rows. Designed to feel encouraging, not apologetic: lead with what
 * the user can DO (the CTA), not what's missing.
 *
 * Visual layout: optional emoji icon at the top, bold title, optional
 * muted description, then an optional CTA button/link below. Every piece
 * except the title is opt-in so callers can pick the right level of
 * scaffolding for their context (a sparse filter result vs a freshly
 * provisioned account with no data yet).
 *
 * @param props.title - Headline (required). Keep it short and human:
 * "No creators yet" beats "Empty result set".
 * @param props.description - Optional muted line explaining what's missing
 * and how to populate it.
 * @param props.cta - Optional CTA element (usually `<Link>` or
 * `<button>`) that gives the user a next step.
 * @param props.icon - Optional emoji rendered above the title for
 * quick visual recognition (👤 for creators,
 * 📌 for evidence, 📑 for reports, etc.).
 */
export function EmptyState({
  title,
  description,
  cta,
  icon,
}: {
  title: string;
  description?: string;
  cta?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="card card-pad text-center py-12">
      {icon && (
        <div className="text-3xl mb-2" aria-hidden>
          {icon}
        </div>
      )}
      <p className="font-semibold text-ink-900 dark:text-ink-100">{title}</p>
      {description && (
        <p className="text-ink-600 dark:text-ink-400 mt-1 text-sm">
          {description}
        </p>
      )}
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}

/**
 * ErrorState — a card surfaced when a React Query failed, sized to slot
 * into the same grid position the successful content would have occupied.
 * Visual tone is rose/red so the user reads "something's wrong here"
 * without diving into the message text.
 *
 * Accessibility:
 * - `role="alert"` so screen readers announce the failure immediately,
 * interrupting any other speech (which is correct for errors —
 * quietly polite would be wrong here).
 *
 * @param props.message - Human-readable error text from the caught
 * `Error.message` or our typed `ApiError`. We do
 * NOT show stack traces or error codes to users.
 * @param props.onRetry - Optional retry callback. When provided, renders
 * a "Try again" button. Typically wired to the
 * underlying React Query `refetch` function.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="card card-pad border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200"
    >
      <p className="font-semibold">{strings.common.somethingWentWrong}</p>
      <p className="text-sm mt-1">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-3">
          {strings.common.tryAgain}
        </button>
      )}
    </div>
  );
}

/**
 * PageHeader — the H1 + optional subtitle + optional action buttons block
 * that opens every routed page. Centralized here so every page lands with
 * the same visual rhythm: title on the left, primary actions on the right
 * on desktop; stacked on mobile.
 *
 * Always render the H1 via this component (never an inline `<h1>` in a
 * page) so the document outline stays well-formed across the whole app
 * (one H1 per page, all pages share the same H1 styles).
 *
 * @param props.title - The page's H1 text (required).
 * @param props.subtitle - Optional explainer below the title. Accepts a
 * ReactNode so pages can compose it from
 * formatted dates + counts + links.
 * @param props.actions - Optional CTA cluster shown to the right of the
 * title (above the title on mobile). Pass a
 * `<>` fragment containing as many buttons or
 * links as needed.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink-900 dark:text-ink-50">
          {title}
        </h1>
        {subtitle && (
          <p className="text-ink-600 dark:text-ink-400 mt-1 text-sm sm:text-base">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * AiNote — a subtle, non-intrusive disclaimer that the content it accompanies
 * is AI/ML-generated and may be inaccurate. The product's stances, confidence
 * scores, prose summaries, and reports are all model output, so any surface
 * that renders them carries one of these (placed once per surface — never
 * per-row in a list).
 *
 * Accessibility:
 * - `role="note"` (NOT `alert`/`status`) so screen readers expose it as
 * supplementary context without interrupting or being announced live.
 * - The ✨ glyph is decorative (`aria-hidden`).
 *
 * Visual tone is deliberately lighter than ErrorState (no rose/alert styling):
 * a small muted line that informs without competing with the content.
 *
 * @param props.text - Override copy. Defaults to the standard
 * "AI-generated analysis — may be inaccurate." line;
 * report-prose surfaces pass the longer
 * `strings.ai.reportDisclaimer`.
 * @param props.className - Extra Tailwind classes — e.g. a card-footer
 * treatment (`pt-2 mt-2 border-t border-ink-100
 * dark:border-ink-800`) or spacing under a header.
 */
export function AiNote({
  text = strings.ai.disclaimer,
  className,
}: {
  text?: string;
  className?: string;
}) {
  return (
    <p
      role="note"
      className={clsx(
        "flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400",
        className,
      )}
    >
      <span aria-hidden>✨</span>
      {text}
    </p>
  );
}
