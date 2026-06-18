import { z } from "zod";

export const TrendLabelSchema = z.enum([
  "stable",
  "gradual_shift",
  "abrupt_shift",
  "mixed",
  "insufficient_data",
]);

export const CreatorTimelineResponseSchema = z.object({
  trendLabel: TrendLabelSchema,
  summary: z.string().min(1),
  evidence: z
    .array(
      z.object({
        videoId: z.string(),
        publishedAt: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
});

export type CreatorTimelineResponse = z.infer<
  typeof CreatorTimelineResponseSchema
>;
