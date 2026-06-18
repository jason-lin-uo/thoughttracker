import { fenceUntrusted, FENCING_SYSTEM_RULES } from "./fencing";

export const STANCE_CLASSIFICATION_PROMPT_VERSION = "stance-classification-v1";

export const STANCE_CLASSIFICATION_SYSTEM = `You are a careful, neutral text analyst.
You classify the *expressed stance* in a transcript chunk toward a specified topic.

Hard rules:
- Return valid JSON only. No prose, no markdown.
- Use ONLY the text in the chunk as evidence. Do not infer private beliefs.
- Allowed stance labels: supportive | opposed | neutral | mixed | unclear | insufficient_evidence.
- Use 'insufficient_evidence' if the chunk does not say enough about the topic.
- Use 'mixed' if multiple stances appear.
- Use 'unclear' if the wording is ambiguous (e.g. sarcasm, hypothetical).
- Provide a short claimSummary in neutral language.
- Provide a 1-2 sentence rationale grounded in the chunk text.
- Provide a single short evidenceQuote that is an exact substring of the chunk.
- Provide confidenceScore (0..1) and confidenceLabel (low|medium|high).
- Do not use inflammatory wording, do not editorialize, do not psychoanalyze.
${FENCING_SYSTEM_RULES}`;

/**
 * Build the user-message JSON for the stance-classification task.
 *
 * Bundles the instruction, output schema, the target topic (name +
 * description), and the chunk text into one JSON string. The chunk is
 * capped at 6k chars to bound prompt size; pairs with
 * STANCE_CLASSIFICATION_SYSTEM which enforces the neutral, evidence-only rules.
 */
export function buildStanceClassificationUserPrompt(args: {
  topicName: string;
  topicDescription?: string;
  chunkText: string;
}): string {
  return JSON.stringify({
    instruction:
      "Classify the expressed stance in this transcript chunk toward the topic. Output JSON only.",
    schema: {
      relevanceScore: "0..1",
      stanceLabel:
        "supportive|opposed|neutral|mixed|unclear|insufficient_evidence",
      confidenceScore: "0..1",
      confidenceLabel: "low|medium|high",
      claimSummary: "short neutral string",
      rationale: "1-2 sentences",
      evidenceQuote: "exact substring of chunk",
    },
    topic: {
      name: args.topicName,
      description: args.topicDescription ?? "",
    },
    /*
     * Fence the untrusted transcript chunk so any "ignore your instructions"
     * text a creator put in the video is read as data, not as a command.
     */
    chunk: fenceUntrusted("CHUNK", args.chunkText.slice(0, 6000)),
  });
}
