import { fenceUntrusted, FENCING_SYSTEM_RULES } from "./fencing";

export const CREATOR_REPORT_PROMPT_VERSION = "creator-report-v6";

/**
 * Cap on the number of per-topic rows folded into the creator-report prompt.
 *
 * The sibling prompts cap their variable-length arrays (topicReport/
 * creatorTimeline at 60/80 summaries); this one previously embedded the full
 * topic list unbounded, so a creator with hundreds of detected topics could
 * blow the prompt budget. 80 keeps a creator's most relevant topics while
 * bounding worst-case prompt size, matching the timeline cap.
 */
export const CREATOR_REPORT_MAX_TOPICS = 80;

export const CREATOR_REPORT_SYSTEM = `You are an analyst writing an INSIGHT report about a creator, grounded only in the supplied evidence. Your job is SYNTHESIS — surfacing patterns a reader can't see at a glance — NOT restating the data.

Hard rules:
- Return valid JSON only.
- Use ONLY the supplied per-topic trends, timelines, and evidence. Never invent topics, dates, stances, or quotes.
- Neutral, analytical language. Frame every claim as an observed pattern in transcripts, never as the creator's private beliefs.
- Do NOT just enumerate topics or counts — the reader already sees those on the dashboard. Every sentence must add interpretation: a shift, a reversal, a consistency, a contradiction, or a throughline.
- Each topic carries a reader-facing stance pattern and an outspoken share (0-1, the fraction of videos where the stance is supportive/opposed). Use these to call out WHERE the creator is most opinionated and, honestly, where they stay neutral/guarded. Naming the negative space is a feature, not a filler.
- Never mention internal schema names or developer labels such as "trendLabel", "dominantStance", "opinionatedShare", "confidenceScore", "schema", or "field". Translate them into normal reader-facing prose.
- Lead with the single MOST significant finding (a stance reversal, the topic they're most outspoken on, or a notable shift). 'title' must be one punchy sentence naming that finding — never a bland label like "Creator Summary".
- 'summary' (2-4 short sentences) states the headline finding, then the supporting throughline across topics. Keep the summary concise; put the depth in the bullets.
- 'sections' should be 3-6 drawn from: Most Outspoken On, Biggest Shift, Where They Stay Neutral, Tensions & Contradictions, Limitations. Prefer findings over lists.
- Each section MUST use 2-5 normal bullet points: plain strings, not nested objects.
- Each bullet should be one rich, readable analytical point, usually 1-2 sentences. Do not label subparts like "evidence", "why it matters", "confidence", or "caveat".
- Bullets should feel like a sharp analyst memo for humans: concrete, detailed, easy to skim, and grounded in the supplied transcript-derived patterns without over-explaining the proof.
- Avoid vague bullets like "The creator discusses AI often"; say what pattern, contrast, limitation, or practical takeaway the data reveals.
- For any claim about a shift or contradiction, cite the specific topic (and video when available) in 'evidence'.
- Always include this caveat or a close variant:
 "This report is based only on the imported transcript data available in ThoughtTracker. It should be interpreted as an evidence-backed summary of transcript patterns, not a definitive judgment of the creator's beliefs."
${FENCING_SYSTEM_RULES}`;

/**
 * Build the user-message JSON for the creator-report task.
 *
 * Serializes the instruction, output schema, creator name, and per-topic
 * trend/timeline summaries into one JSON string. Pairs with
 * CREATOR_REPORT_SYSTEM, which mandates the neutral framing and the
 * standing ThoughtTracker data caveat.
 */
export function buildCreatorReportUserPrompt(args: {
  creatorName: string;
  topics: Array<{
    topicName: string;
    trendLabel: string;
    timelineSummary: string;
    videoCount: number;
    dominantStance?: string;
    opinionatedShare?: number;
  }>;
}): string {
  return JSON.stringify({
    instruction:
      "Synthesize an insight report for this creator. Identify the most significant pattern across the supplied topics (a stance shift/reversal, a consistent throughline, or a contradiction) and lead with it. Do not merely list topics or counts. Output JSON only.",
    schema: {
      title:
        "one punchy sentence naming the single most significant finding (not a label)",
      summary:
        "2-4 short sentences: the headline finding, then the supporting cross-topic throughline",
      caveats: "1-2 sentences",
      sections: [
        {
          heading: "string",
          bullets: ["2-5 rich, readable analytical bullet points"],
        },
      ],
      evidence: [{ videoId: "string", topicId: "string", note: "string" }],
    },
    creator: args.creatorName,
    /*
     * Cap the topic array (was unbounded) and fence each summary's free text —
     * topic names + timeline summaries originate from transcript-derived data.
     */
    topics: args.topics.slice(0, CREATOR_REPORT_MAX_TOPICS).map((t) => ({
      topicName: t.topicName,
      movement: t.trendLabel,
      timelineSummary: fenceUntrusted("SUMMARY", t.timelineSummary),
      videoCount: t.videoCount,
      stancePattern: t.dominantStance,
      outspokenShare: t.opinionatedShare,
    })),
  });
}
