import { z } from "zod";

export const StanceLabelSchema = z.enum([
  "supportive",
  "opposed",
  "neutral",
  "mixed",
  "unclear",
  "insufficient_evidence",
]);

export const ConfidenceLabelSchema = z.enum(["low", "medium", "high"]);

export const StanceClassificationResponseSchema = z.object({
  relevanceScore: z.number().min(0).max(1),
  stanceLabel: StanceLabelSchema,
  confidenceScore: z.number().min(0).max(1),
  confidenceLabel: ConfidenceLabelSchema,
  claimSummary: z.string().min(1),
  rationale: z.string().min(1),
  evidenceQuote: z.string().min(1),
});

export type StanceClassificationResponse = z.infer<
  typeof StanceClassificationResponseSchema
>;
