import { z } from "zod";

export const ReportSectionSchema = z
  .object({
    heading: z.string(),
    body: z.string().optional(),
    bullets: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (section) =>
      Boolean(section.body?.trim()) || Boolean(section.bullets?.length),
    {
      message:
        "Report sections require either body text or structured bullets.",
    },
  );

export const ReportResponseSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  caveats: z.string().min(1),
  sections: z.array(ReportSectionSchema).default([]),
  evidence: z
    .array(
      z.object({
        analysisId: z.string().optional(),
        videoId: z.string().optional(),
        videoTitle: z.string().optional(),
        topicId: z.string().optional(),
        topic: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
});

export type ReportResponse = z.infer<typeof ReportResponseSchema>;
export type ReportSection = z.infer<typeof ReportSectionSchema>;
