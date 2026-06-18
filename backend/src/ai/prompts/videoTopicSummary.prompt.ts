import { fenceUntrusted, FENCING_SYSTEM_RULES } from "./fencing";

export const VIDEO_TOPIC_SUMMARY_PROMPT_VERSION = "video-topic-summary-v1";

export const VIDEO_TOPIC_SUMMARY_SYSTEM = `You synthesize chunk-level stance analyses into ONE per-video, per-topic summary.

Hard rules:
- Return valid JSON only.
- Use only the provided chunk analyses as input.
- Use neutral language. Do not infer private beliefs.
- 'dominantStance' must be one of: supportive | opposed | neutral | mixed | unclear | insufficient_evidence.
- 'mentionCount' counts chunks where relevanceScore >= 0.4.
- 'summary' is 2-4 sentences. Frame conclusions as "Across the chunks in this video, the expressed stance appears…".
- Include 1-3 notableEvidence entries referencing chunkIndex with a short quote.
${FENCING_SYSTEM_RULES}`;

/**
 * Build the user-message JSON for the video-topic-summary task.
 *
 * Packs the instruction, output schema, topic, video title, and the
 * chunk-level analyses (capped at 60 to bound prompt size) into one JSON
 * string. Pairs with VIDEO_TOPIC_SUMMARY_SYSTEM, which collapses these
 * chunk analyses into a single per-video, per-topic stance summary.
 */
export function buildVideoTopicSummaryUserPrompt(args: {
  topicName: string;
  videoTitle: string;
  chunkAnalyses: Array<{
    chunkIndex: number;
    relevanceScore: number;
    stanceLabel: string;
    confidenceScore: number;
    claimSummary: string;
    evidenceQuote: string;
  }>;
}): string {
  return JSON.stringify({
    instruction: "Summarize the chunk-level analyses for this video and topic.",
    schema: {
      dominantStance:
        "supportive|opposed|neutral|mixed|unclear|insufficient_evidence",
      confidenceScore: "0..1",
      confidenceLabel: "low|medium|high",
      mentionCount: "integer",
      summary: "2-4 sentences",
      notableEvidence: [{ chunkIndex: "int", quote: "string" }],
    },
    topic: args.topicName,
    video: args.videoTitle,
    /*
     * The free-text fields below (claimSummary, evidenceQuote) trace back to
     * transcript text, so fence them: a quote like "ignore previous
     * instructions" must read as evidence, not as a command.
     */
    chunkAnalyses: args.chunkAnalyses.slice(0, 60).map((c) => ({
      chunkIndex: c.chunkIndex,
      relevanceScore: c.relevanceScore,
      stanceLabel: c.stanceLabel,
      confidenceScore: c.confidenceScore,
      claimSummary: fenceUntrusted("CLAIM", c.claimSummary),
      evidenceQuote: fenceUntrusted("QUOTE", c.evidenceQuote),
    })),
  });
}
