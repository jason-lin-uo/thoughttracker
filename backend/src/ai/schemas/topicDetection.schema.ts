import { z } from "zod";

export const TopicDetectionItemSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  description: z.string().optional(),
  mentionCount: z.number().int().nonnegative().default(0),
  relevanceScore: z.number().min(0).max(1).default(0),
});

export const TopicDetectionResponseSchema = z.object({
  topics: z.array(TopicDetectionItemSchema),
});

export type TopicDetectionResponse = z.infer<
  typeof TopicDetectionResponseSchema
>;
export type TopicDetectionItem = z.infer<typeof TopicDetectionItemSchema>;
