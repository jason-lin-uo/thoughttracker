import { runLlm } from "../ai/llmClient";
import {
  CREATOR_REPORT_PROMPT_VERSION,
  CREATOR_REPORT_SYSTEM,
  buildCreatorReportUserPrompt,
} from "../ai/prompts/creatorReport.prompt";
import {
  TOPIC_REPORT_PROMPT_VERSION,
  TOPIC_REPORT_SYSTEM,
  buildTopicReportUserPrompt,
} from "../ai/prompts/topicReport.prompt";
import {
  ReportResponseSchema,
  type ReportResponse,
  type ReportSection,
} from "../ai/schemas/report.schema";

const STANDARD_REPORT_CAVEAT =
  "This report is based only on the imported transcript data available in ThoughtTracker. It should be interpreted as an evidence-backed summary of transcript patterns, not a definitive judgment of the creator's beliefs.";

/**
 * generateCreatorReport — write the high-level "what does this creator
 * talk about and where do they stand" narrative report for one
 * creator.
 *
 * Structure (creator-report-v3): a SYNTHESIS, not a per-topic list. The
 * prompt asks for a finding-led title, a 3-5 sentence summary, and 3-6
 * THEMATIC insight sections drawn from {Most Outspoken On, Biggest Shift,
 * Where They Stay Neutral, Tensions & Contradictions, Limitations} — each
 * grounded in cited evidence (topic/video), never one-section-per-topic.
 * Always ends with the standardized caveats panel so readers don't
 * confuse the report's observations with the speaker's private beliefs.
 * Falls back to a safe stub when the LLM reply fails schema validation.
 */
export async function generateCreatorReport(args: {
  creatorName: string;
  topics: Array<{
    topicName: string;
    trendLabel: string;
    timelineSummary: string;
    videoCount: number;
    /* Modal stance for the topic + the supportive/opposed share (0-1). */
    dominantStance?: string;
    opinionatedShare?: number;
  }>;
}) {
  const userPrompt = buildCreatorReportUserPrompt(args);
  const result = await runLlm({
    task: "creator_report",
    system: CREATOR_REPORT_SYSTEM,
    userPrompt: userPrompt,
    responseFormat: "json",
    promptVersion: CREATOR_REPORT_PROMPT_VERSION,
    taskInput: args,
  });
  if (result.degraded) {
    throw new Error("creator_report_llm_degraded");
  }

  const parsed = parseReportResponse(result.json, {
    title: `Creator Summary: ${args.creatorName}`,
    summary: `This creator report synthesizes the imported transcript patterns for ${args.creatorName}.`,
  });
  return sanitizeReport(parsed);
}

/**
 * generateTopicReport — focused report on one (creator, topic) pair.
 *
 * Structure (topic-report-v5): a quote-grounded, trend-aware digest of
 * what the creator ACTUALLY SAID — not a mirror of the creator report.
 * It is driven by `trendLabel` (the ground-truth movement: it only
 * narrates a shift on gradual_shift/abrupt_shift, otherwise it
 * characterizes the consistent stance) and grounded in the supplied
 * verbatim `quotes` — a mandatory "In their own words" section features
 * 2-4 of them. Sections are 3-5 from {Overall Stance, How It's Evolved,
 * In Their Own Words, Turning Points, Limitations}. Falls back to a safe
 * stub when the LLM reply fails schema validation.
 */
export async function generateTopicReport(args: {
  creatorName: string;
  topicName: string;
  timelineSummary?: string;
  /* The analyzed trend label for this (creator, topic) — the ground-truth trend. */
  trendLabel?: string;
  summaries: Array<{
    videoId: string;
    videoTitle: string;
    publishedAt?: string;
    dominantStance: string;
    summary: string;
  }>;
  /* Representative verbatim quotes (highest-signal first) that ground the report. */
  quotes?: Array<{
    quote: string;
    stance: string;
    videoId?: string;
    videoTitle: string;
    publishedAt?: string;
    /* Stable evidence-row id, so an inline citation can resolve back to this exact row. */
    analysisId?: string;
  }>;
}) {
  const userPrompt = buildTopicReportUserPrompt(args);
  const result = await runLlm({
    task: "topic_report",
    system: TOPIC_REPORT_SYSTEM,
    userPrompt: userPrompt,
    responseFormat: "json",
    promptVersion: TOPIC_REPORT_PROMPT_VERSION,
    taskInput: args,
  });
  if (result.degraded) {
    throw new Error("topic_report_llm_degraded");
  }

  const parsed = parseReportResponse(result.json, {
    title: `${args.topicName} - Patterns in ${args.creatorName}'s Transcripts`,
    summary: `This topic report synthesizes the imported transcript patterns for ${args.creatorName} on ${args.topicName}.`,
  });
  return sanitizeReport(parsed);
}

function sanitizeReport<
  T extends { title: string; summary: string; sections: ReportSection[] },
>(report: T): T {
  return {
    ...report,
    title: sanitizeReaderText(report.title),
    summary: sanitizeReaderText(report.summary),
    sections: report.sections
      .map((section) => ({
        ...section,
        body: section.body ? sanitizeReaderText(section.body) : undefined,
        bullets: section.bullets
          ?.map(sanitizeReaderText)
          .filter((bullet) => bullet && !isInstructionLeak(bullet)),
      }))
      .filter(
        (section) =>
          Boolean(section.body?.trim()) || Boolean(section.bullets?.length),
      ),
  };
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

function parseReportResponse(
  value: unknown,
  fallback: { title: string; summary: string },
): ReportResponse {
  const direct = ReportResponseSchema.safeParse(value);
  if (direct.success) return direct.data;
  return ReportResponseSchema.parse(repairReportResponse(value, fallback));
}

function repairReportResponse(
  value: unknown,
  fallback: { title: string; summary: string },
) {
  const obj = isRecord(value) ? value : {};
  return {
    title: coerceText(obj.title) || fallback.title,
    summary: coerceText(obj.summary) || fallback.summary,
    caveats: coerceText(obj.caveats) || STANDARD_REPORT_CAVEAT,
    sections: coerceSections(obj.sections ?? obj.findings ?? obj.insights),
    evidence: coerceEvidence(obj.evidence ?? obj.citations ?? obj.sources),
  };
}

function coerceText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (!isRecord(item)) return "";
        const heading = coerceText(item.heading ?? item.title);
        const body = coerceText(
          item.body ?? item.text ?? item.content ?? item.note,
        );
        return [heading, body].filter(Boolean).join(": ");
      })
      .filter(Boolean)
      .join(" ");
  }
  if (isRecord(value)) {
    return coerceText(
      value.body ?? value.text ?? value.content ?? value.note ?? value.message,
    );
  }
  return "";
}

function coerceSections(value: unknown): ReportSection[] {
  if (!Array.isArray(value)) return [];
  const sections: ReportSection[] = [];
  value.forEach((item, index) => {
    if (typeof item === "string") {
      const body = item.trim();
      if (body) sections.push({ heading: `Insight ${index + 1}`, body });
      return;
    }
    if (!isRecord(item)) return;
    const heading =
      coerceText(item.heading ?? item.title ?? item.name) ||
      `Insight ${index + 1}`;
    const bullets = coerceBullets(
      item.bullets ?? item.points ?? item.findings ?? item.items,
    );
    const body = coerceText(
      item.body ?? item.text ?? item.content ?? item.summary,
    );
    if (bullets.length > 0) {
      sections.push(body ? { heading, body, bullets } : { heading, bullets });
    } else if (body) {
      sections.push({ heading, body });
    }
  });
  return sections;
}

function coerceBullets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        const claim = item.trim();
        return claim || null;
      }
      if (!isRecord(item)) return null;
      const claim = coerceText(
        item.claim ??
          item.point ??
          item.finding ??
          item.text ??
          item.body ??
          item.note,
      );
      if (!claim) return null;
      const implication = coerceText(
        item.implication ?? item.whyItMatters ?? item.meaning,
      );
      const caveat = coerceText(item.caveat ?? item.limitation ?? item.warning);
      return [claim, implication, caveat].filter(Boolean).join(" ");
    })
    .filter((item): item is string => Boolean(item));
}

function coerceEvidence(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        const note = item.trim();
        return note ? { note } : null;
      }
      if (!isRecord(item)) return null;
      const note = coerceText(
        item.note ?? item.summary ?? item.text ?? item.quote ?? item.body,
      );
      const row: {
        analysisId?: string;
        videoId?: string;
        videoTitle?: string;
        topicId?: string;
        topic?: string;
        note?: string;
      } = {};
      for (const key of [
        "analysisId",
        "videoId",
        "videoTitle",
        "topicId",
        "topic",
      ] as const) {
        if (typeof item[key] === "string" && item[key].trim())
          row[key] = item[key].trim();
      }
      if (note) row.note = note;
      return Object.keys(row).length > 0 ? row : null;
    })
    .filter(
      (
        item,
      ): item is {
        analysisId?: string;
        videoId?: string;
        videoTitle?: string;
        topicId?: string;
        topic?: string;
        note?: string;
      } => Boolean(item),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { CREATOR_REPORT_PROMPT_VERSION, TOPIC_REPORT_PROMPT_VERSION };
