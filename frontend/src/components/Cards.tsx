import { Link } from "react-router-dom";
import type {
  CreatorListItem,
  Video,
  Topic,
  Report,
  ChunkTopicAnalysis,
  StanceLabel,
} from "../lib/types";
import { formatDate, formatRelative, humanizeLabel } from "../lib/format";
import {
  StanceBadge,
  ConfidenceBadge,
  TranscriptStatusBadge,
  AnalysisStatusBadge,
} from "./Badges";
import { stanceFamily } from "../theme/tokens";
import { strings } from "../i18n/en";

/**
 * CreatorCard — a clickable card representing one creator in a grid.
 *
 * Used on the Creators index and the Dashboard's "recent creators" section.
 * Layout:
 * - Header row: thumbnail (or initials fallback) + display name + @slug.
 * - Optional description body, line-clamped to 3 lines so cards stay
 * visually consistent regardless of bio length.
 * - Footer mini-stats: videos / transcripts / topics counts.
 * - Last-imported timestamp (relative, e.g. "3 days ago").
 *
 * The entire card is a single `<Link>` so the click target is large
 * (Fitts' law) and the hover state animates the border + shadow.
 *
 * @param props.creator - One row from `GET /api/creators`, already
 * decorated with the per-creator aggregate counts.
 */
export function CreatorCard({ creator }: { creator: CreatorListItem }) {
  return (
    <Link
      to={`/creators/${creator.id}`}
      className="card card-pad hover:border-brand-300 hover:shadow-md transition group"
    >
      <div className="flex items-center gap-3">
        {creator.thumbnailUrl ? (
          <img
            src={creator.thumbnailUrl}
            alt={`${creator.name} channel thumbnail`}
            loading="lazy"
            className="w-12 h-12 rounded-full object-cover"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-ink-200 dark:bg-ink-700 grid place-items-center text-sm font-semibold text-ink-700 dark:text-ink-300">
            {creator.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-semibold text-ink-900 dark:text-ink-50 group-hover:text-brand-700 truncate">
            {creator.name}
          </p>
          <p className="meta-row">@{creator.slug}</p>
        </div>
      </div>
      {creator.description && (
        <p className="text-sm text-ink-600 dark:text-ink-400 mt-3 line-clamp-3">
          {creator.description}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2 mt-4 text-xs text-ink-600 dark:text-ink-400">
        <CardStatTile
          label={strings.creators.cardVideos}
          value={creator.videoCount}
        />
        <CardStatTile
          label={strings.creators.cardTranscripts}
          value={creator.transcriptCount}
        />
        <CardStatTile
          label={strings.creators.cardTopics}
          value={creator.topicCount}
        />
      </div>
      <p className="text-xs text-ink-500 dark:text-ink-400 mt-3">
        {strings.creators.lastImported} {formatRelative(creator.lastImportedAt)}
      </p>
    </Link>
  );
}

/**
 * CardStatTile — the small "label + big number" tile used in the footer of
 * CreatorCard and the footer of TopicCard. Kept internal because the
 * outer Cards are the API surface; this is just visual scaffolding.
 */
function CardStatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center bg-ink-50 dark:bg-ink-900 rounded-md py-1.5">
      <p className="font-semibold text-ink-900 dark:text-ink-50">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-ink-500 dark:text-ink-400">
        {label}
      </p>
    </div>
  );
}

/**
 * VideoCard — a clickable thumbnail card representing one video in a grid.
 *
 * Used on the Videos index, the Creator Overview "recent videos" section,
 * and the Topic Analysis "chronological summaries" rail.
 *
 * Layout: 16:9 thumbnail at the top (falls back to a flat gray block when
 * no thumbnail URL is present), then a body with the title (clamped to
 * 2 lines), creator name + publish date, and the transcript/analysis
 * status badges.
 *
 * @param props.video - A `Video` row, optionally hydrated with its
 * `creator` summary (used for the byline) and
 * `_count` aggregate (not used here, but the type
 * allows it for callers that fetch with `include`).
 */
export function VideoCard({ video }: { video: Video }) {
  return (
    <Link
      to={`/videos/${video.id}`}
      className="card hover:border-brand-300 hover:shadow-md transition group overflow-hidden flex flex-col"
    >
      <div className="aspect-video bg-ink-100 dark:bg-ink-800 overflow-hidden">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={`Thumbnail for ${video.title}`}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : null}
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <p className="font-medium text-ink-900 dark:text-ink-50 line-clamp-2 group-hover:text-brand-700">
          {video.title}
        </p>
        <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
          {video.creator?.name && <span>{video.creator.name} · </span>}
          {formatDate(video.publishedAt)}
        </p>
        <div className="flex flex-wrap gap-1 mt-3">
          <TranscriptStatusBadge status={video.transcriptStatus} />
          <AnalysisStatusBadge status={video.analysisStatus} />
        </div>
      </div>
    </Link>
  );
}

/**
 * TopicCard — a clickable card for one (creator, topic) pairing.
 *
 * Used on the Creator Overview's "Top topics" rail and on aggregate
 * dashboards. Each card shows:
 * - Topic name on the left
 * - StanceBadge on the right for the creator's dominant stance
 * - Two compact stats: video count + mention count
 *
 * The `to` prop accepts an arbitrary destination so the same card layout
 * can deep-link into either the Topic Analysis page (most common) or
 * eventually a cross-creator topic view if we add one.
 *
 * @param props.topic - Subset of `Topic` (just the fields we render).
 * @param props.videoCount - How many of the creator's videos surfaced this topic.
 * @param props.mentionCount - Sum of per-summary mentionCount across those videos.
 * @param props.dominantStance - The mode stance across the creator's videos
 * for this topic. `insufficient_evidence` is a
 * member of `StanceLabel`, so no cast is needed
 * and the badge renders it as the gray
 * no-signal family.
 * @param props.to - React Router destination path for the card link.
 */
export function TopicCard({
  topic,
  videoCount,
  mentionCount,
  dominantStance,
  to,
}: {
  topic: Pick<Topic, "id" | "name" | "slug">;
  videoCount: number;
  mentionCount: number;
  dominantStance: StanceLabel;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="card card-pad hover:border-brand-300 hover:shadow-md transition flex flex-col"
    >
      <div className="flex items-start justify-between">
        <p className="font-semibold text-ink-900 dark:text-ink-50">
          {topic.name}
        </p>
        <StanceBadge stance={dominantStance} />
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div className="bg-ink-50 dark:bg-ink-900 rounded-md py-1.5 text-center">
          <p className="font-semibold text-ink-900 dark:text-ink-50">
            {videoCount}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {strings.creators.cardVideos}
          </p>
        </div>
        <div className="bg-ink-50 dark:bg-ink-900 rounded-md py-1.5 text-center">
          <p className="font-semibold text-ink-900 dark:text-ink-50">
            {mentionCount}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {strings.videoDetail.mentions}
          </p>
        </div>
      </div>
    </Link>
  );
}

/**
 * ReportCard — a clickable card representing a generated report (either
 * a creator summary or a topic summary).
 *
 * Layout:
 * - Eyebrow showing the report type ("Creator summary" / "Topic summary")
 * - Title (2-line clamp so cards stay equal-height across a grid row)
 * - Summary excerpt (3-line clamp)
 * - Footer with optional creator name + creation date
 *
 * The card navigates to `/reports/:id` for the full rendered report.
 *
 * @param props.report - A `Report` row, optionally hydrated with its
 * `creator` summary for the footer byline.
 */
export function ReportCard({ report }: { report: Report }) {
  return (
    <Link
      to={`/reports/${report.id}`}
      className="card card-pad hover:border-brand-300 hover:shadow-md transition block"
    >
      <p className="section-eyebrow">{humanizeLabel(report.reportType)}</p>
      <p className="font-semibold text-ink-900 dark:text-ink-50 mt-1 line-clamp-2">
        {report.title}
      </p>
      <p className="text-sm text-ink-600 dark:text-ink-400 mt-2 line-clamp-3">
        {report.summary}
      </p>
      <p className="text-xs text-ink-500 dark:text-ink-400 mt-3">
        {report.creator?.name ? `${report.creator.name} · ` : ""}
        {formatDate(report.createdAt)}
      </p>
    </Link>
  );
}

/**
 * EvidenceCard — a single piece of provenance for the AI's stance call.
 *
 * Each card surfaces the chain of evidence a recruiter (or skeptical
 * domain expert) needs to trust the classification:
 * - StanceBadge + ConfidenceBadge — what the AI concluded
 * - The topic name as a deep-link back to the topic analysis
 * - The evidence quote, formatted as a real `<blockquote>` so it reads
 * as a citation and not just inline italic text
 * - The AI's claim summary + rationale (one-liner)
 * - Footer with creator + video + publish date + a "View context" link
 * that opens the EvidenceDetail page (previous chunk → main → next
 * chunk) so the user can see what surrounded the quote.
 *
 * This is intentionally a "card", not a "row" — when stance evidence is
 * a portfolio's North Star, each piece deserves vertical space.
 *
 * @param props.evidence - One `ChunkTopicAnalysis` from `/api/evidence`,
 * hydrated with its `creator`, `topic`, and `video`
 * relations so the footer can render byline + date.
 */
export function EvidenceCard({ evidence }: { evidence: ChunkTopicAnalysis }) {
  return (
    <div className="card card-pad space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StanceBadge stance={evidence.stanceLabel} />
        <ConfidenceBadge confidence={evidence.confidenceLabel} />
        {evidence.topic &&
          /*
           * The topic-analysis route needs BOTH a creator id and a topic id.
           * When the creator relation is missing we can't build a valid
           * destination, so render the topic as plain text rather than a
           * dead `href="#"` link that scrolls to top / does nothing.
           */
          (evidence.creator ? (
            <Link
              to={`/creators/${evidence.creator.id}/topics/${evidence.topic.id}`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              #{evidence.topic.name}
            </Link>
          ) : (
            <span className="text-xs font-medium text-ink-500 dark:text-ink-400">
              #{evidence.topic.name}
            </span>
          ))}
      </div>
      {evidence.evidenceQuote && (
        /*
         * Stance-colored left rule mirrors the analyst console's pull-quote
         * treatment so a quote's stance reads at a glance. The color comes from
         * the `--stance-*` CSS variable for the quote's family, so it flips with
         * the dark toggle without this card needing to read the theme in JS.
         */
        <blockquote
          className="text-sm text-ink-800 dark:text-ink-200 border-l-4 pl-3 italic"
          style={{
            borderColor: `var(--stance-${stanceFamily(evidence.stanceLabel)})`,
          }}
        >
          “{evidence.evidenceQuote}”
        </blockquote>
      )}
      {evidence.claimSummary && (
        <p className="text-sm text-ink-700 dark:text-ink-300">
          {evidence.claimSummary}
        </p>
      )}
      {evidence.rationale && <p className="meta-row">{evidence.rationale}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-ink-100 dark:border-ink-800 text-xs text-ink-500 dark:text-ink-400">
        <div>
          {evidence.creator && (
            <Link
              to={`/creators/${evidence.creator.id}`}
              className="hover:text-brand-700 font-medium"
            >
              {evidence.creator.name}
            </Link>
          )}
          {evidence.video?.title && (
            <span>
              {" · "}
              <Link
                to={`/videos/${evidence.video.id}`}
                className="hover:text-brand-700"
              >
                {evidence.video.title}
              </Link>
            </span>
          )}
          {evidence.video?.publishedAt && (
            <span> · {formatDate(evidence.video.publishedAt)}</span>
          )}
        </div>
        <Link
          to={`/evidence/${evidence.id}`}
          className="text-brand-700 hover:underline font-medium"
        >
          {strings.evidence.viewContext} →
        </Link>
      </div>
    </div>
  );
}
