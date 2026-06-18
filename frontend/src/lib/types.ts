/**
 * The classifier's verdict on a creator's position toward a topic in a
 * given chunk. `unclear` means a stance was discussed but couldn't be
 * pinned down; `insufficient_evidence` means there wasn't enough signal
 * to attempt a call at all. `mixed` is a genuine both-sides stance.
 */
export type StanceLabel =
  | "supportive"
  | "opposed"
  | "neutral"
  | "mixed"
  | "unclear"
  | "insufficient_evidence";

/** How much the model trusts its own stance call (bucketed score). */
export type ConfidenceLabel = "low" | "medium" | "high";

/**
 * Direction of a creator's stance on a topic across a time window.
 * `gradual_shift` vs `abrupt_shift` distinguishes a slow drift from a
 * sharp pivot; `insufficient_data` means too few data points to judge.
 */
export type TrendLabel =
  | "stable"
  | "gradual_shift"
  | "abrupt_shift"
  | "mixed"
  | "insufficient_data";

/**
 * Whether a transcript exists for a video. `available` = auto-fetched
 * (e.g. from captions), `manual` = supplied by hand, `unavailable` =
 * none could be obtained (no captions), `failed` = an error occurred
 * while fetching. Distinct from `AnalysisStatus`: a transcript can be
 * `available` while analysis is still `pending`.
 */
export type TranscriptStatus =
  | "pending"
  | "available"
  | "unavailable"
  | "failed"
  | "manual";

/** Lifecycle of the AI analysis pass over a video's transcript. */
export type AnalysisStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Status of a whole import job (one channel-import run covering many
 * videos). `completed_with_errors` is the partial-success terminal state:
 * the job finished but some individual items failed — contrast with
 * `failed`, which is a job-level failure. Per-video outcomes live in
 * `ImportJobItemStatus`, not here.
 */
export type ImportJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "failed";

/**
 * Status of a single video within an import job. Unlike the job-level
 * `ImportJobStatus` (which is a generic lifecycle), these values track
 * how far one video advanced through the pipeline stages:
 * metadata → transcript → analysis. `transcript_unavailable` is a benign
 * stop (no captions to import, not an error), whereas `failed` is a hard
 * error on that item. A job can be `completed_with_errors` while holding
 * a mix of `analysis_completed` and `failed`/`transcript_unavailable` items.
 */
export type ImportJobItemStatus =
  | "pending"
  | "metadata_imported"
  | "transcript_imported"
  | "analysis_completed"
  | "transcript_unavailable"
  | "failed";

/** Which kind of generated report: per-creator overview vs per-topic deep-dive. */
export type ReportType = "creator_summary" | "topic_summary";

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Creator {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  thumbnailUrl: string | null;
  creatorType: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorListItem extends Creator {
  videoCount: number;
  transcriptCount: number;
  topicCount: number;
  lastImportedAt: string | null;
}

export interface Topic {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface Video {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  sourceUrl: string;
  sourceVideoId: string;
  transcriptStatus: TranscriptStatus;
  analysisStatus: AnalysisStatus;
  creator?: { id: string; name: string; slug: string };
  _count?: { chunks: number; videoSummaries: number };
}

export interface ImportJob {
  id: string;
  channelUrl: string;
  requestedLimit: number;
  status: ImportJobStatus;
  totalVideosFound: number;
  totalVideosImported: number;
  totalTranscriptsImported: number;
  totalFailed: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  creator?: { id: string; name: string; slug: string } | null;
}

export interface ImportJobItem {
  id: string;
  sourceVideoId: string;
  sourceUrl: string;
  title: string | null;
  publishedAt: string | null;
  status: ImportJobItemStatus;
  transcriptStatus: TranscriptStatus;
  analysisStatus: AnalysisStatus;
  errorMessage: string | null;
  video?: {
    id: string;
    title: string;
    transcriptStatus: TranscriptStatus;
    analysisStatus: AnalysisStatus;
    publishedAt: string | null;
    sourceUrl: string;
    thumbnailUrl: string | null;
  } | null;
}

export interface VideoTopicSummary {
  id: string;
  videoId: string;
  topicId: string;
  creatorId: string;
  dominantStance: StanceLabel;
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  mentionCount: number;
  summary: string | null;
  topic?: Topic;
}

export interface ChunkTopicAnalysis {
  id: string;
  chunkId: string;
  videoId: string;
  creatorId: string;
  topicId: string;
  relevanceScore: number;
  stanceLabel: StanceLabel;
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  claimSummary: string | null;
  rationale: string | null;
  evidenceQuote: string | null;
  createdAt: string;
  creator?: { id: string; name: string; slug: string };
  topic?: Topic;
  video?: {
    id: string;
    title: string;
    sourceUrl: string;
    publishedAt: string | null;
    thumbnailUrl: string | null;
  };
  chunk?: {
    id: string;
    chunkIndex: number;
    startSeconds: number | null;
    endSeconds: number | null;
  };
}

export interface CreatorOverview {
  creator: Creator;
  stats: {
    videoCount: number;
    transcriptCount: number;
    topicCount: number;
    evidenceCount: number;
  };
  topTopics: Array<{
    topicId: string;
    name: string;
    slug: string;
    videoCount: number;
    mentionCount: number;
    dominantStance: StanceLabel;
  }>;
  recentVideos: Array<Video>;
  latestReport: Report | null;
  recentImport: ImportJob | null;
}

export interface TopicAnalysis {
  creator: Creator;
  topic: Topic;
  timeline: TimelineEntry | null;
  summaries: Array<
    VideoTopicSummary & {
      /**
       * Verbatim pull-quotes for this (video, topic) pairing. Surfaced by the
       * analyst console's trajectory/heatmap click-modal as the episode's
       * notable evidence. Each entry is a `{ quote, chunkIndex }` object as
       * emitted by the backend's VideoTopicSummary — NOT a bare string.
       * Optional because older payloads omit it; the console falls back to a
       * matching `topEvidence` quote when absent.
       */
      notableEvidence?: Array<{ quote: string; chunkIndex: number }>;
      video: {
        id: string;
        title: string;
        publishedAt: string | null;
        sourceUrl: string;
        thumbnailUrl: string | null;
      };
    }
  >;
  topEvidence: ChunkTopicAnalysis[];
  report: Report | null;
}

export interface TimelineEntry {
  id: string;
  creatorId: string;
  topicId: string;
  dateStart: string | null;
  dateEnd: string | null;
  trendLabel: TrendLabel;
  summary: string | null;
}

export interface Report {
  id: string;
  creatorId: string;
  topicId: string | null;
  reportType: ReportType;
  title: string;
  summary: string;
  caveats: string;
  /* The report body JSON (DB column `evidence`): the section list + citations.
 Citations carry the source's display label (videoTitle / topic) plus the
 deep-link id the API resolves (videoId / topicId, null when unmatched). */
  evidence: {
    sections?: Array<{
      heading: string;
      body?: string;
      bullets?: Array<
        | string
        | {
            claim?: string;
            evidence?: string;
            implication?: string;
            caveat?: string;
            confidence?: "high" | "medium" | "low";
            quote?: string;
            citation?: string;
            videoId?: string | null;
          }
      >;
    }>;
    evidence?: Array<{
      videoTitle?: string;
      topic?: string;
      videoId?: string | null;
      topicId?: string | null;
      analysisId?: string;
      note?: string;
    }>;
  } | null;
  createdAt: string;
  creator?: { id: string; name: string; slug: string };
  topic?: { id: string; name: string; slug: string };
}

export interface StancePoint {
  date: string;
  averageStance: number | null;
  count: number;
}

export interface TopicFrequencyResponse {
  points: Array<{ date: string; topics: Record<string, number> }>;
  topics: Array<{ id: string; name: string }>;
}

/**
 * The dashboard hero's "featured insight", derived server-side. The backend
 * prefers the latest topic report when one maps to an analyzed timeline, then
 * falls back to the strongest analyzed timeline. Null only when nothing has
 * been analyzed yet.
 */
export interface FeaturedInsight {
  creatorId: string;
  creatorName: string;
  topicId: string;
  topicName: string;
  trendLabel: TrendLabel;
  summary: string | null;
  /* Backing topic report id. Hero deep-links here; null falls back to topic page. */
  reportId: string | null;
  /* Backing report title. Hero headline uses it so it matches the opened report. */
  reportTitle: string | null;
}

export interface DashboardResponse {
  stats: {
    creators: number;
    videos: number;
    transcripts: number;
    topics: number;
    evidence: number;
  };
  featuredInsight: FeaturedInsight | null;
  recentJobs: ImportJob[];
  recentCreators: Array<Creator & { _count: { videos: number } }>;
  recentReports: Report[];
}

export interface CreatorComparison {
  creators: Array<{
    creatorId: string;
    name: string;
    slug: string;
    thumbnailUrl: string | null;
    videoCount: number;
    transcriptCount: number;
    topicCount: number;
    evidenceCount: number;
  }>;
  sharedTopics: Array<{
    topicId: string;
    name: string;
    slug: string;
    perCreator: Array<{
      creatorId: string;
      dominantStance: StanceLabel | "insufficient_evidence";
      mentionCount: number;
      videoCount: number;
    }>;
  }>;
  timeline: {
    points: Array<{
      date: string;
      values: Record<string, number | null>;
    }>;
  };
}

export interface EvidenceDetail {
  analysis: ChunkTopicAnalysis & {
    creator: Creator;
    topic: Topic;
    video: Video;
    chunk: {
      id: string;
      chunkIndex: number;
      text: string;
      startSeconds: number | null;
      endSeconds: number | null;
    };
  };
  previousChunk: {
    id: string;
    chunkIndex: number;
    text: string;
    startSeconds: number | null;
    endSeconds: number | null;
  } | null;
  nextChunk: {
    id: string;
    chunkIndex: number;
    text: string;
    startSeconds: number | null;
    endSeconds: number | null;
  } | null;
  relatedEvidence: Array<
    ChunkTopicAnalysis & { chunk: { chunkIndex: number } }
  >;
}
