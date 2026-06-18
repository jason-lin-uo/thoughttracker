import { Prisma, type StanceLabel } from "@prisma/client";
import { prisma } from "../config/prisma";
import { NotFoundError } from "../utils/errors";

export const STARTER_REPORT_CREATOR_SLUG = "mkbhd";
export const STARTER_REPORT_TOPIC_SLUG = "foldable_smartphone_reviews";

const STARTER_REPORT_TITLE =
  "MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs";

const STARTER_REPORT_CAVEAT =
  "This report is based only on the imported transcript data available in ThoughtTracker. It should be interpreted as an evidence-backed summary of transcript patterns, not a definitive judgment of the creator's beliefs.";

interface ResetDbClient {
  $transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}

interface StarterReportInput {
  creator: { id: string; name: string };
  topic: { id: string; name: string };
  timeline: { trendLabel: string; summary: string | null } | null;
  summaries: Array<{
    dominantStance: StanceLabel;
    mentionCount: number;
    summary: string | null;
    video: { id: string; title: string; publishedAt: Date | null };
  }>;
  evidenceRows: Array<{
    id: string;
    stanceLabel: StanceLabel;
    evidenceQuote: string | null;
    video: { id: string; title: string; publishedAt: Date | null };
  }>;
}

export interface StarterReportResetResult {
  deleted: number;
  report: {
    id: string;
    title: string;
    summary: string;
    creatorId: string;
    topicId: string | null;
    reportType: string;
  };
}

/**
 * resetReportsToStarter clears every generated report, then recreates the one
 * default recruiter-facing report used by fresh local installs and the hosted
 * portfolio app. It is deterministic: no OpenAI, Ollama, or ML service call is
 * made, so the reset works even on free hosting and cannot spend tokens.
 */
export async function resetReportsToStarter(
  db: ResetDbClient = prisma as unknown as ResetDbClient,
): Promise<StarterReportResetResult> {
  return db.$transaction(async (tx) => {
    const [creator, topic] = await Promise.all([
      tx.creator.findUnique({
        where: { slug: STARTER_REPORT_CREATOR_SLUG },
        select: { id: true, name: true },
      }),
      tx.topic.findUnique({
        where: { slug: STARTER_REPORT_TOPIC_SLUG },
        select: { id: true, name: true },
      }),
    ]);
    if (!creator) {
      throw new NotFoundError("Default report creator not found");
    }
    if (!topic) {
      throw new NotFoundError("Default report topic not found");
    }

    const [timeline, summaries, evidenceRows, deleted] = await Promise.all([
      tx.creatorTopicTimeline.findUnique({
        where: { creatorId_topicId: { creatorId: creator.id, topicId: topic.id } },
        select: { trendLabel: true, summary: true },
      }),
      tx.videoTopicSummary.findMany({
        where: { creatorId: creator.id, topicId: topic.id },
        select: {
          dominantStance: true,
          mentionCount: true,
          summary: true,
          video: { select: { id: true, title: true, publishedAt: true } },
        },
      }),
      tx.chunkTopicAnalysis.findMany({
        where: {
          creatorId: creator.id,
          topicId: topic.id,
          evidenceQuote: { not: null },
        },
        orderBy: [{ relevanceScore: "desc" }, { confidenceScore: "desc" }],
        take: 200,
        select: {
          id: true,
          stanceLabel: true,
          evidenceQuote: true,
          video: { select: { id: true, title: true, publishedAt: true } },
        },
      }),
      tx.report.deleteMany({}),
    ]);

    const reportBody = buildStarterReport({
      creator,
      topic,
      timeline,
      summaries,
      evidenceRows,
    });
    const report = await tx.report.create({
      data: {
        creatorId: creator.id,
        topicId: topic.id,
        reportType: "topic_summary",
        title: reportBody.title,
        summary: reportBody.summary,
        caveats: STARTER_REPORT_CAVEAT,
        evidence: reportBody.evidence,
      },
      select: {
        id: true,
        title: true,
        summary: true,
        creatorId: true,
        topicId: true,
        reportType: true,
      },
    });

    return { deleted: deleted.count, report };
  });
}

export function buildStarterReport(input: StarterReportInput): {
  title: string;
  summary: string;
  evidence: Prisma.InputJsonObject;
} {
  const sortedSummaries = [...input.summaries].sort(
    (a, b) =>
      (b.video.publishedAt?.getTime() ?? 0) -
      (a.video.publishedAt?.getTime() ?? 0),
  );
  const videoCount = input.summaries.length;
  const stanceCounts = countStances(input.summaries);
  const supportiveCount = stanceCounts.supportive ?? 0;
  const mixedCount = stanceCounts.mixed ?? 0;
  const neutralCount = stanceCounts.neutral ?? 0;
  const analyzedRange = describeRange(sortedSummaries);
  const quoteRows = selectCuratedQuotes(input.evidenceRows);
  const sourceRows = quoteRows.length > 0 ? quoteRows : input.evidenceRows.slice(0, 4);

  const modernExamples = selectVideoExamples(sortedSummaries, [
    "Peak Foldable",
    "Z Tri Fold",
    "Pixel Pro Fold",
    "Pixel 9 Pro Fold",
    "Are Foldables Cooked",
  ]);
  const earlierExamples = selectVideoExamples(sortedSummaries, [
    "State of Foldables 2022",
    "Google Pixel Fold Review",
    "Samsung Z Flip 5",
    "OnePlus Open",
    "Samsung Galaxy Fold Impressions",
  ]);

  return {
    title: STARTER_REPORT_TITLE,
    summary:
      `${input.creator.name}'s foldable coverage reads as practical optimism: he is clearly interested in the category's ambition, but he keeps judging each device by whether the folding design earns its cost, thickness, camera compromises, durability concerns, and software complexity. ` +
      `In the imported transcripts, supportive readings outnumber mixed ones, yet the support is conditional rather than hype-driven. ` +
      `The clearest throughline is that foldables become compelling when they stop feeling like proofs of concept and start behaving like excellent everyday phones.`,
    evidence: {
      sections: [
        {
          heading: "Overall stance",
          bullets: [
            `${input.creator.name}'s stance is best described as optimistic but demanding. Across ${videoCount} relevant imported videos${analyzedRange}, the model finds ${supportiveCount} supportive, ${mixedCount} mixed, and ${neutralCount} neutral video-level readings. That balance matters because his praise usually arrives with practical conditions: the device needs to justify its price, survive normal use, and avoid feeling like a compromise masquerading as innovation.`,
            "The repeated pattern is not blanket enthusiasm. He tends to reward foldables when the larger inner display, multitasking, thinness, or maturing hardware make the form factor feel genuinely useful, then pulls back when cameras, bulk, durability, app behavior, or price make the folding mechanism feel like the headline instead of the benefit.",
          ],
        },
        {
          heading: "How the coverage has evolved",
          bullets: [
            `The earlier foldable coverage is framed around possibility mixed with first-generation caution. Videos such as ${formatExampleList(earlierExamples)} capture the phase where the category was exciting, but still visibly fighting hardware compromises like thickness, delicate screens, price, camera tradeoffs, and the feeling that normal buyers might be better served waiting.`,
            `The later coverage sounds more mature and less theoretical. Videos such as ${formatExampleList(modernExamples)} show a category that has become thinner, more varied, and more credible, but his standard has also risen: a foldable now has to compete as a great phone, not merely as a clever folding object.`,
          ],
        },
        {
          heading: "What decides the verdict",
          bullets: [
            "Hardware polish is the main separator between curiosity and recommendation. When a foldable reduces the visible crease, improves thinness, adds better cameras, or makes the unfolded screen feel meaningfully more useful, the tone becomes much more favorable because the category starts solving real user problems instead of only showing off engineering.",
            "The biggest checks on enthusiasm are the same practical concerns that decide whether a premium phone is worth buying: cost, pocketability, durability, battery, app compatibility, and camera quality. That is why the coverage can be supportive overall while still sounding careful, because the category's best moments are impressive but the tradeoffs remain unusually expensive.",
          ],
        },
        {
          heading: "In their own words",
          bullets: quoteRows.map(formatQuoteBullet),
        },
        {
          heading: "Limits of this reading",
          bullets: [
            "This report reflects the imported transcript set and the foldable smartphone reviews topic only. Some cited videos discuss foldables alongside adjacent products, awards, or broader smartphone trends, so the analysis should be read as a transcript-backed pattern rather than a claim that every source video is exclusively about foldables.",
            "The automated stance labels are most useful as directional evidence. The richer takeaway comes from combining those labels with the source videos and transcript excerpts: MKBHD appears interested in foldables as a serious product category, but only when the device clears the everyday-phone bar.",
          ],
        },
      ].filter(
        (section) => section.bullets.length > 0,
      ) as Prisma.InputJsonArray,
      evidence: sourceRows.map((row) => ({
        analysisId: row.id,
        videoId: row.video.id,
        videoTitle: row.video.title,
        topic: input.topic.name,
        note: `${formatDate(row.video.publishedAt)} - ${humanizeStance(row.stanceLabel)}: ${sourceNote(row)}`,
      })) as Prisma.InputJsonArray,
    },
  };
}

function countStances(
  summaries: StarterReportInput["summaries"],
): Partial<Record<StanceLabel, number>> {
  return summaries.reduce<Partial<Record<StanceLabel, number>>>(
    (counts, row) => {
      counts[row.dominantStance] = (counts[row.dominantStance] ?? 0) + 1;
      return counts;
    },
    {},
  );
}

function describeRange(summaries: StarterReportInput["summaries"]): string {
  const dates = summaries
    .map((row) => row.video.publishedAt)
    .filter((date): date is Date => Boolean(date))
    .map((date) => date.getTime())
    .sort((a, b) => a - b);
  if (dates.length === 0) return "";
  return ` from ${formatDate(new Date(dates[0]))} through ${formatDate(new Date(dates[dates.length - 1]))}`;
}

function selectVideoExamples(
  summaries: StarterReportInput["summaries"],
  titleNeedles: string[],
): StarterReportInput["summaries"] {
  const matches: StarterReportInput["summaries"] = [];
  for (const needle of titleNeedles) {
    const match = summaries.find((row) =>
      row.video.title.toLowerCase().includes(needle.toLowerCase()),
    );
    if (match && !matches.some((row) => row.video.id === match.video.id)) {
      matches.push(match);
    }
  }
  return matches.slice(0, 4);
}

function formatExampleList(rows: StarterReportInput["summaries"]): string {
  if (rows.length === 0) return "the available source videos";
  return rows
    .map((row) => `${row.video.title} (${formatDate(row.video.publishedAt)})`)
    .join(", ");
}

function selectCuratedQuotes(
  rows: StarterReportInput["evidenceRows"],
): StarterReportInput["evidenceRows"] {
  const preferredPhrases = [
    "for years these folding phones never really had flagship cameras",
    "still kind of a chunky foldable phone",
    "each half of a good folding phone is often even thinner",
    "best folding phone on the planet",
    "screen that you get when you unfold it",
    "following and reviewing and defending foldable smartphones",
    "both one of the best folding phones",
  ];
  const selected: StarterReportInput["evidenceRows"] = [];
  for (const phrase of preferredPhrases) {
    const match = rows.find((row) =>
      cleanText(row.evidenceQuote).toLowerCase().includes(phrase),
    );
    if (match && !selected.some((row) => row.id === match.id)) {
      selected.push(match);
    }
  }
  for (const row of rows) {
    if (selected.length >= 6) break;
    const quote = cleanText(row.evidenceQuote);
    if (
      quote.length >= 60 &&
      !quote.includes("…") &&
      !selected.some((selectedRow) => selectedRow.id === row.id)
    ) {
      selected.push(row);
    }
  }
  return selected.slice(0, 6);
}

function formatQuoteBullet(row: StarterReportInput["evidenceRows"][number]) {
  return {
    quote: quoteExcerpt(row),
    citation: `${row.video.title} transcript (${formatDate(row.video.publishedAt)}, ${humanizeStance(row.stanceLabel)})`,
    videoId: row.video.id,
  };
}

function sourceNote(row: StarterReportInput["evidenceRows"][number]): string {
  const quote = cleanText(row.evidenceQuote);
  if (quote.toLowerCase().includes("flagship cameras")) {
    return "Uses camera compromises to explain why older foldables struggled to match flagship expectations.";
  }
  if (quote.toLowerCase().includes("chunky foldable")) {
    return "Highlights thickness as a practical tradeoff even in newer foldable hardware.";
  }
  if (quote.toLowerCase().includes("thinner than this iphone")) {
    return "Frames modern folding-phone engineering as thinner and more competitive than many buyers may expect.";
  }
  if (quote.toLowerCase().includes("best folding phone")) {
    return "Shows clear enthusiasm when a foldable feels polished enough for mainstream buyers.";
  }
  if (quote.toLowerCase().includes("unfold")) {
    return "Points to the larger unfolded screen as the moment where the form factor starts to make sense.";
  }
  if (quote.toLowerCase().includes("defending foldable smartphones")) {
    return "Makes the long-running interest in foldables explicit while still raising hard questions about the category.";
  }
  return trimQuote(quote);
}

function quoteExcerpt(row: StarterReportInput["evidenceRows"][number]): string {
  const quote = cleanText(row.evidenceQuote);
  const lower = quote.toLowerCase();
  if (lower.includes("flagship cameras")) {
    return "for years these folding phones never really had flagship cameras, because there wasn't enough room.";
  }
  if (lower.includes("chunky foldable")) {
    return "It's still kind of a chunky foldable phone, which is very noticeable compared to newer ultra-thin folding phones.";
  }
  if (lower.includes("thinner than this iphone")) {
    return "each half of a good folding phone is often even thinner than this iPhone.";
  }
  if (lower.includes("best folding phone")) {
    return "I think this is the best folding phone on the planet for the most people right now.";
  }
  if (lower.includes("screen that you get when you unfold it")) {
    return "the screen that you get when you unfold it, this widescreen 10-in tablet, is a massive difference.";
  }
  if (lower.includes("defending foldable smartphones")) {
    return "I've been following and reviewing and defending foldable smartphones for a while now, basically since day one.";
  }
  return trimQuote(quote);
}

function trimQuote(value: string): string {
  if (value.length <= 220) return value;
  return `${value.slice(0, 217).trim()}...`;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^(?:\.{3}|…)\s*/, "")
    .replace(/\s*(?:\.{3}|…)$/g, "")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function humanizeStance(value: StanceLabel): string {
  return value.replace(/_/g, " ");
}

function formatDate(value: Date | null): string {
  if (!value) return "Undated";
  return value.toISOString().slice(0, 10);
}
