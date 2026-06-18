import { fenceUntrusted, FENCING_SYSTEM_RULES } from "./fencing";

export const CREATOR_TIMELINE_PROMPT_VERSION = "creator-timeline-v1";

export const CREATOR_TIMELINE_SYSTEM = `You produce a creator/topic timeline interpretation from per-video summaries.

Hard rules:
- Return valid JSON only.
- Use only the per-video summaries supplied.
- Use neutral language: "Across imported transcripts, the expressed stance appears to…".
- Do not claim definitive belief changes; describe observed transcript patterns.
- 'trendLabel' must be one of: stable | gradual_shift | abrupt_shift | mixed | insufficient_data.
- 'summary' is 3-6 sentences. Include limitations (e.g. only based on imported transcripts).
- Include up to 5 evidence entries referencing videoId with optional publishedAt and a short note.
${FENCING_SYSTEM_RULES}`;

/**
 * Build the user-message JSON for the creator-timeline task.
 *
 * Serializes the instruction, output schema, creator/topic names, and up
 * to 80 per-video summaries into one JSON string. Pairs with
 * CREATOR_TIMELINE_SYSTEM, which asks for a neutral trend interpretation
 * (stable / gradual_shift / abrupt_shift / mixed / insufficient_data).
 */
export function buildCreatorTimelineUserPrompt(args: {
  topicName: string;
  creatorName: string;
  summaries: Array<{
    videoId: string;
    publishedAt?: string;
    dominantStance: string;
    confidenceLabel: string;
    summary: string;
  }>;
}): string {
  return JSON.stringify({
    instruction:
      "Interpret the trend in expressed stance across these per-video summaries for this creator and topic. Be neutral and include limitations.",
    schema: {
      trendLabel: "stable|gradual_shift|abrupt_shift|mixed|insufficient_data",
      summary: "3-6 sentences",
      evidence: [
        { videoId: "string", publishedAt: "iso date", note: "string" },
      ],
    },
    creator: args.creatorName,
    topic: args.topicName,
    /* Fence each per-video summary's transcript-derived free text. */
    summaries: args.summaries.slice(0, 80).map((s) => ({
      videoId: s.videoId,
      publishedAt: s.publishedAt,
      dominantStance: s.dominantStance,
      confidenceLabel: s.confidenceLabel,
      summary: fenceUntrusted("SUMMARY", s.summary),
    })),
  });
}
