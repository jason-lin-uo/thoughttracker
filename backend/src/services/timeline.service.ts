import { runLlm } from "../ai/llmClient";
import {
  CREATOR_TIMELINE_PROMPT_VERSION,
  CREATOR_TIMELINE_SYSTEM,
  buildCreatorTimelineUserPrompt,
} from "../ai/prompts/creatorTimeline.prompt";
import { CreatorTimelineResponseSchema } from "../ai/schemas/creatorTimeline.schema";

/**
 * generateCreatorTopicTimeline — produce the per-(creator, topic)
 * `CreatorTopicTimeline` row describing how the creator's stance has
 * changed over the imported window.
 *
 * Detects one of five trends (stable | gradual_shift | abrupt_shift |
 * mixed | insufficient_data) and writes a one-paragraph summary plus
 * an evidence-by-date array (videoId + publishedAt + note) used by
 * the UI to anchor stance changes to specific videos.
 */
export async function generateCreatorTopicTimeline(args: {
  creatorName: string;
  topicName: string;
  summaries: Array<{
    videoId: string;
    publishedAt?: string;
    dominantStance: string;
    confidenceLabel: string;
    summary: string;
  }>;
}) {
  const userPrompt = buildCreatorTimelineUserPrompt(args);
  const result = await runLlm({
    task: "creator_timeline",
    system: CREATOR_TIMELINE_SYSTEM,
    userPrompt: userPrompt,
    responseFormat: "json",
    promptVersion: CREATOR_TIMELINE_PROMPT_VERSION,
    taskInput: {
      summaries: args.summaries,
      creatorName: args.creatorName,
      topicName: args.topicName,
    },
  });

  const parsed = CreatorTimelineResponseSchema.safeParse(result.json);
  if (parsed.success) return parsed.data;

  return {
    trendLabel: "insufficient_data" as const,
    summary:
      "Across imported transcripts there is not yet enough data to characterize a trend on this topic for this creator.",
    evidence: [],
  };
}

export { CREATOR_TIMELINE_PROMPT_VERSION };
