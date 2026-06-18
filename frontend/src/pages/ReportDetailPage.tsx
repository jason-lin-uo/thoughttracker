import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Report, TopicAnalysis } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  AiNote,
} from "../components/States";
import { formatDate, humanizeLabel } from "../lib/format";
import { buildStancePoints, type StancePoint } from "../lib/topicAnalysis";
import { StanceTrajectoryChart } from "../components/topic-analysis/StanceTrajectoryChart";
import { EpisodeModal } from "../components/topic-analysis/EpisodeModal";
import { strings } from "../i18n/en";

type ReportSection = NonNullable<
  NonNullable<Report["evidence"]>["sections"]
>[number];
type ReportSectionBullet = NonNullable<ReportSection["bullets"]>[number];
type DisplayBullet =
  | { kind: "text"; text: string }
  | {
      kind: "quote";
      quote: string;
      citation: string;
      videoId?: string | null;
    };

/**
 * SectionBody — render a report section body that is authored as a bullet list
 * (one "- " line per point) into a real `<ul>`, while still rendering any plain
 * paragraph lines as `<p>`. Reports are scannable bullet summaries; legacy
 * paragraph bodies (or a stray non-bullet lead line) still render cleanly.
 */
function SectionBody({ body }: { body?: string }) {
  if (!body?.trim()) return null;
  const lines = body
    .split("\n")
    .map((l) => sanitizeReaderText(l.trim()))
    .filter((line) => line && !isInstructionLeak(line));
  const blocks: Array<{ type: "ul" | "p"; items: string[] }> = [];
  for (const line of lines) {
    const isBullet = /^[-•*]\s+/.test(line);
    const text = line.replace(/^[-•*]\s+/, "");
    const last = blocks[blocks.length - 1];
    if (isBullet && last?.type === "ul") last.items.push(text);
    else if (isBullet) blocks.push({ type: "ul", items: [text] });
    else blocks.push({ type: "p", items: [text] });
  }
  return (
    <div className="mt-2 space-y-2 text-sm text-ink-700 dark:text-ink-300">
      {blocks.map((b, i) =>
        b.type === "ul" ? (
          <ul key={i} className="list-disc pl-5 space-y-1.5 leading-relaxed">
            {b.items.map((it, j) => (
              <li key={j}>{it}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="leading-relaxed">
            {b.items[0]}
          </p>
        ),
      )}
    </div>
  );
}

function StructuredBullets({ bullets }: { bullets?: ReportSectionBullet[] }) {
  if (!bullets?.length) return null;
  const cleaned = bullets
    .map(normalizeDisplayBullet)
    .filter((bullet): bullet is DisplayBullet => Boolean(bullet));
  if (cleaned.length === 0) return null;
  return (
    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-700 dark:text-ink-300">
      {cleaned.map((bullet, index) => (
        <li
          key={`${
            bullet.kind === "quote"
              ? bullet.quote.slice(0, 60)
              : bullet.text.slice(0, 60)
          }-${index}`}
        >
          {bullet.kind === "quote" ? (
            <>
              <span>{`"${bullet.quote}"`}</span>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                <li>
                  Source:{" "}
                  {bullet.videoId ? (
                    <Link to={`/videos/${bullet.videoId}`} className="link-brand">
                      {bullet.citation}
                    </Link>
                  ) : (
                    bullet.citation
                  )}
                </li>
              </ul>
            </>
          ) : (
            bullet.text
          )}
        </li>
      ))}
    </ul>
  );
}

function normalizeDisplayBullet(
  bullet: ReportSectionBullet,
): DisplayBullet | null {
  if (typeof bullet !== "string" && bullet.quote && bullet.citation) {
    const quote = sanitizeReaderText(bullet.quote);
    const citation = sanitizeReaderText(bullet.citation);
    if (
      quote &&
      citation &&
      !isInstructionLeak(quote) &&
      !isInstructionLeak(citation)
    ) {
      return {
        kind: "quote",
        quote,
        citation,
        videoId: bullet.videoId,
      };
    }
  }

  const text = sanitizeReaderText(flattenBullet(bullet));
  if (!text || isInstructionLeak(text)) return null;
  return { kind: "text", text };
}

function flattenBullet(bullet: ReportSectionBullet): string {
  if (typeof bullet === "string") return bullet;
  return [bullet.claim, bullet.implication, bullet.caveat]
    .filter(Boolean)
    .join(" ");
}

function sanitizeReaderText(value: string): string {
  return value
    .replace(
      /\b[Tt]he\s+trendLabel\s+is\s+stable\.?\s*/g,
      "The available timeline suggests a stable pattern. ",
    )
    .replace(/\b[Tt]rendLabel\b/g, "timeline signal")
    .replace(/\bmovementLabel\b/g, "movement signal")
    .replace(/\bdominantStance\b/g, "dominant stance")
    .replace(/\bconfidenceScore\b/g, "confidence score")
    .replace(/\s+/g, " ")
    .trim();
}

function isInstructionLeak(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("section must feature") ||
    lower.includes("supplied verbatim quotes") ||
    lower.includes("return valid json") ||
    lower.includes("output json only")
  );
}

/**
 * ReportDetailPage — the full rendered report, route `/reports/:reportId`.
 *
 * Reads the report body from `report.evidence` (the frontend `Report` field
 * renamed `evidenceJson` → `evidence`) and renders, in order: a summary card,
 * the `evidence.sections` array as headed bullet lists (see SectionBody), a
 * sources/citations list built from `evidence.evidence` (each cited video /
 * topic deep-links when the API resolved an id), and finally the standardized
 * caveats panel ("This report is generated from transcripts only, not the
 * speaker's private beliefs…").
 */
export function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const [selectedPoint, setSelectedPoint] = useState<StancePoint | null>(null);
  const reportQuery = useQuery({
    queryKey: ["report", reportId],
    queryFn: () => api.get<Report>(`/reports/${reportId}`),
  });
  const reportForChart = reportQuery.data;
  const stanceChartQuery = useQuery({
    queryKey: [
      "report-stance-chart",
      reportForChart?.creatorId,
      reportForChart?.topicId,
    ],
    queryFn: () =>
      api.get<TopicAnalysis>(
        `/creators/${reportForChart!.creatorId}/topics/${reportForChart!.topicId}/analysis`,
      ),
    enabled: !!reportForChart?.creatorId && !!reportForChart?.topicId,
  });
  const stancePoints = useMemo(
    () =>
      stanceChartQuery.data ? buildStancePoints(stanceChartQuery.data) : [],
    [stanceChartQuery.data],
  );

  useEffect(() => {
    setSelectedPoint(null);
  }, [reportId]);

  if (reportQuery.isLoading) return <LoadingState />;
  if (reportQuery.isError)
    return (
      <ErrorState
        message={(reportQuery.error as Error).message}
        onRetry={() => reportQuery.refetch()}
      />
    );
  const report = reportQuery.data!;
  const sections = report.evidence?.sections ?? [];
  const citations = report.evidence?.evidence ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={report.title}
        subtitle={
          <>
            {humanizeLabel(report.reportType)}
            {" · "}
            {report.creator && (
              <Link
                to={`/creators/${report.creator.id}`}
                className="hover:text-brand-700"
              >
                {report.creator.name}
              </Link>
            )}
            {report.topic && (
              <>
                {" · "}
                <Link
                  to={
                    report.creator
                      ? `/creators/${report.creator.id}/topics/${report.topic.id}`
                      : "#"
                  }
                  className="hover:text-brand-700"
                >
                  {report.topic.name}
                </Link>
              </>
            )}
            {" · "}
            {formatDate(report.createdAt)}
          </>
        }
      />

      <AiNote text={strings.ai.reportDisclaimer} />

      {report.topicId && (
        <section className="card card-pad">
          <p className="font-semibold text-ink-900 dark:text-ink-50">
            Stance trajectory
          </p>
          <div className="mt-3">
            {stanceChartQuery.isLoading ? (
              <p className="text-sm text-ink-500 dark:text-ink-400">
                Loading stance chart...
              </p>
            ) : stanceChartQuery.isError ? (
              <p className="text-sm text-ink-500 dark:text-ink-400">
                Stance chart unavailable.
              </p>
            ) : (
              <StanceTrajectoryChart
                points={stancePoints}
                onSelect={setSelectedPoint}
              />
            )}
          </div>
        </section>
      )}

      <section className="card card-pad">
        <p className="font-semibold text-ink-900 dark:text-ink-50">
          {strings.reportDetail.summary}
        </p>
        <p className="text-sm text-ink-700 dark:text-ink-300 mt-2 leading-relaxed whitespace-pre-line">
          {report.summary}
        </p>
      </section>

      {sections.length > 0 && (
        <section className="space-y-4">
          {sections.map((s, i) => (
            /*
             * Key on the heading + index: report sections aren't reordered
             * after render, and pairing the heading with the index keeps the
             * key stable+unique even if two sections share a heading.
             */
            <div key={`${s.heading}-${i}`} className="card card-pad">
              <p className="font-semibold text-ink-900 dark:text-ink-50">
                {s.heading}
              </p>
              <SectionBody body={s.body} />
              <StructuredBullets bullets={s.bullets} />
            </div>
          ))}
        </section>
      )}

      {citations.length > 0 && (
        <section className="card card-pad">
          <p className="font-semibold text-ink-900 dark:text-ink-50">
            {strings.reportDetail.sources}
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {citations.map((c, i) => {
              const label =
                c.videoTitle ??
                c.topic ??
                (c.videoId ? "Source video" : "Source");
              const to = c.videoId
                ? `/videos/${c.videoId}`
                : c.topicId && report.creator
                  ? `/creators/${report.creator.id}/topics/${c.topicId}`
                  : null;
              return (
                <li key={`${label}-${i}`}>
                  {to ? (
                    <Link to={to} className="link-brand font-medium">
                      {label}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink-700 dark:text-ink-300">
                      {label}
                    </span>
                  )}
                  {c.note && (
                    <span className="text-ink-500 dark:text-ink-400">
                      {" "}
                      - {sanitizeReaderText(c.note)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card card-pad bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/60">
        <p className="text-xs uppercase tracking-wide text-amber-800 dark:text-amber-300 font-semibold">
          {strings.reportDetail.caveats}
        </p>
        <p className="text-sm text-amber-900 dark:text-amber-200 mt-2 leading-relaxed">
          {report.caveats}
        </p>
      </section>

      <EpisodeModal
        point={selectedPoint}
        onClose={() => setSelectedPoint(null)}
      />
    </div>
  );
}
