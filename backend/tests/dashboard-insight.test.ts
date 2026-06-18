import { describe, it, expect } from "vitest";
import {
  selectFeaturedTimeline,
  toFeaturedInsight,
  MIN_VIDEOS_FOR_FEATURE,
  type TimelineLike,
} from "../src/services/dashboardInsight";

function timeline(
  overrides: Partial<TimelineLike> & { trendLabel: TimelineLike["trendLabel"] },
): TimelineLike {
  return {
    creatorId: "c1",
    topicId: "t1",
    summary: "s",
    creator: { name: "Alice" },
    topic: { name: "Climate" },
    videoCount: MIN_VIDEOS_FOR_FEATURE,
    ...overrides,
  };
}

describe("selectFeaturedTimeline", () => {
  it("prefers an abrupt shift over a gradual one when both are well-supported", () => {
    const gradual = timeline({ trendLabel: "gradual_shift", videoCount: 50 });
    const abrupt = timeline({
      trendLabel: "abrupt_shift",
      topicId: "t2",
      videoCount: 20,
    });
    expect(selectFeaturedTimeline([gradual, abrupt])).toBe(abrupt);
  });

  it("demotes an under-supported shift below a well-supported stable topic", () => {
    const flimsyShift = timeline({
      trendLabel: "abrupt_shift",
      topicId: "ta",
      videoCount: 2,
    });
    const solidStable = timeline({
      trendLabel: "stable",
      topicId: "tb",
      videoCount: 40,
    });
    expect(selectFeaturedTimeline([flimsyShift, solidStable])).toBe(
      solidStable,
    );
  });

  it("breaks ties between same-trend candidates by video count", () => {
    const small = timeline({
      trendLabel: "gradual_shift",
      topicId: "ts",
      videoCount: 10,
    });
    const big = timeline({
      trendLabel: "gradual_shift",
      topicId: "tb",
      videoCount: 90,
    });
    expect(selectFeaturedTimeline([small, big])).toBe(big);
  });

  it("ranks mixed ('debated') above plain stable when both are well-supported", () => {
    const mixed = timeline({
      trendLabel: "mixed",
      topicId: "tm",
      videoCount: 20,
    });
    const stable = timeline({
      trendLabel: "stable",
      topicId: "ts",
      videoCount: 25,
    });
    expect(selectFeaturedTimeline([mixed, stable])).toBe(mixed);
  });

  it("still returns the best candidate when nothing meets the support bar", () => {
    const a = timeline({
      trendLabel: "gradual_shift",
      topicId: "ta",
      videoCount: 2,
    });
    const b = timeline({ trendLabel: "stable", topicId: "tb", videoCount: 5 });
    /* Neither is credible; falls back to the higher video count. */
    expect(selectFeaturedTimeline([a, b])).toBe(b);
  });

  it("returns null when there are no candidates", () => {
    expect(selectFeaturedTimeline([])).toBeNull();
  });
});

describe("toFeaturedInsight", () => {
  it("maps a timeline to the featured-insight payload (no backing report)", () => {
    const insight = toFeaturedInsight(
      timeline({
        trendLabel: "gradual_shift",
        creator: { name: "Bob" },
        topic: { name: "AI" },
      }),
    );
    expect(insight).toEqual({
      creatorId: "c1",
      creatorName: "Bob",
      topicId: "t1",
      topicName: "AI",
      trendLabel: "gradual_shift",
      summary: "s",
      reportId: null,
      reportTitle: null,
    });
  });

  it("prefers the backing report's title + summary and exposes its id", () => {
    const insight = toFeaturedInsight(
      timeline({
        trendLabel: "gradual_shift",
        creator: { name: "Bob" },
        topic: { name: "AI" },
      }),
      { id: "r1", title: "Bob pivots on AI", summary: "real report summary" },
    );
    expect(insight).toMatchObject({
      summary: "real report summary",
      reportId: "r1",
      reportTitle: "Bob pivots on AI",
    });
  });

  it("returns null when there is no timeline", () => {
    expect(toFeaturedInsight(null)).toBeNull();
  });
});
