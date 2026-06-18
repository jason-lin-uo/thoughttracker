import { afterEach, describe, expect, it, vi } from "vitest";
import * as llm from "../src/ai/llmClient";
import {
  generateCreatorReport,
  generateTopicReport,
} from "../src/services/reportGeneration.service";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportGeneration degraded-provider guard", () => {
  it("throws instead of returning a fallback creator report when real generation degraded", async () => {
    vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: {},
      provider: "mock",
      modelName: "mock-llm-v1",
      degraded: true,
    });

    await expect(
      generateCreatorReport({
        creatorName: "Creator",
        topics: [
          {
            topicName: "AI",
            trendLabel: "stable",
            timelineSummary: "steady",
            videoCount: 1,
          },
        ],
      }),
    ).rejects.toThrow("creator_report_llm_degraded");
  });

  it("throws instead of returning a fallback topic report when real generation degraded", async () => {
    vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: {},
      provider: "mock",
      modelName: "mock-llm-v1",
      degraded: true,
    });

    await expect(
      generateTopicReport({
        creatorName: "Creator",
        topicName: "AI",
        summaries: [
          {
            videoId: "video-1",
            videoTitle: "Video",
            dominantStance: "supportive",
            summary: "The creator supports the topic.",
          },
        ],
      }),
    ).rejects.toThrow("topic_report_llm_degraded");
  });

  it("repairs local creator report JSON when Ollama uses array caveats", async () => {
    vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: {
        title: "Creator has a consistent AI throughline",
        summary: "The creator repeatedly treats AI as useful but risky.",
        caveats: [
          {
            heading: "Data limit",
            body: "Only imported transcripts are considered.",
          },
        ],
        sections: [
          {
            title: "Main pattern",
            content: "They balance optimism with caution.",
          },
        ],
        evidence: ["AI is useful, but should be deployed carefully."],
      },
      provider: "local",
      modelName: "llama3.1:8b",
    });

    const report = await generateCreatorReport({
      creatorName: "Creator",
      topics: [
        {
          topicName: "AI",
          trendLabel: "stable",
          timelineSummary: "steady",
          videoCount: 1,
        },
      ],
    });

    expect(report.caveats).toContain("Data limit");
    expect(report.sections[0]).toEqual({
      heading: "Main pattern",
      body: "They balance optimism with caution.",
    });
    expect(report.evidence[0]).toEqual({
      note: "AI is useful, but should be deployed carefully.",
    });
  });

  it("repairs local topic report JSON when Ollama uses alternate section fields", async () => {
    vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: {
        title: "AI gets a nuanced treatment",
        summary:
          "The topic report emphasizes usefulness and deployment caution.",
        caveats: [{ body: "Transcript-only analysis." }],
        insights: [
          {
            name: "Overall stance",
            text: "The stance is mixed rather than purely supportive.",
          },
        ],
        citations: [
          {
            videoId: "video-1",
            quote: "AI is useful, but we should be careful.",
          },
        ],
      },
      provider: "local",
      modelName: "llama3.1:8b",
    });

    const report = await generateTopicReport({
      creatorName: "Creator",
      topicName: "AI",
      summaries: [
        {
          videoId: "video-1",
          videoTitle: "Video",
          dominantStance: "mixed",
          summary: "The creator supports useful AI but warns about risk.",
        },
      ],
    });

    expect(report.caveats).toContain("Transcript-only analysis.");
    expect(report.sections[0]).toEqual({
      heading: "Overall stance",
      body: "The stance is mixed rather than purely supportive.",
    });
    expect(report.evidence[0]).toEqual({
      videoId: "video-1",
      note: "AI is useful, but we should be careful.",
    });
  });

  it("normalizes local topic report bullets to readable strings", async () => {
    vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: {
        title: "AI gets a nuanced treatment",
        summary:
          "The topic report emphasizes usefulness and deployment caution.",
        caveats: "Transcript-only analysis.",
        sections: [
          {
            heading: "Overall stance",
            bullets: [
              {
                claim:
                  "The creator frames AI as useful only when deployed with care.",
                evidence: '"AI is useful, but we should be careful."',
                implication:
                  "The stance is mixed rather than purely supportive.",
                caveat: "Only one representative video was supplied.",
                confidence: "medium",
              },
            ],
          },
        ],
        evidence: [
          {
            videoId: "video-1",
            note: "AI is useful, but we should be careful.",
          },
        ],
      },
      provider: "local",
      modelName: "llama3.1:8b",
    });

    const report = await generateTopicReport({
      creatorName: "Creator",
      topicName: "AI",
      summaries: [
        {
          videoId: "video-1",
          videoTitle: "Video",
          dominantStance: "mixed",
          summary: "The creator supports useful AI but warns about risk.",
        },
      ],
    });

    expect(report.sections[0]).toEqual({
      heading: "Overall stance",
      bullets: [
        "The creator frames AI as useful only when deployed with care. The stance is mixed rather than purely supportive. Only one representative video was supplied.",
      ],
    });
  });

  it("repairs messy local creator report shapes into valid readable sections", async () => {
    vi.spyOn(llm, "runLlm").mockResolvedValue({
      rawText: "{}",
      json: {
        title: [
          "Creator report",
          { heading: "Angle", body: "nuanced AI coverage" },
        ],
        summary: { message: "The channel balances enthusiasm with caution." },
        caveats: [
          "Transcript-only",
          { title: "Scope", content: "Imported videos only." },
        ],
        sections: [
          "Standalone insight from a plain string.",
          " ",
          17,
          {
            title: "Bullet-led section",
            body: ["Context lead", { heading: "Detail", body: "more detail" }],
            bullets: [
              "Direct bullet",
              " ",
              3,
              { claim: "" },
              {
                point: "Object bullet",
                whyItMatters: "It clarifies the reader-facing takeaway.",
                warning: "Treat as transcript evidence, not private belief.",
              },
            ],
          },
          {
            name: "Nested body section",
            text: { message: "A nested text object becomes plain prose." },
          },
        ],
        evidence: [
          "Plain source note",
          " ",
          12,
          {},
          {
            videoId: "video-1",
            topicId: "topic-1",
            note: ["Quote note", { title: "Source", body: "video context" }],
          },
        ],
      },
      provider: "local",
      modelName: "llama3.1:8b",
    });

    const report = await generateCreatorReport({
      creatorName: "Creator",
      topics: [
        {
          topicName: "AI",
          trendLabel: "stable",
          timelineSummary: "steady",
          videoCount: 1,
        },
      ],
    });

    expect(report.title).toContain("Creator report");
    expect(report.summary).toBe(
      "The channel balances enthusiasm with caution.",
    );
    expect(report.sections).toEqual([
      { heading: "Insight 1", body: "Standalone insight from a plain string." },
      {
        heading: "Bullet-led section",
        body: "Context lead Detail: more detail",
        bullets: [
          "Direct bullet",
          "Object bullet It clarifies the reader-facing takeaway. Treat as transcript evidence, not private belief.",
        ],
      },
      {
        heading: "Nested body section",
        body: "A nested text object becomes plain prose.",
      },
    ]);
    expect(report.evidence).toEqual([
      { note: "Plain source note" },
      {
        videoId: "video-1",
        topicId: "topic-1",
        note: "Quote note Source: video context",
      },
    ]);
  });
});
