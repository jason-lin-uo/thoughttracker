import { z } from "zod";
import {
  StanceLabelSchema,
  ConfidenceLabelSchema,
} from "./stanceClassification.schema";

export const VideoTopicSummaryResponseSchema = z.object({
  dominantStance: StanceLabelSchema,
  confidenceScore: z.number().min(0).max(1),
  confidenceLabel: ConfidenceLabelSchema,
  mentionCount: z.number().int().nonnegative(),
  summary: z.string().min(1),
  notableEvidence: z
    .array(
      z.object({
        chunkIndex: z.number().int().nonnegative(),
        quote: z.string(),
      }),
    )
    .default([]),
});

export type VideoTopicSummaryResponse = z.infer<
  typeof VideoTopicSummaryResponseSchema
>;
