import { describe, it, expect } from "vitest";
import {
  sortMoments,
  dominantFamily,
  deriveVerdict,
  type StanceMoment,
} from "../../src/lib/stanceTimeline";

/*
 * Factory for a StanceMoment with sensible defaults so each test only
 * states the fields it cares about (date + stance, usually).
 */
function moment(
  overrides: Partial<StanceMoment> &
    Pick<StanceMoment, "id" | "date" | "stance">,
): StanceMoment {
  return {
    videoTitle: "A video",
    videoHref: "/videos/v1",
    evidenceQuote: null,
    summary: null,
    ...overrides,
  };
}

describe("sortMoments", () => {
  it("sorts ascending by date without mutating the input", () => {
    const input = [
      moment({ id: "b", date: "2023-01-01", stance: "supportive" }),
      moment({ id: "a", date: "2021-01-01", stance: "opposed" }),
    ];
    const sorted = sortMoments(input);
    expect(sorted.map((m) => m.id)).toEqual(["a", "b"]);
    /* original order preserved */
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("dominantFamily", () => {
  it("returns neutral for an empty set", () => {
    expect(dominantFamily([])).toBe("neutral");
  });

  it("picks the most frequent family", () => {
    const moments = [
      moment({ id: "1", date: "2021-01-01", stance: "supportive" }),
      moment({ id: "2", date: "2021-02-01", stance: "supportive" }),
      moment({ id: "3", date: "2021-03-01", stance: "opposed" }),
    ];
    expect(dominantFamily(moments)).toBe("supportive");
  });

  it("collapses non-directional stances into neutral", () => {
    const moments = [
      moment({ id: "1", date: "2021-01-01", stance: "mixed" }),
      moment({ id: "2", date: "2021-02-01", stance: "unclear" }),
      moment({ id: "3", date: "2021-03-01", stance: "insufficient_evidence" }),
    ];
    expect(dominantFamily(moments)).toBe("neutral");
  });
});

describe("deriveVerdict", () => {
  it("reports a flat empty verdict with no moments", () => {
    const v = deriveVerdict([]);
    expect(v.family).toBe("neutral");
    expect(v.headline).toMatch(/not enough dated evidence/i);
    expect(v.shifted).toBe(false);
  });

  it("reports a single dated stance with no trend", () => {
    const v = deriveVerdict([
      moment({ id: "1", date: "2022-06-01", stance: "supportive" }),
    ]);
    expect(v.family).toBe("supportive");
    expect(v.headline).toMatch(/supportive on/i);
    expect(v.shifted).toBe(false);
  });

  it("reports a steady lean when start and end families match", () => {
    /* Mid-year dates so the local-timezone year never crosses a boundary. */
    const v = deriveVerdict([
      moment({ id: "1", date: "2021-06-15", stance: "supportive" }),
      moment({ id: "2", date: "2022-06-15", stance: "neutral" }),
      moment({ id: "3", date: "2023-06-15", stance: "supportive" }),
    ]);
    expect(v.shifted).toBe(false);
    expect(v.headline).toMatch(/leans supportive — steady since 2021/i);
  });

  it("reports a shift when the family changes start → end", () => {
    const v = deriveVerdict([
      moment({ id: "1", date: "2021-06-15", stance: "opposed" }),
      moment({ id: "2", date: "2023-06-15", stance: "supportive" }),
    ]);
    expect(v.shifted).toBe(true);
    expect(v.headline).toMatch(/shifted: opposed → supportive in 2023/i);
  });

  it("omits the year on a shift when the latest date is unparseable", () => {
    const v = deriveVerdict([
      moment({ id: "1", date: "2021-01-01", stance: "opposed" }),
      moment({ id: "2", date: "not-a-date", stance: "supportive" }),
    ]);
    /*
     * Unparseable dates sort to the front (NaN compares as 0), so the
     * bad-date moment can land first OR last; either way the year suffix
     * is dropped when the boundary date is unparseable.
     */
    expect(v.shifted).toBe(true);
    expect(v.headline).not.toMatch(/in \d{4}/);
  });

  it("falls back to a bare 'steady' when the first date is unparseable", () => {
    const v = deriveVerdict([
      moment({ id: "1", date: "bad", stance: "supportive" }),
      moment({ id: "2", date: "also-bad", stance: "supportive" }),
    ]);
    expect(v.shifted).toBe(false);
    expect(v.headline).toMatch(/leans supportive — steady$/i);
  });
});
