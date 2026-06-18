import clsx from "clsx";
import type {
  AnalysisStatus,
  ConfidenceLabel,
  ImportJobItemStatus,
  ImportJobStatus,
  StanceLabel,
  TranscriptStatus,
  TrendLabel,
} from "../lib/types";
import { humanizeLabel } from "../lib/format";
import { stanceBadgeTone } from "../theme/tokens";

/**
 * Props for the low-level `Badge` primitive. Most callers should reach
 * for one of the typed wrappers below (StanceBadge, ConfidenceBadge,
 * etc.) — they encode the label-to-color mapping so colors stay
 * consistent across every page.
 */
interface BadgeProps {
  /** The visible text inside the pill. Already humanized — callers pass
   * something like "Supportive", not "supportive". */
  label: string;
  /** Color family. Mapped to a Tailwind class triple (bg + text + border). */
  tone:
    | "neutral"
    | "blue"
    | "green"
    | "yellow"
    | "red"
    | "purple"
    | "amber"
    | "gray";
  /** Optional extra Tailwind classes (e.g. margin tweaks at the call site). */
  className?: string;
}

/**
 * Badge — the low-level pill primitive. A small rounded-full chip with a
 * tone-driven background + text + border. Used by every typed wrapper
 * below; you can also use it directly when a one-off chip is needed.
 *
 * Tones are mapped to Tailwind class triples in a single map so adding a
 * new color (or shifting the existing ones for a rebrand) only touches
 * one place. Border colors are deliberately a hue darker than the
 * background so the pills read as crisp even on white backgrounds.
 *
 * The three stance-bearing tones (green / red / gray) carry explicit
 * dark-mode variants so a stance pill clears WCAG-AA contrast on the
 * ink-900 card surface used in dark mode — these mirror the dark `text`
 * hues in `STANCE_TOKENS` so the pill and the timeline dot agree.
 */
export function Badge({ label, tone, className }: BadgeProps) {
  const toneClass: Record<BadgeProps["tone"], string> = {
    neutral: "bg-ink-100 text-ink-700 border-ink-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green:
      "bg-emerald-50 text-emerald-700 border-emerald-200 " +
      "dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    red:
      "bg-rose-50 text-rose-700 border-rose-200 " +
      "dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
    purple: "bg-violet-50 text-violet-700 border-violet-200",
    /*
     * Amber now also carries a dark variant: the StanceBadge routes the
     * `mixed` stance to this tone (the console's amber both-sides family),
     * so it must clear contrast on the dark ink-900 card like green/red/gray.
     */
    amber:
      "bg-amber-50 text-amber-700 border-amber-200 " +
      "dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    gray:
      "bg-ink-50 text-ink-600 border-ink-200 " +
      "dark:bg-ink-800 dark:text-ink-300 dark:border-ink-700",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium",
        toneClass[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * StanceBadge — renders the AI-classified stance for a (creator, topic,
 * chunk) tuple. Color is no longer chosen inline here: it routes through
 * the centralized `stanceBadgeTone()` token so every stance surface
 * (this pill, the trajectory dots, the verdict text) agrees on the same
 * four-family encoding:
 * - supportive → green (positive)
 * - mixed → amber (genuine both-sides stance)
 * - opposed → red (negative)
 * - everything else (neutral / unclear / insufficient_evidence)
 * → gray (no directional signal)
 *
 * Color is supplemented by the label text so the badge is fully
 * readable for users with color-vision deficiencies (WCAG 1.4.1), and the
 * green/amber/red/gray tones carry dark-mode variants so the pill clears
 * WCAG-AA contrast in both themes.
 */
export function StanceBadge({ stance }: { stance: StanceLabel }) {
  return <Badge label={humanizeLabel(stance)} tone={stanceBadgeTone(stance)} />;
}

/**
 * ConfidenceBadge — renders the classifier's confidence in its stance call.
 * The text always includes "confidence" so the chip self-describes when
 * isolated from its row context.
 *
 * - high → purple (strong signal — let it stand out)
 * - medium → blue (informational)
 * - low → neutral (de-emphasized so a recruiter's eye drops past it)
 */
export function ConfidenceBadge({
  confidence,
}: {
  confidence: ConfidenceLabel;
}) {
  const tone: BadgeProps["tone"] =
    confidence === "high"
      ? "purple"
      : confidence === "medium"
        ? "blue"
        : "neutral";
  return (
    <Badge label={`${humanizeLabel(confidence)} confidence`} tone={tone} />
  );
}

/**
 * TranscriptStatusBadge — the lifecycle state of a video's transcript.
 * - available → green (we have it, ready to analyze)
 * - manual → blue (user pasted it themselves)
 * - pending → yellow (fetcher hasn't run yet)
 * - unavailable / failed → red (no transcript will come; manual is the path forward)
 */
export function TranscriptStatusBadge({
  status,
}: {
  status: TranscriptStatus;
}) {
  const tone: BadgeProps["tone"] =
    status === "available"
      ? "green"
      : status === "manual"
        ? "blue"
        : status === "pending"
          ? "yellow"
          : status === "unavailable" || status === "failed"
            ? "red"
            : "neutral";
  return <Badge label={humanizeLabel(status)} tone={tone} />;
}

/**
 * AnalysisStatusBadge — the lifecycle state of the per-video AI analysis
 * (topic detection + per-chunk stance classification + per-topic summary).
 * - completed → green (analysis finished; results visible)
 * - processing → blue (running now; refresh in a moment)
 * - pending → yellow (queued; no work started yet)
 * - failed → red (background job errored; "Re-run" button surfaces)
 */
export function AnalysisStatusBadge({ status }: { status: AnalysisStatus }) {
  const tone: BadgeProps["tone"] =
    status === "completed"
      ? "green"
      : status === "processing"
        ? "blue"
        : status === "pending"
          ? "yellow"
          : status === "failed"
            ? "red"
            : "neutral";
  return <Badge label={humanizeLabel(status)} tone={tone} />;
}

/**
 * ImportStatusBadge — accepts BOTH `ImportJobStatus` and the per-item
 * `ImportJobItemStatus` enum because the ImportJobDetail page renders one
 * badge for the job-level state and one per row of items, and both types
 * share the same visual treatment.
 *
 * The two enums are intentionally kept distinct in the backend
 * (a job can be "completed_with_errors", but a single item is either
 * "analysis_completed" or "failed") — this badge merges them for display
 * only.
 */
export function ImportStatusBadge({
  status,
}: {
  status: ImportJobStatus | ImportJobItemStatus;
}) {
  const tone: BadgeProps["tone"] =
    status === "completed"
      ? "green"
      : status === "completed_with_errors"
        ? "amber"
        : status === "processing"
          ? "blue"
          : status === "pending"
            ? "yellow"
            : status === "failed"
              ? "red"
              : status === "transcript_unavailable"
                ? "amber"
                : status === "analysis_completed"
                  ? "green"
                  : status === "transcript_imported" ||
                      status === "metadata_imported"
                    ? "blue"
                    : "neutral";
  return <Badge label={humanizeLabel(status)} tone={tone} />;
}

/**
 * TrendBadge — the timeline trend label produced by the
 * `creatorTopicTimeline` service. Describes how a creator's stance on a
 * topic has changed across the imported window:
 * - stable → blue (consistent stance over time)
 * - gradual_shift → amber (slow drift)
 * - abrupt_shift → red (sudden flip — worth investigating)
 * - mixed → purple (back-and-forth, no clear arc)
 * - insufficient_data → neutral (not enough dated summaries to call it)
 */
export function TrendBadge({ trend }: { trend: TrendLabel }) {
  const tone: BadgeProps["tone"] =
    trend === "stable"
      ? "blue"
      : trend === "gradual_shift"
        ? "amber"
        : trend === "abrupt_shift"
          ? "red"
          : trend === "mixed"
            ? "purple"
            : "neutral";
  return <Badge label={humanizeLabel(trend)} tone={tone} />;
}
