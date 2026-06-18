import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApiCall } from "../hooks/useApiCall";
import type { TopicAnalysis } from "../lib/types";
import {
  waitForAnalysisRun,
  type QueuedReportResponse,
} from "../lib/reportJobs";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  AiNote,
} from "../components/States";
import { fillTemplate, formatDate } from "../lib/format";
import {
  averageConfidencePct,
  buildEvidenceRows,
  buildStancePoints,
  computeVerdict,
  evidenceInRange,
  pointsExtent,
  pointsInRange,
  presetRange,
  stanceCounts,
  type DateRange,
  type StancePoint,
} from "../lib/topicAnalysis";
import { VerdictHero } from "../components/topic-analysis/VerdictHero";
import {
  DateRangeBar,
  type RangePreset,
} from "../components/topic-analysis/DateRangeBar";
import { StanceTrajectoryChart } from "../components/topic-analysis/StanceTrajectoryChart";
import { StanceRibbon } from "../components/topic-analysis/StanceRibbon";
import { StanceHeatmap } from "../components/topic-analysis/StanceHeatmap";
import { ConsoleStats } from "../components/topic-analysis/ConsoleStats";
import { EvidenceList } from "../components/topic-analysis/EvidenceList";
import { EpisodeModal } from "../components/topic-analysis/EpisodeModal";
import { strings } from "../i18n/en";
import { useToast } from "../toast/toastContext";

/**
 * TopicAnalysisPage — the "analyst console", route
 * `/creators/:creatorId/topics/:topicId`. This is the redesigned
 * centerpiece: ONE creator's stance on ONE topic, scrutinized across a
 * client-side-filterable date window with full evidence provenance. It
 * faithfully ports the approved topic-analysis prototype, top to bottom:
 *
 * 1. Title + subtitle ("<creator> · stance trajectory + evidence · <start>
 * – <end>"), the dates reflecting the SELECTED range.
 * 2. VERDICT hero — bold "Leans <stance>" with a stance-colored left bar +
 * "% of N videos" and the range on the right. Recomputes with the range.
 * 3. DATE-RANGE bar — two date inputs + presets + a "showing N of M" count.
 * Changing it filters EVERY view below CLIENT-SIDE (no backend params).
 * 4. STANCE TRAJECTORY — SVG line chart with stance bands + colored dots;
 * hover → tooltip, click → episode modal (verbatim quotes).
 * 5. OVERALL BALANCE — proportional stance ribbon + legend.
 * 6. PER-VIDEO HEATMAP — month-grouped cells; same hover + click-modal.
 * 7. STATS row — videos / evidence / avg conf / topics.
 * 8. EVIDENCE — compact expandable rows + stance pills + sort dropdown
 * (date range + filter + sort all compose).
 *
 * Data flow:
 * - `GET /api/creators/:id/topics/:id/analysis` returns the bundled payload;
 * `buildStancePoints` / `buildEvidenceRows` adapt `summaries`/`topEvidence`
 * into the console models. Everything below the date bar is derived from
 * the IN-RANGE slice of those, so one `range` state drives the whole page.
 * - `POST /api/reports/creator/:id/topic/:id/generate` backs the header CTA;
 * on success it invalidates the analysis query so a fresh report appears.
 *
 * The page links out using SLUG-based ids where appropriate (the creator
 * link), which a parallel backend slug-resolution fix resolves.
 */
export function TopicAnalysisPage() {
  const { creatorId, topicId } = useParams<{
    creatorId: string;
    topicId: string;
  }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [pendingReportRunId, setPendingReportRunId] = useState<string | null>(
    null,
  );

  const analysisQuery = useQuery({
    queryKey: ["topic-analysis", creatorId, topicId],
    queryFn: () =>
      api.get<TopicAnalysis>(
        `/creators/${creatorId}/topics/${topicId}/analysis`,
      ),
  });

  /* Report generation, wrapped in useApiCall so success/failure toast. */
  const reportMutation = useApiCall(
    () =>
      api.post<QueuedReportResponse>(
        `/reports/creator/${creatorId}/topic/${topicId}/generate`,
      ),
    {
      successTitle: strings.toasts.reportQueuedTitle,
      successMessage: strings.toasts.reportQueuedBody,
      onSuccess: ({ analysisRunId }) => {
        setPendingReportRunId(analysisRunId);
        void waitForAnalysisRun(analysisRunId)
          .then(() => {
            void queryClient.invalidateQueries({
              queryKey: ["topic-analysis", creatorId, topicId],
            });
            void queryClient.invalidateQueries({ queryKey: ["reports"] });
            showToast({
              kind: "success",
              title: strings.toasts.reportReadyTitle,
              message: strings.toasts.reportReadyBody,
            });
          })
          .catch((error: Error) => {
            showToast({
              kind: "error",
              title: strings.toasts.reportFailedTitle,
              message: error.message,
            });
          })
          .finally(() => setPendingReportRunId(null));
      },
    },
  );

  /*
   * Build the console models once per payload. Memoized so the derived arrays
   * are referentially stable across the many state-driven re-renders below.
   */
  const data = analysisQuery.data;
  const allPoints = useMemo(
    () => (data ? buildStancePoints(data) : []),
    [data],
  );
  const allEvidence = useMemo(
    () => (data ? buildEvidenceRows(data) : []),
    [data],
  );
  const extent = useMemo(() => pointsExtent(allPoints), [allPoints]);

  /*
   * The selected client-side date range + which preset is active. Both default
   * to "all" / the full extent; `null` range means "use the full extent" until
   * a payload arrives (kept in state so edits/presets are sticky).
   */
  const [range, setRange] = useState<DateRange | null>(null);
  const [preset, setPreset] = useState<RangePreset | "custom">("all");
  /* The episode whose modal is open (clicked dot/cell), or null. */
  const [selected, setSelected] = useState<StancePoint | null>(null);

  /*
   * Reset the per-topic view state when navigating to a different creator/topic.
   * The page component is reused across route-param changes, so without this the
   * date range, active preset, and any open modal would carry over from the
   * previously-viewed topic (showing topic A's window on topic B).
   */
  useEffect(() => {
    setRange(null);
    setPreset("all");
    setSelected(null);
  }, [creatorId, topicId]);

  if (analysisQuery.isLoading) return <LoadingState />;
  if (analysisQuery.isError)
    return (
      <ErrorState
        message={(analysisQuery.error as Error).message}
        onRetry={() => analysisQuery.refetch()}
      />
    );

  /*
   * After the guards `data` is defined. With no dated points there's no extent,
   * so we fall back to a zero-width range (every "in range" check trivially
   * passes the empty set, and the views render their friendly empty states).
   */
  const loaded = data as TopicAnalysis;
  const effectiveExtent = extent ?? { min: 0, max: 0 };
  /* Until the user picks a range, default to the full extent (min→max). */
  const effectiveRange: DateRange = range ?? {
    start: effectiveExtent.min,
    end: effectiveExtent.max,
  };

  /* Apply the date range CLIENT-SIDE to every downstream view. */
  const inRangePoints = pointsInRange(allPoints, effectiveRange);
  const inRangeEvidence = evidenceInRange(allEvidence, effectiveRange);
  const verdict = computeVerdict(inRangePoints);
  const counts = stanceCounts(inRangePoints);
  const avgConf = averageConfidencePct(inRangePoints);

  /* Preset click → resolve the relative window and clear any custom edit. */
  function handlePreset(next: RangePreset) {
    setPreset(next);
    setRange(presetRange(next, effectiveExtent));
  }

  /* Manual date-input edit → adopt the custom range and drop the preset chip. */
  function handleRangeChange(next: DateRange) {
    setPreset("custom");
    setRange(next);
  }

  /*
   * Subtitle reflects the SELECTED range with full "Mon D, YYYY" dates, or a
   * "no videos in range" variant when the window is empty. The creator name is
   * rendered separately as a link below, so we interpolate it with a sentinel
   * and strip the sentinel prefix to get just the " · trajectory · dates" tail
   * (keeping the full template in i18n as the single source of copy).
   */
  const SENTINEL = "[[creator]]";
  const subtitleSuffix = (
    inRangePoints.length > 0
      ? fillTemplate(strings.topicAnalysis.subtitleTemplate, {
          creator: SENTINEL,
          start: formatDate(inRangePoints[0].date),
          end: formatDate(inRangePoints[inRangePoints.length - 1].date),
        })
      : fillTemplate(strings.topicAnalysis.subtitleNoRange, {
          creator: SENTINEL,
        })
  ).replace(`${SENTINEL} · `, "");

  return (
    <div>
      <PageHeader
        title={loaded.topic.name}
        subtitle={
          <>
            <Link
              to={`/creators/${loaded.creator.slug}`}
              className="hover:text-brand-700"
            >
              {loaded.creator.name}
            </Link>
            {" · "}
            {subtitleSuffix}
          </>
        }
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => reportMutation.run()}
            disabled={reportMutation.isPending || pendingReportRunId !== null}
          >
            {reportMutation.isPending || pendingReportRunId !== null
              ? strings.creatorOverview.generating
              : `📑 ${strings.topicAnalysis.generateTopicReport}`}
          </button>
        }
      />

      {/* Whole console below (verdict, trajectory, ribbon, heatmap, stats,
 evidence, episode modal) is ML output — one note covers it all. */}
      <AiNote className="mb-4" />

      {/* 2. VERDICT hero — recomputes with the range. */}
      <VerdictHero verdict={verdict} points={inRangePoints} />

      {/* 3. DATE-RANGE bar — filters everything below client-side. Hidden when
 there are no dated videos (extent is null): a range control over an
 empty timeline is meaningless and would render epoch-zero "1970-01-01"
 inputs. The views below still show their friendly empty states. */}
      {extent && (
        <DateRangeBar
          range={effectiveRange}
          extent={extent}
          preset={preset}
          shown={inRangePoints.length}
          total={allPoints.length}
          onPreset={handlePreset}
          onRangeChange={handleRangeChange}
        />
      )}

      {/* 4. STANCE TRAJECTORY */}
      <p className="console-eyebrow">
        {strings.topicAnalysis.trajectoryHeading}
      </p>
      <div className="console-panel">
        <StanceTrajectoryChart points={inRangePoints} onSelect={setSelected} />
      </div>

      {/* 5. OVERALL BALANCE ribbon */}
      <p className="console-eyebrow">{strings.topicAnalysis.balanceHeading}</p>
      <div className="console-panel">
        <StanceRibbon counts={counts} total={inRangePoints.length} />
      </div>

      {/* 6. PER-VIDEO HEATMAP */}
      <p className="console-eyebrow">{strings.topicAnalysis.heatmapHeading}</p>
      <div className="console-panel">
        <StanceHeatmap points={inRangePoints} onSelect={setSelected} />
      </div>

      {/* 7. STATS row. NOTE: the prototype's "topics" tile shows the creator's
 whole topic catalog count (a constant 35); the real `analysis` payload
 doesn't carry that figure, so we surface the all-time video coverage
 for THIS topic (every dated summary) as the closest stable proxy. The
 other three tiles are range-scoped per the prototype. */}
      <ConsoleStats
        videos={inRangePoints.length}
        evidence={inRangeEvidence.length}
        avgConf={avgConf === null ? strings.common.none : `${avgConf}%`}
        topics={allPoints.length}
      />

      {/* 8. EVIDENCE — date range + stance filter + sort all compose. */}
      <p className="console-eyebrow">{strings.topicAnalysis.evidenceHeading}</p>
      <EvidenceList rows={inRangeEvidence} />

      {/* Optional: link to the generated topic report when one exists. */}
      {loaded.report && (
        <>
          <p className="console-eyebrow">
            {strings.topicAnalysis.noReportSection}
          </p>
          <Link
            to={`/reports/${loaded.report.id}`}
            className="console-panel block hover:border-brand-300 transition"
          >
            <p className="font-semibold text-ink-900 dark:text-ink-50">
              {loaded.report.title}
            </p>
            <p className="mt-2 line-clamp-3 text-sm text-ink-600 dark:text-ink-400">
              {loaded.report.summary}
            </p>
            <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
              {formatDate(loaded.report.createdAt)}
            </p>
          </Link>
        </>
      )}

      {/* The episode modal (trajectory dot / heatmap cell click). */}
      <EpisodeModal point={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
