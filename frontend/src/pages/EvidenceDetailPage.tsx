import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { EvidenceDetail } from "../lib/types";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  AiNote,
} from "../components/States";
import { StanceBadge, ConfidenceBadge } from "../components/Badges";
import { formatDate } from "../lib/format";
import { strings } from "../i18n/en";

/**
 * EvidenceDetailPage — the provenance view for one classified chunk,
 * route `/evidence/:analysisId`.
 *
 * Layout shows the chunk in context: the previous chunk (faded) + the
 * main chunk (highlighted) + the next chunk (faded). Around it: the AI's
 * stance + confidence + claim summary + rationale + the verbatim
 * evidence quote pulled from the chunk. A "related evidence" rail at
 * the bottom shows other chunks the AI classified for the same
 * (creator, topic) so you can scan adjacent claims quickly.
 *
 * This page exists because the strongest objection to AI classifiers
 * is "did the AI just make this up?" — seeing the surrounding text
 * proves the citation is real.
 */
export function EvidenceDetailPage() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const evidenceQuery = useQuery({
    queryKey: ["evidence-detail", analysisId],
    queryFn: () => api.get<EvidenceDetail>(`/evidence/${analysisId}`),
  });

  if (evidenceQuery.isLoading) return <LoadingState />;
  if (evidenceQuery.isError)
    return (
      <ErrorState
        message={(evidenceQuery.error as Error).message}
        onRetry={() => evidenceQuery.refetch()}
      />
    );
  const data = evidenceQuery.data!;
  const analysis = data.analysis;

  return (
    <div className="space-y-6">
      <PageHeader
        title={strings.evidenceDetail.title}
        subtitle={
          <>
            <Link
              to={`/creators/${analysis.creator.id}`}
              className="hover:text-brand-700"
            >
              {analysis.creator.name}
            </Link>
            {" · "}
            <Link
              to={`/creators/${analysis.creator.id}/topics/${analysis.topic.id}`}
              className="hover:text-brand-700"
            >
              {analysis.topic.name}
            </Link>
          </>
        }
      />

      <section className="card card-pad space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StanceBadge stance={analysis.stanceLabel} />
          <ConfidenceBadge confidence={analysis.confidenceLabel} />
          <span className="meta-row">
            {strings.evidenceDetail.relevance}{" "}
            {(analysis.relevanceScore * 100).toFixed(0)}% ·{" "}
            {strings.evidenceDetail.confidence}{" "}
            {(analysis.confidenceScore * 100).toFixed(0)}%
          </span>
        </div>
        {analysis.evidenceQuote && (
          <blockquote className="text-base text-ink-900 dark:text-ink-50 border-l-4 border-brand-200 dark:border-brand-800 pl-3 italic">
            “{analysis.evidenceQuote}”
          </blockquote>
        )}
        {analysis.claimSummary && (
          <p className="body-strong">
            <span className="font-semibold">
              {strings.evidenceDetail.claimSummary}:{" "}
            </span>
            {analysis.claimSummary}
          </p>
        )}
        {analysis.rationale && (
          <p className="body-muted">
            <span className="font-semibold">
              {strings.evidenceDetail.rationale}:{" "}
            </span>
            {analysis.rationale}
          </p>
        )}
        {/* Footnotes the stance / confidence / claim / rationale above (all ML
 output) — placed inside this card, not over the verbatim transcript. */}
        <AiNote className="pt-2 mt-1 border-t border-ink-100 dark:border-ink-800" />
      </section>

      <section>
        <h2 className="section-h2">{strings.evidenceDetail.sourceVideo}</h2>
        <div className="card card-pad flex flex-col sm:flex-row gap-4">
          {analysis.video.thumbnailUrl && (
            <img
              src={analysis.video.thumbnailUrl}
              alt=""
              className="w-full sm:w-44 aspect-video object-cover rounded-lg"
            />
          )}
          <div className="flex-1">
            <Link
              to={`/videos/${analysis.video.id}`}
              className="font-semibold text-ink-900 dark:text-ink-50 hover:text-brand-700"
            >
              {analysis.video.title}
            </Link>
            <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
              {formatDate(analysis.video.publishedAt)} ·{" "}
              {strings.evidenceDetail.chunkLabel} {analysis.chunk.chunkIndex}
            </p>
            <a
              href={analysis.video.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand-700 hover:underline mt-2 inline-block"
            >
              {strings.evidenceDetail.openOnYouTube} ↗
            </a>
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-h2">
          {strings.evidenceDetail.transcriptContext}
        </h2>
        <div className="space-y-3">
          {data.previousChunk && (
            <div className="card card-pad bg-ink-50 dark:bg-ink-900">
              <p className="text-xs font-semibold text-ink-500 dark:text-ink-400 mb-1">
                {strings.evidenceDetail.previousChunk} (
                {data.previousChunk.chunkIndex})
              </p>
              <p className="text-sm text-ink-700 dark:text-ink-300 whitespace-pre-line">
                {data.previousChunk.text}
              </p>
            </div>
          )}
          <div className="card card-pad border-brand-200 dark:border-brand-800">
            <p className="text-xs font-semibold text-brand-700 mb-1">
              {strings.evidenceDetail.mainChunk} ({analysis.chunk.chunkIndex})
            </p>
            <p className="text-sm text-ink-900 dark:text-ink-50 whitespace-pre-line">
              {analysis.chunk.text}
            </p>
          </div>
          {data.nextChunk && (
            <div className="card card-pad bg-ink-50 dark:bg-ink-900">
              <p className="text-xs font-semibold text-ink-500 dark:text-ink-400 mb-1">
                {strings.evidenceDetail.nextChunk} ({data.nextChunk.chunkIndex})
              </p>
              <p className="text-sm text-ink-700 dark:text-ink-300 whitespace-pre-line">
                {data.nextChunk.text}
              </p>
            </div>
          )}
        </div>
      </section>

      {data.relatedEvidence.length > 0 && (
        <section>
          <h2 className="section-h2">{strings.evidenceDetail.related}</h2>
          <div className="space-y-3">
            {data.relatedEvidence.map((r) => (
              <Link
                key={r.id}
                to={`/evidence/${r.id}`}
                className="card card-pad block hover:border-brand-300 transition"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StanceBadge stance={r.stanceLabel} />
                  <ConfidenceBadge confidence={r.confidenceLabel} />
                  <span className="meta-row">
                    {strings.evidenceDetail.chunkLabel} {r.chunk.chunkIndex}
                  </span>
                </div>
                {r.evidenceQuote && (
                  <p className="text-sm text-ink-700 dark:text-ink-300 mt-2 italic">
                    “{r.evidenceQuote}”
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
