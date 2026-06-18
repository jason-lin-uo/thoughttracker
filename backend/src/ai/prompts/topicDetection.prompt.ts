import { fenceUntrusted, FENCING_SYSTEM_RULES } from "./fencing";

export const TOPIC_DETECTION_PROMPT_VERSION = "topic-detection-v1";

export const TOPIC_DETECTION_SYSTEM = `You are a neutral analyst that identifies recurring substantive topics inside a transcript.

Rules:
- Return valid JSON only. No prose, no markdown.
- Identify only meaningful, recurring topics. Ignore casual mentions, intros, and ads.
- Prefer mid-level topics that are specific enough for stance-over-time analysis.
- Do not classify, do not infer beliefs, do not editorialize.
- Use the provided taxonomy when applicable; otherwise return a new neutral name.
${FENCING_SYSTEM_RULES}`;

/**
 * Build the user-message JSON for the topic-detection task.
 *
 * Serializes the instruction, expected output schema, the controlled
 * taxonomy, and the transcript into a single JSON string (the provider is
 * asked to return JSON only). The transcript is truncated to 12k chars to
 * stay within the prompt budget; pairs with TOPIC_DETECTION_SYSTEM.
 */
export function buildTopicDetectionUserPrompt(args: {
  transcript: string;
  taxonomy: Array<{
    slug: string;
    name: string;
    domain?: string;
    description?: string;
    aliases?: string[];
  }>;
}): string {
  return JSON.stringify({
    instruction:
      "Identify recurring substantive topics in this transcript. Prefer the provided mid-level taxonomy topics when applicable. Avoid broad labels like Politics, Health, Technology, Business, or Nutrition when a more specific taxonomy topic fits.",
    schema: {
      topics: [
        {
          name: "string",
          slug: "kebab-case-string",
          description: "one sentence",
          mentionCount: "integer",
          relevanceScore: "0..1",
        },
      ],
    },
    taxonomy: args.taxonomy,
    /* Fence the untrusted transcript so embedded "instructions" stay data. */
    transcript: fenceUntrusted("TRANSCRIPT", args.transcript.slice(0, 12000)),
  });
}
