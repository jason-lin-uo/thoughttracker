import { describe, it, expect } from "vitest";
import { featuredHeadline } from "../../src/lib/dashboard";
import type { FeaturedInsight, TrendLabel } from "../../src/lib/types";

/* Minimal FeaturedInsight factory — only the fields featuredHeadline reads. */
function insight(trendLabel: TrendLabel): FeaturedInsight {
  return {
    creatorId: "c1",
    creatorName: "Alice",
    topicId: "t1",
    topicName: "Climate",
    trendLabel,
    summary: "summary",
  };
}

describe("featuredHeadline", () => {
  it("frames an abrupt shift as the biggest stance shift", () => {
    const { eyebrow, title } = featuredHeadline(insight("abrupt_shift"));
    expect(eyebrow).toMatch(/biggest stance shift/i);
    expect(title).toMatch(/pivoted sharply on Climate/i);
    expect(title).toContain("Alice");
  });

  it("frames a gradual shift as the biggest stance shift", () => {
    const { eyebrow, title } = featuredHeadline(insight("gradual_shift"));
    expect(eyebrow).toMatch(/biggest stance shift/i);
    expect(title).toMatch(/has been shifting/i);
  });

  it("frames a mixed trend as the most debated topic", () => {
    const { eyebrow, title } = featuredHeadline(insight("mixed"));
    expect(eyebrow).toMatch(/most debated/i);
    expect(title).toMatch(/divided on Climate/i);
  });

  it("frames a stable/other trend as a topic spotlight", () => {
    const { eyebrow, title } = featuredHeadline(insight("stable"));
    expect(eyebrow).toMatch(/spotlight/i);
    expect(title).toMatch(/steady line on Climate/i);
  });
});
