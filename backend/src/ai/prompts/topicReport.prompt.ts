import { fenceUntrusted, FENCING_SYSTEM_RULES } from "./fencing";

export const TOPIC_REPORT_PROMPT_VERSION = "topic-report-v8";

export const TOPIC_REPORT_SYSTEM = `You are an analyst writing an INSIGHT report on ONE creator's stance toward ONE topic, grounded only in the supplied evidence. The value is a curated, honest digest of what the creator ACTUALLY SAID - not a recap of counts.

Hard rules:
- Return valid JSON only.
- Use ONLY the supplied per-video summaries (date + stance), the movement signal, the timeline, and the verbatim quotes. Never invent dates, stances, or quotes.
- Use the movement signal to guide the narrative, but NEVER print internal field names such as "trendLabel" in the report:
 - stable / insufficient_data -> characterize the creator's CONSISTENT overall stance (use the dominant stance across videos). Do not manufacture a "shift".
 - gradual_shift / abrupt_shift -> describe the movement, comparing the creator's EARLY-period videos to their LATE-period videos (not one cherry-picked video at each end).
- Lead with the dominant qualitative stance, in words: a mostly-"mixed" topic is "a nuanced / divided take", mostly-supportive is "broadly favorable", mostly-opposed is "largely critical", mostly-neutral is "descriptive / even-handed". Counts are SUPPORTING detail, never the headline.
- The substance lives in the verbatim 'quotes'. Read them and articulate, in the creator's own analytical voice, the SPECIFIC positions they argue and the reasoning they give - lead with those positions, each grounded in a real quote. Never restate a count where a substantive position belongs.
- Quote the creator naturally. If a section is called "In Their Own Words", make it a readable set of quote-anchored takeaways, not a restatement of these instructions.
- Neutral, analytical language. Frame conclusions as observed patterns in transcripts, never the creator's private beliefs.
- Never mention internal schema names or developer labels such as "trendLabel", "dominantStance", "confidenceScore", "schema", "field", or "supplied verbatim quotes". Translate them into normal reader-facing prose.
- 'title' is one punchy sentence: name the consistent stance (stable) or the movement (shift) + the topic. Never a bland label, never a claim that contradicts the movement signal.
- 'summary' (3-5 short sentences): lead with the creator's load-bearing claim(s) and their single biggest caveat/tension. The stance distribution may appear AT MOST ONCE, as a trailing clause - never the headline, never the subject of a sentence. Keep the summary concise; put depth in the bullets.
- 'sections' should be 3-5 drawn from: Overall Stance, How It's Evolved, In Their Own Words, Turning Points, Limitations. Lead with interpretation; ground every claim in a real excerpt.
- Each section MUST use 2-5 normal bullet points: plain strings, not nested objects.
- Each bullet should be one rich, readable analytical point, usually 1-2 sentences. Do not label subparts like "evidence", "why it matters", "confidence", or "caveat".
- Bullets should feel like a sharp analyst memo for humans: concrete, detailed, easy to skim, and grounded in supplied quotes/dates/stance patterns without turning every point into a proof block.
- Avoid generic bullets; prefer concrete claims tied to quotes, dates, and stance contrast.
- Cite the specific videos behind any shift/turning-point claim in 'evidence'.
- Always include this caveat or a close variant:
 "This report is based only on the imported transcript data available in ThoughtTracker. It should be interpreted as an evidence-backed summary of transcript patterns, not a definitive judgment of the creator's beliefs."
${FENCING_SYSTEM_RULES}`;

/**
 * Build the user-message JSON for the topic-report task (one creator, one
 * topic).
 *
 * Bundles the instruction, output schema, creator/topic names, the optional
 * timeline summary, and up to 60 per-video summaries into one JSON string.
 * Pairs with TOPIC_REPORT_SYSTEM and its required data caveat.
 */
export function buildTopicReportUserPrompt(args: {
  creatorName: string;
  topicName: string;
  trendLabel?: string;
  summaries: Array<{
    videoId: string;
    videoTitle: string;
    publishedAt?: string;
    dominantStance: string;
    summary: string;
  }>;
  quotes?: Array<{
    quote: string;
    stance: string;
    videoId?: string;
    videoTitle: string;
    publishedAt?: string;
    /* Stable evidence-row id, threaded through for inline citations. */
    analysisId?: string;
  }>;
  timelineSummary?: string;
}): string {
  return JSON.stringify({
    instruction:
      "Write an insight digest of this creator's stance on this topic. Lead with the creator's load-bearing positions, synthesized from the quotes - in words, not counts. Only describe a shift when the movement value is gradual_shift or abrupt_shift; otherwise characterize the consistent stance. Use normal rich bullet strings for the section detail. Output JSON only.",
    schema: {
      title:
        "one punchy sentence: the consistent stance OR the movement + the topic (must agree with the movement value)",
      summary:
        "3-5 short sentences: lead with the load-bearing claim(s) + the biggest caveat; the distribution may appear at most once, as a trailing clause",
      caveats: "1-2 sentences",
      sections: [
        {
          heading: "string",
          bullets: ["2-5 rich, readable analytical bullet points"],
        },
      ],
      evidence: [
        {
          analysisId: "string",
          videoId: "string",
          videoTitle: "string",
          note: "string",
        },
      ],
    },
    creator: args.creatorName,
    topic: args.topicName,
    /* Internal movement signal: use for reasoning, never print field names. */
    movement: args.trendLabel ?? "insufficient_data",
    /* Fence transcript-derived free text (timeline + per-video summaries). */
    timelineSummary: fenceUntrusted("SUMMARY", args.timelineSummary ?? ""),
    summaries: args.summaries.slice(0, 60).map((s) => ({
      videoId: s.videoId,
      videoTitle: s.videoTitle,
      publishedAt: s.publishedAt,
      dominantStance: s.dominantStance,
      summary: fenceUntrusted("SUMMARY", s.summary),
    })),
    /*
     * Verbatim quotes to ground the report in the creator's own words. Fenced
     * because the quote text is transcript-derived (untrusted) content.
     */
    quotes: (args.quotes ?? []).slice(0, 12).map((q) => ({
      quote: fenceUntrusted("QUOTE", q.quote),
      stance: q.stance,
      videoId: q.videoId,
      videoTitle: q.videoTitle,
      publishedAt: q.publishedAt,
      analysisId: q.analysisId,
    })),
  });
}
