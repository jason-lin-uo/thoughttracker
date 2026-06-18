import { prisma } from "../config/prisma";
import { monthKey } from "../utils/dates";
import { STANCE_SCORE } from "../utils/stance";

export interface StanceOverTimePoint {
  date: string;
  averageStance: number | null;
  count: number;
}

/**
 * getStanceOverTime — bucket per-video stance summaries into month
 * buckets and emit `{ date: "YYYY-MM", averageStance: -1..1 | null,
 * count }` points.
 *
 * Stance scores: supportive=+1, opposed=-1, neutral/mixed=0, unclear
 * and insufficient_evidence are excluded from the mean (they'd push
 * the chart toward 0 misleadingly).
 */
export async function getStanceOverTime(args: {
  creatorId: string;
  topicId?: string;
}): Promise<StanceOverTimePoint[]> {
  const summaries = await prisma.videoTopicSummary.findMany({
    where: {
      creatorId: args.creatorId,
      ...(args.topicId ? { topicId: args.topicId } : {}),
    },
    include: { video: { select: { publishedAt: true } } },
  });

  const buckets = new Map<string, { sum: number; count: number }>();
  for (const s of summaries) {
    const date = s.video.publishedAt ?? s.createdAt;
    const key = monthKey(date);
    const score = STANCE_SCORE[s.dominantStance];
    if (score === null) continue;
    const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += score;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const points: StanceOverTimePoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({
      date,
      averageStance:
        bucket.count > 0
          ? Math.round((bucket.sum / bucket.count) * 100) / 100
          : null,
      count: bucket.count,
    }));

  return points;
}

export interface TopicFrequencyPoint {
  date: string;
  topics: Record<string, number>;
}

/**
 * getTopicFrequency — sum mention counts per topic per month bucket
 * for one creator. Returns `{ points, topics }` where each point is
 * `{ date, topics: { [topicName]: count } }` and `topics` is the
 * legend dictionary sorted by overall frequency.
 */
export async function getTopicFrequency(args: { creatorId: string }): Promise<{
  points: TopicFrequencyPoint[];
  topics: Array<{ id: string; name: string }>;
}> {
  const summaries = await prisma.videoTopicSummary.findMany({
    where: { creatorId: args.creatorId },
    include: {
      topic: true,
      video: { select: { publishedAt: true } },
    },
  });

  const topicMap = new Map<string, { id: string; name: string }>();
  const buckets = new Map<string, Record<string, number>>();

  for (const s of summaries) {
    if (s.mentionCount <= 0) continue;
    const date = s.video.publishedAt ?? s.createdAt;
    const key = monthKey(date);
    const slot = buckets.get(key) ?? {};
    slot[s.topic.name] = (slot[s.topic.name] ?? 0) + s.mentionCount;
    buckets.set(key, slot);
    topicMap.set(s.topicId, { id: s.topicId, name: s.topic.name });
  }

  const points: TopicFrequencyPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, topics]) => ({ date, topics }));

  return { points, topics: Array.from(topicMap.values()) };
}
