import { useEffect, useRef } from "react";
import type { StancePoint } from "../../lib/topicAnalysis";
import { useTheme } from "../../theme/themeContext";
import { stanceColors } from "../../theme/tokens";
import { StanceBadge } from "../Badges";
import { AiNote } from "../States";
import { formatDate } from "../../lib/format";
import { strings } from "../../i18n/en";

/**
 * EpisodeModal — the small, focused dialog shown when a viewer clicks a
 * trajectory dot or a heatmap cell.
 *
 * It is intentionally NOT a full page (the prototype pops a centered card):
 * it surfaces one episode's verbatim pull-quotes (`notableEvidence`) as
 * blockquotes, with the title / date / stance badge / confidence in the
 * header. When the episode has no captured quotes it falls back to the
 * one-line summary, then to a generic "no segments" note.
 *
 * Accessibility (the spec's hard constraints):
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` so screen readers
 * announce it as a modal titled by the episode name.
 * - Focus moves to the close button on open and is TRAPPED inside the
 * dialog (Tab / Shift+Tab cycle within), restoring to the trigger on close.
 * - ESC closes; clicking the backdrop (outside the card) closes.
 *
 * @param props.point - The episode to show, or `null` to render nothing.
 * @param props.onClose - Called on ESC / backdrop / close-button / a focus
 * restore; the parent clears its selected point.
 */
export function EpisodeModal({
  point,
  onClose,
}: {
  point: StancePoint | null;
  onClose: () => void;
}) {
  const { resolved } = useTheme();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /*
   * Remember what was focused before the modal opened so we can restore it
   * when the modal closes (WCAG focus-management best practice).
   */
  const restoreRef = useRef<HTMLElement | null>(null);
  /*
   * Keep the LATEST onClose in a ref so the open-effect can depend only on
   * `point`. The parent passes a fresh `() => setSelected(null)` arrow on every
   * render; if the effect depended on `onClose`, an unrelated parent re-render
   * (e.g. a React Query background refetch) would tear down and re-run the
   * effect mid-open — re-stashing `restoreRef` as the close button, so focus
   * would "restore" to a node that's about to unmount. Reading via the ref
   * keeps the handlers current without retriggering the effect.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /*
   * On open: stash the previously-focused element, move focus to the close
   * button, and wire ESC + a focus trap. On close/unmount: restore focus.
   */
  useEffect(() => {
    if (!point) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      /*
       * Trap Tab focus within the dialog: collect the focusable nodes and
       * wrap from last → first (and first → last on Shift+Tab).
       */
      const focusables = cardRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      /* Restore focus to the trigger so keyboard users land where they left. */
      restoreRef.current?.focus?.();
    };
  }, [point]);

  if (!point) return null;

  const colors = stanceColors(point.stance, resolved);
  const confPct = Math.round(point.conf * 100);
  const titleId = `episode-modal-${point.id}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4">
      {/* The dimmed backdrop is a real <button> (so it's keyboard- and
 screen-reader-accessible) sitting behind the card; clicking it closes
 the modal. The keyboard path is also served by ESC + the card's close
 button, so this is purely an extra mouse affordance. */}
      <button
        type="button"
        aria-label={strings.topicAnalysis.modalClose}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-[440px] max-w-[92vw] max-h-[78vh] overflow-auto rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-800 dark:bg-ink-900"
      >
        <div className="flex items-start gap-2 px-5 pb-2 pt-5">
          <div className="min-w-0">
            <p
              id={titleId}
              className="text-[15px] font-semibold leading-snug text-ink-900 dark:text-ink-50"
            >
              {point.title}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-500 dark:text-ink-400">
              <span>{formatDate(point.date)}</span>
              <StanceBadge stance={point.stance} />
              <span>
                {confPct}% {strings.topicAnalysis.confidenceSuffix}
              </span>
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={strings.topicAnalysis.modalClose}
            onClick={onClose}
            className="ml-auto -mr-1 text-2xl leading-none text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
          >
            ×
          </button>
        </div>
        <div className="px-5 pb-5 pt-1">
          {point.quotes.length > 0 ? (
            point.quotes.map((q, i) => (
              <blockquote
                /*
                 * Quotes are static once the modal opens (never reordered), and
                 * two quotes can be identical, so pair the text with its index
                 * for a stable, unique key.
                 */
                key={`${point.id}-q${i}`}
                className="my-2.5 border-l-[3px] pl-3.5 font-serif text-[14.5px] italic leading-relaxed text-ink-900 dark:text-ink-100"
                style={{ borderColor: colors.dot }}
              >
                “{q}”
              </blockquote>
            ))
          ) : (
            <p className="text-sm text-ink-500 dark:text-ink-400">
              {point.summary || strings.topicAnalysis.modalNoQuotes}
            </p>
          )}
          {point.sourceUrl && (
            <a
              href={point.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm font-medium link-brand"
            >
              {strings.topicAnalysis.modalWatch}
            </a>
          )}
          {/* The stance + confidence + summary in this dialog are ML output;
 the page-level note can't travel into the fixed overlay. */}
          <AiNote className="mt-4" />
        </div>
      </div>
    </div>
  );
}
