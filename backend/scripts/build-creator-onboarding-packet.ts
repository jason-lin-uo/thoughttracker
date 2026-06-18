/**
 * Build a human-review packet for onboarding a new creator's analyses.
 *
 * Walks every video → chunk → analysis for the requested creator slugs,
 * flags chunks whose existing labels look risky (low confidence, weak
 * relevance, missing evidence quote, unclear/insufficient stance, or no
 * analysis at all), and writes a self-contained review bundle:
 * - <OUTPUT_JSONL> one metadata row + one `chunk_review` row per chunk
 * - <OUTPUT_README> reviewer instructions + the expected output schema
 * - <OUTPUT_SUMMARY> counts/thresholds for the run
 *
 * Run with:
 * tsx scripts/build-creator-onboarding-packet.ts --creator-slugs a,b [options]
 *
 * Read-mostly against Postgres (Prisma); only writes files to disk.
 */

import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/prisma";
import { CONTROLLED_TOPIC_TAXONOMY } from "../src/services/topicTaxonomy";

const OUTPUT_JSONL = "creator_onboarding_review_input.jsonl";
const OUTPUT_README = "README_FOR_OWNER_REVIEW.md";
const OUTPUT_SUMMARY = "packet_summary.json";
const SCHEMA_VERSION = "creator_onboarding_packet";
const STANCE_LABELS = [
  "supportive",
  "opposed",
  "neutral",
  "mixed",
  "unclear",
  "insufficient_evidence",
] as const;
const CONFIDENCE_LABELS = ["low", "medium", "high"] as const;
const MEDIUM_RELEVANCE_MAX = 0.6;

type CliOptions = {
  creatorSlugs: string[];
  outDir: string;
  maxRows: number;
  maxConfidence: number;
  minRelevance: number;
};

type RiskDetail = {
  analysisId: string | null;
  topicSlug: string | null;
  reasons: string[];
};

type SelectedChunk = {
  video: Awaited<ReturnType<typeof fetchVideosForCreators>>[number];
  chunk: Awaited<
    ReturnType<typeof fetchVideosForCreators>
  >[number]["chunks"][number];
  previousChunk: NeighborChunk | null;
  nextChunk: NeighborChunk | null;
  riskReasons: string[];
  riskDetails: RiskDetail[];
};

type NeighborChunk = {
  id: string;
  chunkIndex: number;
  text: string;
};

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * Filesystem-safe ISO timestamp (colons and dots → dashes) for naming
 * the default output directory.
 *
 * @returns e.g. `2026-06-07T13-52-04-123Z`.
 */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Default output directory when `--out-dir` is omitted:
 * `<cwd>/tmp/creator-onboarding-packet-<timestamp>`.
 *
 * @returns absolute path to a fresh, run-unique output directory.
 */
function defaultOutDir(): string {
  return path.resolve(
    process.cwd(),
    "tmp",
    `creator-onboarding-packet-${timestamp()}`,
  );
}

/**
 * Read a CLI flag's value, supporting both `--name value` and
 * `--name=value` spellings.
 *
 * @param argv - argument vector (already sliced past `node script`).
 * @param name - the flag to look up, including leading dashes.
 * @returns the value, or `undefined` if the flag is absent.
 */
function valueForArg(argv: string[], name: string): string | undefined {
  const exactIndex = argv.indexOf(name);
  if (exactIndex !== -1) return argv[exactIndex + 1];

  /* Fall back to the inline `--name=value` form. */
  const prefix = `${name}=`;
  /* First argv entry beginning with `--name=`, if any. */
  const inlineArg = argv.find((arg) => arg.startsWith(prefix));
  return inlineArg ? inlineArg.slice(prefix.length) : undefined;
}

/**
 * Parse a CLI value as a strictly-positive integer, or fall back.
 *
 * @param value - raw string from the flag, or `undefined` if absent.
 * @param fallback - value to use when the flag is absent.
 * @param name - flag name, for the error message.
 * @returns the parsed positive integer.
 * @throws CliError if `value` is present but not a positive integer.
 */
function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${name} must be a positive integer.`);
  }
  return parsed;
}

/**
 * Parse a CLI value as a score in the closed range [0, 1], or fall back.
 *
 * @param value - raw string from the flag, or `undefined` if absent.
 * @param fallback - value to use when the flag is absent.
 * @param name - flag name, for the error message.
 * @returns the parsed score in [0, 1].
 * @throws CliError if `value` is present but outside [0, 1] or non-finite.
 */
function parseScore(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new CliError(`${name} must be a number from 0 to 1.`);
  }
  return parsed;
}

/**
 * Parse and validate the script's command-line arguments into a
 * normalized `CliOptions`.
 *
 * Honors `--help`/`-h` (throws a `CliError` carrying the usage text),
 * de-duplicates creator slugs, resolves the output directory to an
 * absolute path, and applies the documented defaults / bounds for
 * `--max-rows`, `--max-confidence`, and `--min-relevance`.
 *
 * @param argv - argument vector; defaults to `process.argv.slice(2)`.
 * @returns the validated options.
 * @throws CliError on `--help` or when `--creator-slugs` is missing/empty.
 */
export function parseArgs(argv = process.argv.slice(2)): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    throw new CliError(
      [
        "Usage: tsx scripts/build-creator-onboarding-packet.ts --creator-slugs <slug-a,slug-b> [options]",
        "",
        "Options:",
        " --out-dir <path> Output directory. Defaults to backend/tmp/creator-onboarding-packet-<timestamp>.",
        " --max-rows <n> Maximum selected chunk rows to write. Default: 500.",
        " --max-confidence <n> Select analyses at or below this confidence score. Default: 0.72.",
        " --min-relevance <n> Score below which relevance is treated as low. Default: 0.35.",
      ].join("\n"),
    );
  }

  const creatorSlugs = (valueForArg(argv, "--creator-slugs") ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);

  if (creatorSlugs.length === 0) {
    throw new CliError(
      "--creator-slugs is required and must contain at least one slug.",
    );
  }

  return {
    creatorSlugs: Array.from(new Set(creatorSlugs)),
    outDir: path.resolve(valueForArg(argv, "--out-dir") ?? defaultOutDir()),
    maxRows: parsePositiveInt(
      valueForArg(argv, "--max-rows"),
      500,
      "--max-rows",
    ),
    maxConfidence: parseScore(
      valueForArg(argv, "--max-confidence"),
      0.72,
      "--max-confidence",
    ),
    minRelevance: parseScore(
      valueForArg(argv, "--min-relevance"),
      0.35,
      "--min-relevance",
    ),
  };
}

/**
 * True when `value` is a string with at least one non-whitespace
 * character. Used to detect a present-but-meaningful evidence quote.
 *
 * @param value - candidate string (may be null/undefined).
 */
function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * De-duplicate and locale-sort a list of strings (e.g. risk reasons or
 * slugs) so packet output is stable and diff-friendly.
 *
 * @param values - input strings, possibly with duplicates.
 * @returns a new array of unique values in locale order.
 */
function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

/**
 * Load the full video → chunk → analysis tree for the given creators in
 * one Prisma query, deterministically ordered at every level so packet
 * output is reproducible across runs.
 *
 * The returned row shape is the source of truth for `SelectedChunk` and
 * the JSONL row builders (derived via `Awaited<ReturnType<...>>`).
 *
 * @param creatorIds - creator primary keys to fetch videos for.
 * @returns videos with nested creator, chunks, analyses, and topics.
 */
async function fetchVideosForCreators(creatorIds: string[]) {
  return prisma.video.findMany({
    where: { creatorId: { in: creatorIds } },
    orderBy: [
      { creator: { slug: "asc" } },
      { publishedAt: "asc" },
      { title: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      creatorId: true,
      sourceVideoId: true,
      sourceUrl: true,
      title: true,
      publishedAt: true,
      durationSeconds: true,
      transcriptStatus: true,
      analysisStatus: true,
      creator: {
        select: {
          id: true,
          slug: true,
          name: true,
        },
      },
      chunks: {
        orderBy: { chunkIndex: "asc" },
        select: {
          id: true,
          chunkIndex: true,
          text: true,
          startSeconds: true,
          endSeconds: true,
          speaker: true,
          tokenCount: true,
          analyses: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              relevanceScore: true,
              stanceLabel: true,
              confidenceScore: true,
              confidenceLabel: true,
              claimSummary: true,
              rationale: true,
              evidenceQuote: true,
              createdAt: true,
              topic: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  description: true,
                  source: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

/**
 * Compute the set of machine-readable risk reasons that make a single
 * analysis worth re-reviewing (low confidence score/label, missing
 * evidence quote, low/medium relevance, or unclear/insufficient stance).
 *
 * @param analysis - one analysis row off a chunk.
 * @param options - the `maxConfidence` / `minRelevance` thresholds.
 * @returns unique, sorted reason codes; empty when the analysis is clean.
 */
function analysisRiskReasons(
  analysis: SelectedChunk["chunk"]["analyses"][number],
  options: Pick<CliOptions, "maxConfidence" | "minRelevance">,
): string[] {
  const reasons: string[] = [];

  if (analysis.confidenceScore <= options.maxConfidence)
    reasons.push("low_confidence_score");
  if (
    analysis.confidenceLabel === "low" ||
    analysis.confidenceLabel === "medium"
  ) {
    reasons.push("low_or_medium_confidence_label");
  }
  if (!hasText(analysis.evidenceQuote)) reasons.push("missing_evidence_quote");
  if (analysis.relevanceScore < options.minRelevance)
    reasons.push("low_relevance_score");
  if (
    analysis.relevanceScore >= options.minRelevance &&
    analysis.relevanceScore < MEDIUM_RELEVANCE_MAX
  ) {
    reasons.push("medium_relevance_score");
  }
  if (analysis.stanceLabel === "unclear") reasons.push("unclear_stance");
  if (analysis.stanceLabel === "insufficient_evidence")
    reasons.push("insufficient_evidence_stance");

  return uniqueSorted(reasons);
}

/**
 * Flatten the video tree into the flat list of chunks that warrant
 * review, attaching previous/next chunk context and the per-analysis
 * risk details for each one.
 *
 * A chunk is selected when it has no analyses at all (reason
 * `no_analyses`) or when at least one of its analyses produced risk
 * reasons via `analysisRiskReasons`; clean chunks are skipped.
 *
 * @param videos - the fetched video → chunk → analysis tree.
 * @param options - the `maxConfidence` / `minRelevance` thresholds.
 * @returns selected chunks in video/chunk order, pre-cap.
 */
function selectChunksFromVideos(
  videos: Awaited<ReturnType<typeof fetchVideosForCreators>>,
  options: Pick<CliOptions, "maxConfidence" | "minRelevance">,
): SelectedChunk[] {
  const selected: SelectedChunk[] = [];

  for (const video of videos) {
    /* Index this video's chunks by chunkIndex so we can attach neighbor context in O(1). */
    const chunkByIndex = new Map(
      video.chunks.map((chunk) => [chunk.chunkIndex, chunk]),
    );

    for (const chunk of video.chunks) {
      const riskDetails: RiskDetail[] = [];

      if (chunk.analyses.length === 0) {
        riskDetails.push({
          analysisId: null,
          topicSlug: null,
          reasons: ["no_analyses"],
        });
      } else {
        for (const analysis of chunk.analyses) {
          const reasons = analysisRiskReasons(analysis, options);
          if (reasons.length > 0) {
            riskDetails.push({
              analysisId: analysis.id,
              topicSlug: analysis.topic.slug,
              reasons,
            });
          }
        }
      }

      if (riskDetails.length === 0) continue;

      const previousChunk = chunkByIndex.get(chunk.chunkIndex - 1);
      const nextChunk = chunkByIndex.get(chunk.chunkIndex + 1);

      selected.push({
        video,
        chunk,
        previousChunk: previousChunk
          ? {
              id: previousChunk.id,
              chunkIndex: previousChunk.chunkIndex,
              text: previousChunk.text,
            }
          : null,
        nextChunk: nextChunk
          ? {
              id: nextChunk.id,
              chunkIndex: nextChunk.chunkIndex,
              text: nextChunk.text,
            }
          : null,
        riskReasons: uniqueSorted(
          riskDetails.flatMap((detail) => detail.reasons),
        ),
        riskDetails,
      });
    }
  }

  return selected;
}

/**
 * Build the first JSONL line: a `metadata` row carrying packet settings,
 * the controlled taxonomy, and the label vocabularies the reviewer
 * should adjudicate against.
 *
 * @param options - the resolved CLI options (thresholds, caps).
 * @param packet - the run summary (generatedAt, slug matches, counts).
 * @returns a plain object ready to `JSON.stringify` as one JSONL line.
 */
function metadataRow(options: CliOptions, packet: PacketSummary) {
  return {
    rowType: "metadata",
    schemaVersion: SCHEMA_VERSION,
    generatedAt: packet.generatedAt,
    packet: {
      requestedCreatorSlugs: packet.requestedCreatorSlugs,
      matchedCreatorSlugs: packet.matchedCreatorSlugs,
      unmatchedCreatorSlugs: packet.unmatchedCreatorSlugs,
      maxRows: options.maxRows,
      maxConfidence: options.maxConfidence,
      minRelevance: options.minRelevance,
      rowCount: packet.rowsWritten,
      truncated: packet.truncated,
      outputFile: OUTPUT_JSONL,
    },
    controlledTaxonomy: CONTROLLED_TOPIC_TAXONOMY,
    stanceLabels: STANCE_LABELS,
    confidenceLabels: CONFIDENCE_LABELS,
    reviewOutput: {
      fileName: "creator_onboarding_review_labels_all.jsonl",
      oneJsonObjectPerInputChunk: true,
      ignoreMetadataRowForAdjudication: true,
    },
  };
}

/**
 * Build one `chunk_review` JSONL line from a selected chunk: a stable
 * `reviewId`, the creator/video/chunk context (including neighbors), the
 * existing analyses (sorted by topic then id), and the risk reasons.
 *
 * @param selected - one entry from `selectChunksFromVideos`.
 * @returns a plain object ready to `JSON.stringify` as one JSONL line.
 */
function chunkRow(selected: SelectedChunk) {
  const { video, chunk } = selected;

  return {
    rowType: "chunk_review",
    schemaVersion: SCHEMA_VERSION,
    reviewId: `${video.creator.slug}:${video.id}:${chunk.chunkIndex}`,
    creator: {
      id: video.creator.id,
      slug: video.creator.slug,
      name: video.creator.name,
    },
    video: {
      id: video.id,
      sourceVideoId: video.sourceVideoId,
      sourceUrl: video.sourceUrl,
      title: video.title,
      publishedAt: video.publishedAt?.toISOString() ?? null,
      durationSeconds: video.durationSeconds,
      transcriptStatus: video.transcriptStatus,
      analysisStatus: video.analysisStatus,
    },
    chunk: {
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      startSeconds: chunk.startSeconds,
      endSeconds: chunk.endSeconds,
      speaker: chunk.speaker,
      tokenCount: chunk.tokenCount,
      text: chunk.text,
      previous: selected.previousChunk,
      next: selected.nextChunk,
    },
    existingAnalyses: chunk.analyses
      .map((analysis) => ({
        id: analysis.id,
        topic: analysis.topic,
        relevanceScore: analysis.relevanceScore,
        stanceLabel: analysis.stanceLabel,
        confidenceScore: analysis.confidenceScore,
        confidenceLabel: analysis.confidenceLabel,
        claimSummary: analysis.claimSummary,
        rationale: analysis.rationale,
        evidenceQuote: analysis.evidenceQuote,
        createdAt: analysis.createdAt.toISOString(),
      }))
      .sort(
        (a, b) =>
          a.topic.slug.localeCompare(b.topic.slug) || a.id.localeCompare(b.id),
      ),
    riskReasons: selected.riskReasons,
    riskDetails: selected.riskDetails.sort(
      (a, b) =>
        (a.topicSlug ?? "").localeCompare(b.topicSlug ?? "") ||
        (a.analysisId ?? "").localeCompare(b.analysisId ?? ""),
    ),
  };
}

/**
 * Render the `README_FOR_OWNER_REVIEW.md` contents: the reviewer task,
 * the exact expected output filename + JSON schema, the adjudication
 * rules, and a packet-info footer echoing this run's settings/counts.
 *
 * @param options - the resolved CLI options (thresholds, caps).
 * @param packet - the run summary used to fill the packet-info section.
 * @returns the full markdown document as a string.
 */
function readme(options: CliOptions, packet: PacketSummary): string {
  return [
    "# Creator Onboarding Review Packet",
    "",
    `Use \`${OUTPUT_JSONL}\` as the input file. The first line is metadata containing packet settings and the controlled taxonomy. Every remaining line is one transcript chunk selected for review.`,
    "",
    "## Task",
    "",
    "For each `chunk_review` row, adjudicate whether the existing topic and stance labels are correct. Use the chunk text plus previous/next chunk context. Prefer the controlled taxonomy from the metadata row. Only add a new topic name when no controlled taxonomy topic fits.",
    "",
    "Write the result as JSONL to this exact file name:",
    "",
    "```text",
    "creator_onboarding_review_labels_all.jsonl",
    "```",
    "",
    "Output exactly one JSON object per `chunk_review` input row. Do not output a row for the metadata line. Keep each JSON object on one line.",
    "",
    "## Output Schema",
    "",
    "```json",
    JSON.stringify(
      {
        rowType: "adjudication",
        schemaVersion: SCHEMA_VERSION,
        reviewId: "copy from input reviewId",
        chunkId: "copy from input chunk.id",
        creatorSlug: "copy from input creator.slug",
        videoId: "copy from input video.id",
        chunkIndex: 0,
        correctedTopics: [
          {
            topicSlug: "controlled taxonomy slug, or null for a new topic",
            topicName: "controlled taxonomy name, or proposed new topic name",
            relevanceLabel: "relevant | maybe_relevant | not_relevant",
            relevanceScore: 0.0,
            stanceLabel:
              "supportive | opposed | neutral | mixed | unclear | insufficient_evidence",
            stanceConfidence: 0.0,
            evidenceQuote:
              "short exact quote from chunk text, or null when unavailable",
            claimSummary: "brief neutral summary of the claim, or null",
            rationale: "brief reason for the corrected labels",
          },
        ],
        removeExistingTopicSlugs: [
          "topic slugs from existingAnalyses that should be removed",
        ],
        notes: "short reviewer notes, or null",
      },
      null,
      2,
    ),
    "```",
    "",
    "## Review Rules",
    "",
    "- Use `insufficient_evidence` when the chunk does not contain enough evidence for a stance.",
    "- Use `unclear` when the creator is discussing the topic but the stance is ambiguous.",
    "- Use `neutral` for descriptive or balanced discussion with enough evidence but no clear support/opposition.",
    "- Use `mixed` only when the chunk contains both supportive and opposed claims.",
    "- Set `evidenceQuote` to text copied from the current chunk, not from neighboring context.",
    "- Leave `correctedTopics` empty when no topic should be attached to the chunk.",
    "",
    "## Packet Info",
    "",
    `- Generated: ${packet.generatedAt}`,
    `- Requested creators: ${packet.requestedCreatorSlugs.join(", ")}`,
    `- Matched creators: ${packet.matchedCreatorSlugs.join(", ")}`,
    `- Unmatched creators: ${packet.unmatchedCreatorSlugs.length > 0 ? packet.unmatchedCreatorSlugs.join(", ") : "none"}`,
    `- Rows written: ${packet.rowsWritten}`,
    `- Max rows: ${options.maxRows}`,
    `- Max confidence threshold: ${options.maxConfidence}`,
    `- Min relevance threshold: ${options.minRelevance}`,
    `- Truncated: ${packet.truncated}`,
    "",
  ].join("\n");
}

type PacketSummary = {
  ok: true;
  generatedAt: string;
  outDir: string;
  files: {
    jsonl: string;
    readme: string;
    summary: string;
  };
  requestedCreatorSlugs: string[];
  matchedCreatorSlugs: string[];
  unmatchedCreatorSlugs: string[];
  maxRows: number;
  maxConfidence: number;
  minRelevance: number;
  creatorsMatched: number;
  videosScanned: number;
  chunksScanned: number;
  analysesScanned: number;
  selectedChunksBeforeCap: number;
  rowsWritten: number;
  chunksWithoutAnalysesSelected: number;
  truncated: boolean;
};

/**
 * Orchestrate the whole packet build: resolve creators by slug, fetch
 * their video tree, select risky chunks, cap to `maxRows`, then write
 * the JSONL, README, and summary files to `options.outDir`.
 *
 * @param options - the resolved CLI options.
 * @returns the `PacketSummary` (also written to disk as the summary file).
 * @throws CliError when none of the requested slugs match a creator.
 */
async function buildPacket(options: CliOptions): Promise<PacketSummary> {
  const creators = await prisma.creator.findMany({
    where: { slug: { in: options.creatorSlugs } },
    select: { id: true, slug: true, name: true },
    orderBy: { slug: "asc" },
  });

  if (creators.length === 0) {
    throw new CliError(
      `No matching creators found for slugs: ${options.creatorSlugs.join(", ")}`,
    );
  }

  /* Slugs that actually resolved to a creator row... */
  const matchedSlugs = creators.map((creator) => creator.slug);
  /* ...and the requested slugs that didn't, surfaced in the summary/README. */
  const unmatchedSlugs = options.creatorSlugs.filter(
    (slug) => !matchedSlugs.includes(slug),
  );
  /* Pull the full analysis tree for the matched creators in one query. */
  const videos = await fetchVideosForCreators(
    creators.map((creator) => creator.id),
  );
  const selectedBeforeCap = selectChunksFromVideos(videos, options);
  const selected = selectedBeforeCap.slice(0, options.maxRows);

  const jsonlPath = path.join(options.outDir, OUTPUT_JSONL);
  const readmePath = path.join(options.outDir, OUTPUT_README);
  const summaryPath = path.join(options.outDir, OUTPUT_SUMMARY);
  const generatedAt = new Date().toISOString();
  const summary: PacketSummary = {
    ok: true,
    generatedAt,
    outDir: options.outDir,
    files: {
      jsonl: jsonlPath,
      readme: readmePath,
      summary: summaryPath,
    },
    requestedCreatorSlugs: options.creatorSlugs,
    matchedCreatorSlugs: matchedSlugs,
    unmatchedCreatorSlugs: unmatchedSlugs,
    maxRows: options.maxRows,
    maxConfidence: options.maxConfidence,
    minRelevance: options.minRelevance,
    creatorsMatched: creators.length,
    videosScanned: videos.length,
    chunksScanned: videos.reduce((sum, video) => sum + video.chunks.length, 0),
    analysesScanned: videos.reduce(
      (sum, video) =>
        sum +
        video.chunks.reduce(
          (chunkSum, chunk) => chunkSum + chunk.analyses.length,
          0,
        ),
      0,
    ),
    selectedChunksBeforeCap: selectedBeforeCap.length,
    rowsWritten: selected.length,
    chunksWithoutAnalysesSelected: selected.filter(
      (row) => row.chunk.analyses.length === 0,
    ).length,
    truncated: selectedBeforeCap.length > selected.length,
  };

  const jsonlRows = [metadataRow(options, summary), ...selected.map(chunkRow)];

  fs.mkdirSync(options.outDir, { recursive: true });
  fs.writeFileSync(
    jsonlPath,
    `${jsonlRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf-8",
  );
  fs.writeFileSync(readmePath, readme(options, summary), "utf-8");
  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf-8",
  );

  return summary;
}

/**
 * CLI entry point: parse args, build the packet, and print the run
 * summary as a single JSON line to stdout (error handling and Prisma
 * teardown live in the `require.main === module` guard below).
 */
async function main() {
  const options = parseArgs();
  const summary = await buildPacket(options);
  console.log(JSON.stringify(summary));
}

if (require.main === module) {
  main()
    .catch((error) => {
      const message =
        error instanceof CliError ? error.message : (error as Error).message;
      console.error(`[build-creator-onboarding-packet] ${message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
