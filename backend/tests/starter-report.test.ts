import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../src/utils/errors";
import {
  buildStarterReport,
  resetReportsToStarter,
} from "../src/services/starterReport.service";

const creator = { id: "creator-1", name: "Marques Brownlee" };
const topic = { id: "topic-1", name: "Foldable Smartphone Reviews" };

function video(title: string, publishedAt: Date | null = new Date("2026-01-01")) {
  return { id: title.toLowerCase().replace(/\W+/g, "-"), title, publishedAt };
}

describe("seeded report builder", () => {
  it("builds a deterministic report from real timeline, summary, and quote rows", () => {
    const report = buildStarterReport({
      creator,
      topic,
      timeline: {
        trendLabel: "stable",
        summary: " MKBHD stays interested, but keeps caveats around thickness. ",
      },
      summaries: [
        {
          dominantStance: "supportive",
          mentionCount: 2,
          summary: "Foldables are improving.",
          video: video("So This is Peak Foldable", new Date("2026-02-01")),
        },
        {
          dominantStance: "mixed",
          mentionCount: 1,
          summary: "Earlier hardware felt compromised.",
          video: video("Older Foldable", new Date("2020-01-01")),
        },
      ],
      evidenceRows: [
        {
          id: "analysis-1",
          stanceLabel: "supportive",
          evidenceQuote:
            "for years these folding phones never really had flagship cameras, because there wasn't enough room.",
          video: video("Quote Video"),
        },
      ],
    });

    expect(report.title).toBe(
      "MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs",
    );
    expect(report.summary).toContain("practical optimism");
    expect(report.summary).not.toContain("starter");
    expect(report.evidence.sections).toHaveLength(5);
    expect(JSON.stringify(report.evidence)).toContain("So This is Peak Foldable");
    expect(JSON.stringify(report.evidence)).toContain("flagship cameras");
    const ownWordsSection = (
      report.evidence.sections as Array<{
        heading: string;
        bullets: Array<{ quote?: string; citation?: string; videoId?: string }>;
      }>
    ).find((section) => section.heading === "In their own words");
    expect(ownWordsSection?.bullets[0]).toMatchObject({
      quote: expect.stringContaining("flagship cameras"),
      citation: "Quote Video transcript (2026-01-01, supportive)",
      videoId: "quote-video",
    });
  });

  it("covers undated evidence paths without exposing setup language", () => {
    const report = buildStarterReport({
      creator,
      topic,
      timeline: null,
      summaries: [
        {
          dominantStance: "insufficient_evidence",
          mentionCount: 0,
          summary: null,
          video: video("No Date", null),
        },
      ],
      evidenceRows: [
        {
          id: "analysis-2",
          stanceLabel: "insufficient_evidence",
          evidenceQuote: null,
          video: video("Undated Quote", null),
        },
      ],
    });

    expect(report.summary).toContain("excellent everyday phones");
    expect(JSON.stringify(report.evidence)).toContain("Undated");
    expect(JSON.stringify(report.evidence)).toContain("Limits of this reading");
    expect(JSON.stringify(report.evidence)).not.toContain("starter");
  });

  it("formats each curated quote pattern into readable bullets and source notes", () => {
    const report = buildStarterReport({
      creator,
      topic,
      timeline: null,
      summaries: [],
      evidenceRows: [
        {
          id: "analysis-chunky",
          stanceLabel: "supportive",
          evidenceQuote:
            "It's it's still kind of a chunky foldable phone, which is very noticeable when compared to newer ultra-thin folding phones.",
          video: video("Pixel Fold"),
        },
        {
          id: "analysis-thin",
          stanceLabel: "supportive",
          evidenceQuote:
            "Each half of a good folding phone is often even thinner than this iPhone.",
          video: video("iPhone Air"),
        },
        {
          id: "analysis-best",
          stanceLabel: "supportive",
          evidenceQuote:
            "I think this is the best folding phone on the planet for the most people right now.",
          video: video("Best Foldable"),
        },
        {
          id: "analysis-unfold",
          stanceLabel: "supportive",
          evidenceQuote:
            "The screen that you get when you unfold it, this widescreen 10-in tablet, is a massive difference.",
          video: video("Tri Fold"),
        },
        {
          id: "analysis-defending",
          stanceLabel: "supportive",
          evidenceQuote:
            "I've been following and reviewing and defending foldable smartphones for a while now, basically since day one.",
          video: video("Are Foldables Cooked"),
        },
      ],
    });

    const serialized = JSON.stringify(report.evidence);
    expect(serialized).toContain("ultra-thin folding phones");
    expect(serialized).toContain("thinner than this iPhone");
    expect(serialized).toContain("best folding phone on the planet");
    expect(serialized).toContain("widescreen 10-in tablet");
    expect(serialized).toContain("defending foldable smartphones");
    expect(serialized).toContain("practical tradeoff");
    expect(serialized).toContain("clear enthusiasm");
    expect(serialized).toContain("larger unfolded screen");
    expect(serialized).toContain("long-running interest");
  });

  it("trims long generic evidence when no curated phrase matches", () => {
    const report = buildStarterReport({
      creator,
      topic,
      timeline: null,
      summaries: [],
      evidenceRows: [
        {
          id: "analysis-generic",
          stanceLabel: "mixed",
          evidenceQuote: `${"generic foldable evidence ".repeat(15)}final thought`,
          video: video("Generic Foldable"),
        },
      ],
    });

    const serialized = JSON.stringify(report.evidence);
    expect(serialized).toContain("Generic Foldable");
    expect(serialized).toContain("...");
  });
});

describe("resetReportsToStarter", () => {
  function buildDb(overrides: {
    creator?: typeof creator | null;
    topic?: typeof topic | null;
  } = {}) {
    const tx = {
      creator: {
        findUnique: vi
          .fn()
          .mockResolvedValue("creator" in overrides ? overrides.creator : creator),
      },
      topic: {
        findUnique: vi
          .fn()
          .mockResolvedValue("topic" in overrides ? overrides.topic : topic),
      },
      creatorTopicTimeline: {
        findUnique: vi.fn().mockResolvedValue({
          trendLabel: "stable",
          summary: "stable summary",
        }),
      },
      videoTopicSummary: { findMany: vi.fn().mockResolvedValue([]) },
      chunkTopicAnalysis: { findMany: vi.fn().mockResolvedValue([]) },
      report: {
        deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
        create: vi.fn().mockResolvedValue({
          id: "report-1",
          title:
            "MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs",
          summary: "summary",
          creatorId: creator.id,
          topicId: topic.id,
          reportType: "topic_summary",
        }),
      },
    };
    return {
      tx,
      db: {
        $transaction: vi.fn(async (callback) => callback(tx)),
      },
    };
  }

  it("deletes all reports and creates the seeded report in one transaction", async () => {
    const { db, tx } = buildDb();
    const result = await resetReportsToStarter(db as never);

    expect(tx.report.deleteMany).toHaveBeenCalledWith({});
    expect(tx.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorId: creator.id,
          topicId: topic.id,
          reportType: "topic_summary",
        }),
      }),
    );
    expect(result.deleted).toBe(4);
    expect(result.report.id).toBe("report-1");
  });

  it("fails clearly when the starter creator is missing", async () => {
    const { db } = buildDb({ creator: null });
    await expect(resetReportsToStarter(db as never)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("fails clearly when the starter topic is missing", async () => {
    const { db } = buildDb({ topic: null });
    await expect(resetReportsToStarter(db as never)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
