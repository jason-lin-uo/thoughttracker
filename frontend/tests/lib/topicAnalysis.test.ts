import { describe, it, expect } from "vitest";
import {
  averageConfidencePct,
  buildEvidenceRows,
  buildStancePoints,
  computeVerdict,
  evidenceInRange,
  filterAndSortEvidence,
  groupByMonth,
  isoDate,
  MS_PER_DAY,
  pointsExtent,
  pointsInRange,
  presetRange,
  stanceCounts,
  type EvidenceRow,
  type StancePoint,
} from "../../src/lib/topicAnalysis";
import type { TopicAnalysis } from "../../src/lib/types";

/**
 * Pure-helper tests for the analyst-console derivations. These are the
 * single source of truth for "what's in range", the verdict, the heatmap
 * grouping, and the evidence sort/filter pipeline — so they're tested in
 * isolation (no React) here, with the component tests asserting wiring only.
 */

/*
 * A minimal TopicAnalysis builder: two dated summaries (supportive + mixed)
 * with notable-evidence on the first, plus evidence rows (one with a quote, one
 * without a quote, one without a dated video) so the build filters exercise
 * every drop path.
 */
function makeAnalysis(): TopicAnalysis {
  return {
    creator: {
      id: "c1",
      name: "Alice",
      slug: "alice",
      description: null,
      thumbnailUrl: null,
      creatorType: "youtube",
      createdAt: "",
      updatedAt: "",
    },
    topic: { id: "t1", name: "Climate", slug: "climate", description: null },
    timeline: null,
    summaries: [
      {
        id: "s1",
        videoId: "v1",
        topicId: "t1",
        creatorId: "c1",
        dominantStance: "supportive",
        confidenceScore: 1,
        confidenceLabel: "high",
        mentionCount: 2,
        summary: "sup",
        /* Real backend shape: { quote, chunkIndex } objects (NOT bare strings). */
        notableEvidence: [
          { quote: "Quote A", chunkIndex: 1 },
          { quote: "Quote B", chunkIndex: 4 },
        ],
        video: {
          id: "v1",
          title: "Ep1",
          publishedAt: "2026-03-02T00:00:00Z",
          sourceUrl: "https://x/v1",
          thumbnailUrl: null,
        },
      },
      {
        id: "s2",
        videoId: "v2",
        topicId: "t1",
        creatorId: "c1",
        dominantStance: "mixed",
        confidenceScore: 0.5,
        confidenceLabel: "medium",
        mentionCount: 1,
        summary: "mix",
        /* No notableEvidence → falls back to the matching topEvidence quote. */
        video: {
          id: "v2",
          title: "Ep2",
          publishedAt: "2026-05-20T00:00:00Z",
          sourceUrl: "https://x/v2",
          thumbnailUrl: null,
        },
      },
      {
        id: "s3",
        videoId: "v3",
        topicId: "t1",
        creatorId: "c1",
        dominantStance: "opposed",
        confidenceScore: 0.9,
        confidenceLabel: "high",
        mentionCount: 1,
        summary: "und",
        /* Undated → dropped from the trajectory. */
        video: {
          id: "v3",
          title: "Ep3",
          publishedAt: null,
          sourceUrl: "https://x/v3",
          thumbnailUrl: null,
        },
      },
    ],
    topEvidence: [
      {
        id: "ev2",
        chunkId: "ck2",
        videoId: "v2",
        creatorId: "c1",
        topicId: "t1",
        relevanceScore: 0.8,
        stanceLabel: "mixed",
        confidenceScore: 0.7,
        confidenceLabel: "medium",
        claimSummary: "Claim 2",
        rationale: null,
        evidenceQuote: "Fallback quote for v2",
        createdAt: "",
        video: {
          id: "v2",
          title: "Ep2",
          sourceUrl: "https://x/v2",
          publishedAt: "2026-05-20T00:00:00Z",
          thumbnailUrl: null,
        },
      },
      {
        /* No quote → dropped from evidence rows. */
        id: "ev-noquote",
        chunkId: "ck3",
        videoId: "v1",
        creatorId: "c1",
        topicId: "t1",
        relevanceScore: 0.7,
        stanceLabel: "supportive",
        confidenceScore: 0.9,
        confidenceLabel: "high",
        claimSummary: "Claim noquote",
        rationale: null,
        evidenceQuote: null,
        createdAt: "",
        video: {
          id: "v1",
          title: "Ep1",
          sourceUrl: "https://x/v1",
          publishedAt: "2026-03-02T00:00:00Z",
          thumbnailUrl: null,
        },
      },
      {
        /* No dated video → dropped from evidence rows. */
        id: "ev-nodate",
        chunkId: "ck4",
        videoId: "v9",
        creatorId: "c1",
        topicId: "t1",
        relevanceScore: 0.6,
        stanceLabel: "neutral",
        confidenceScore: 0.6,
        confidenceLabel: "medium",
        claimSummary: null,
        rationale: null,
        evidenceQuote: "orphan quote",
        createdAt: "",
        video: undefined,
      },
    ],
    report: null,
  };
}

describe("buildStancePoints", () => {
  it("maps dated summaries to sorted points and folds in quotes", () => {
    const points = buildStancePoints(makeAnalysis());
    /* v3 (undated) dropped; the rest sorted oldest → newest. */
    expect(points.map((p) => p.id)).toEqual(["s1", "s2"]);
    /* s1 keeps its own notableEvidence quotes. */
    expect(points[0].quotes).toEqual(["Quote A", "Quote B"]);
    /* s2 has no notableEvidence → falls back to the matching topEvidence quote. */
    expect(points[1].quotes).toEqual(["Fallback quote for v2"]);
    expect(points[0].sourceUrl).toBe("https://x/v1");
  });

  it("returns empty quotes when neither notableEvidence nor a fallback exists", () => {
    const data = makeAnalysis();
    data.summaries[0].notableEvidence = [];
    /* Remove the only quote-bearing evidence for v1 (none existed anyway). */
    const points = buildStancePoints(data);
    expect(points[0].quotes).toEqual([]);
  });
});

describe("buildEvidenceRows", () => {
  it("keeps only quoted, dated rows and maps the fields", () => {
    const rows = buildEvidenceRows(makeAnalysis());
    expect(rows.map((r) => r.id)).toEqual(["ev2"]);
    expect(rows[0]).toMatchObject({
      stance: "mixed",
      quote: "Fallback quote for v2",
      claim: "Claim 2",
    });
  });

  it("falls back to the video title when claimSummary is null", () => {
    const data = makeAnalysis();
    data.topEvidence[0].claimSummary = null;
    const rows = buildEvidenceRows(data);
    expect(rows[0].claim).toBe("Ep2");
  });
});

describe("range + extent helpers", () => {
  const points = buildStancePoints(makeAnalysis());

  it("pointsExtent returns min/max or null", () => {
    expect(pointsExtent([])).toBeNull();
    const ext = pointsExtent(points)!;
    expect(ext.min).toBe(points[0].t);
    expect(ext.max).toBe(points[points.length - 1].t);
  });

  it("presetRange spans all or a clamped day-window", () => {
    const ext = pointsExtent(points)!;
    expect(presetRange("all", ext)).toEqual({ start: ext.min, end: ext.max });
    /* 30d window from the max, clamped to the data min. */
    const r30 = presetRange("30", ext);
    expect(r30.end).toBe(ext.max);
    expect(r30.start).toBe(Math.max(ext.max - 30 * MS_PER_DAY, ext.min));
    /* A huge window clamps the start to the data min. */
    expect(presetRange("90", ext).start).toBe(ext.min);
  });

  it("presetRange snaps the window start to UTC midnight", () => {
    /*
     * A non-midnight max must NOT carry its time-of-day into the start, or
     * videos earlier on the boundary day are silently excluded even though the
     * date input displays (and a manual start-input parses to) that midnight.
     */
    const r = presetRange("30", {
      min: 0,
      max: Date.parse("2026-05-20T14:30:00Z"),
    });
    expect(new Date(r.start).getUTCHours()).toBe(0);
    expect(isoDate(r.start)).toBe("2026-04-20");
  });

  it("pointsInRange / evidenceInRange filter inclusively", () => {
    const ext = pointsExtent(points)!;
    /* A window covering only the first point. */
    const narrow = { start: ext.min, end: ext.min };
    expect(pointsInRange(points, narrow).map((p) => p.id)).toEqual(["s1"]);
    const rows = buildEvidenceRows(makeAnalysis());
    /* ev2 is dated 2026-05-20, outside the first-point-only window. */
    expect(evidenceInRange(rows, narrow)).toHaveLength(0);
    /* A row with an unparseable date is filtered out. */
    const bad: EvidenceRow = { ...rows[0], date: "not-a-date" };
    expect(evidenceInRange([bad], { start: 0, end: Date.now() })).toHaveLength(
      0,
    );
  });

  it("isoDate slices a timestamp to YYYY-MM-DD", () => {
    expect(isoDate(Date.parse("2026-03-02T12:00:00Z"))).toBe("2026-03-02");
  });
});

describe("verdict + counts + stats", () => {
  const points = buildStancePoints(makeAnalysis());

  it("stanceCounts tallies all four families", () => {
    expect(stanceCounts(points)).toEqual({
      supportive: 1,
      mixed: 1,
      neutral: 0,
      opposed: 0,
    });
  });

  it("computeVerdict resolves a tie to the earlier family and reports %", () => {
    /* supportive + mixed tie 1-1 → supportive wins (earlier in order), 50%. */
    const v = computeVerdict(points);
    expect(v).toEqual({ family: "supportive", pct: 50, count: 2 });
  });

  it("computeVerdict returns a neutral zero verdict for an empty range", () => {
    expect(computeVerdict([])).toEqual({ family: "neutral", pct: 0, count: 0 });
  });

  it("averageConfidencePct averages or returns null when empty", () => {
    expect(averageConfidencePct([])).toBeNull();
    /* 100% + 50% → 75%. */
    expect(averageConfidencePct(points)).toBe(75);
  });
});

describe("groupByMonth", () => {
  it("buckets points by month, oldest → newest", () => {
    const points = buildStancePoints(makeAnalysis());
    const groups = groupByMonth(points);
    expect(groups.map((g) => g.key)).toEqual(["2026-03", "2026-05"]);
    expect(groups[0].points).toHaveLength(1);
  });

  it("buckets by UTC month at a boundary (consistent with isoDate / the inputs)", () => {
    /*
     * 2026-02-01T02:00Z is February in UTC; local-time bucketing would push it
     * to January on a UTC- machine (e.g. the dev's Pacific Mac). UTC keeps the
     * heatmap cell in the same month the date inputs (UTC) display.
     */
    const p: StancePoint = {
      id: "x",
      t: Date.parse("2026-02-01T02:00:00Z"),
      date: "2026-02-01",
      stance: "neutral",
      conf: 1,
      title: "",
      sourceUrl: null,
      quotes: [],
      summary: null,
    };
    expect(groupByMonth([p])[0].key).toBe("2026-02");
    expect(isoDate(p.t).slice(0, 7)).toBe("2026-02");
  });

  it("groups multiple points in the same month into one bucket", () => {
    /*
     * Use mid-month noon timestamps so the local-time month is unambiguous
     * regardless of the test machine's timezone offset.
     */
    const sameMonth: StancePoint[] = [
      {
        id: "a",
        t: new Date(2026, 2, 10, 12).getTime(),
        date: "2026-03-10",
        stance: "supportive",
        conf: 1,
        title: "",
        sourceUrl: null,
        quotes: [],
        summary: null,
      },
      {
        id: "b",
        t: new Date(2026, 2, 20, 12).getTime(),
        date: "2026-03-20",
        stance: "opposed",
        conf: 1,
        title: "",
        sourceUrl: null,
        quotes: [],
        summary: null,
      },
    ];
    const groups = groupByMonth(sameMonth);
    expect(groups).toHaveLength(1);
    expect(groups[0].points).toHaveLength(2);
  });
});

describe("filterAndSortEvidence", () => {
  const rows: EvidenceRow[] = [
    {
      id: "r1",
      stance: "supportive",
      quote: "q1",
      claim: "c1",
      title: "t1",
      date: "2026-01-01",
      conf: 0.4,
    },
    {
      id: "r2",
      stance: "mixed",
      quote: "q2",
      claim: "c2",
      title: "t2",
      date: "2026-03-01",
      conf: 0.9,
    },
    {
      id: "r3",
      stance: "supportive",
      quote: "q3",
      claim: "c3",
      title: "t3",
      date: "2026-02-01",
      conf: 0.6,
    },
  ];

  it("filters by stance family ('all' keeps everything)", () => {
    expect(filterAndSortEvidence(rows, "all", "date_desc")).toHaveLength(3);
    expect(
      filterAndSortEvidence(rows, "supportive", "date_desc").map((r) => r.id),
    ).toEqual(["r3", "r1"]);
  });

  it("sorts by each option without mutating the input", () => {
    expect(
      filterAndSortEvidence(rows, "all", "date_desc").map((r) => r.id),
    ).toEqual(["r2", "r3", "r1"]);
    expect(
      filterAndSortEvidence(rows, "all", "date_asc").map((r) => r.id),
    ).toEqual(["r1", "r3", "r2"]);
    expect(
      filterAndSortEvidence(rows, "all", "conf_desc").map((r) => r.id),
    ).toEqual(["r2", "r3", "r1"]);
    expect(
      filterAndSortEvidence(rows, "all", "conf_asc").map((r) => r.id),
    ).toEqual(["r1", "r3", "r2"]);
    /* Original order untouched. */
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });
});
