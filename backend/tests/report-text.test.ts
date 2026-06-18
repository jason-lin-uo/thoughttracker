import { describe, it, expect } from "vitest";
import {
  cleanReportQuote,
  isUsableQuote,
  selectReportQuotes,
} from "../src/utils/reportText";

describe("cleanReportQuote", () => {
  it("returns empty string for empty input", () => {
    expect(cleanReportQuote("")).toBe("");
    expect(cleanReportQuote(" ")).toBe("");
  });

  it("decodes HTML entities", () => {
    expect(cleanReportQuote("box &amp; office &gt; expectations")).toBe(
      "Box & office > expectations",
    );
  });

  it("maps unknown entities to a space", () => {
    expect(cleanReportQuote("a&zzz;b cdef ghij")).toBe("A b cdef ghij");
  });

  it("strips leading caption markers and ellipses", () => {
    expect(
      cleanReportQuote(">> ...and then the movie flopped at the box office"),
    ).toBe("And then the movie flopped at the box office");
  });

  it("strips trailing ellipses but keeps a terminal period", () => {
    expect(cleanReportQuote("it found a second life on demand…")).toBe(
      "It found a second life on demand",
    );
    expect(cleanReportQuote("it found a second life on demand.")).toBe(
      "It found a second life on demand.",
    );
  });

  it("collapses internal whitespace", () => {
    expect(cleanReportQuote("the box office numbers were strong")).toBe(
      "The box office numbers were strong",
    );
  });

  it("trims a dangling partial word off the end and flags the truncation", () => {
    /* The window was sliced mid-word ("...closed in q"); drop the stub, add an ellipsis. */
    expect(cleanReportQuote("the deal closed in q")).toBe(
      "The deal closed in…",
    );
  });
});

describe("isUsableQuote", () => {
  it("rejects fragments below the word floor", () => {
    expect(isUsableQuote("too short here")).toBe(false);
  });

  it("accepts quotes at or above the floor", () => {
    expect(isUsableQuote("this one has plenty of real words here")).toBe(true);
  });

  it("honors a custom floor", () => {
    expect(isUsableQuote("three words exactly", 3)).toBe(true);
  });

  it("rejects a bare rhetorical question with no opinion", () => {
    expect(isUsableQuote("am i having a blood sugar crash?")).toBe(false);
  });

  it("keeps a question that actually states an opinion", () => {
    expect(isUsableQuote("is this the best phone you can buy right now?")).toBe(
      true,
    );
  });

  it("rejects ASR stutter with a repeated token", () => {
    expect(isUsableQuote("seem gr gr gr bitcoin everybody talking")).toBe(
      false,
    );
  });

  it("rejects a quote that is mostly vowelless garble", () => {
    expect(isUsableQuote("chth grpc tllk brbr mnmn pqrs")).toBe(false);
  });
});

describe("selectReportQuotes", () => {
  /* Lowercase-opener, cue-free, unpunctuated quotes score 0, so cross-stance
 order is the deterministic round-robin (no scoring noise) unless a test
 deliberately injects a topic keyword / eval cue / fragment to exercise the
 ranking. */
  const q = (quote: string, stance: string) => ({ quote, stance });

  it("returns an empty array when there are no candidates", () => {
    expect(selectReportQuotes([], { limit: 5 })).toEqual([]);
  });

  it("returns an empty array when the limit is zero", () => {
    expect(
      selectReportQuotes([q("sup one", "supportive")], { limit: 0 }),
    ).toEqual([]);
  });

  it("leads with the named dominant stance, not the most-common one", () => {
    const candidates = [
      q("sup one", "supportive"),
      q("sup two", "supportive"),
      q("sup three", "supportive"),
      q("mix one", "mixed"),
    ];
    /* Mixed is the dominant stance the headline asserts, though supportive is more numerous. */
    const picked = selectReportQuotes(candidates, {
      limit: 4,
      dominantStance: "mixed",
    });
    expect(picked[0].quote).toBe("mix one");
    expect(picked.map((p) => p.quote)).toEqual([
      "mix one",
      "sup one",
      "sup two",
      "sup three",
    ]);
  });

  it("round-robins across stances so the opposed/mixed minority surfaces", () => {
    const candidates = [
      q("sup one", "supportive"),
      q("sup two", "supportive"),
      q("sup three", "supportive"),
      q("opp one", "opposed"),
      q("mix one", "mixed"),
    ];
    /* No dominant passed → most-common (supportive) leads; minority still surfaces. */
    expect(
      selectReportQuotes(candidates, { limit: 3 }).map((p) => p.quote),
    ).toEqual(["sup one", "opp one", "mix one"]);
  });

  it("stops mid-cycle when the limit is smaller than the stance count", () => {
    const candidates = [
      q("sup one", "supportive"),
      q("opp one", "opposed"),
      q("mix one", "mixed"),
    ];
    expect(
      selectReportQuotes(candidates, { limit: 2 }).map((p) => p.quote),
    ).toEqual(["sup one", "opp one"]);
  });

  it("drains uneven groups without stalling and stops when all are exhausted", () => {
    const candidates = [
      q("sup one", "supportive"),
      q("sup two", "supportive"),
      q("sup three", "supportive"),
      q("opp one", "opposed"),
    ];
    expect(
      selectReportQuotes(candidates, { limit: 10 }).map((p) => p.quote),
    ).toEqual(["sup one", "opp one", "sup two", "sup three"]);
  });

  it("de-dupes by normalized quote text and skips blank quotes", () => {
    const candidates = [
      q("same quote", "supportive"),
      q(" SAME QUOTE ", "opposed") /* duplicate after normalize → dropped */,
      q(" ", "mixed") /* blank → skipped */,
      q("a distinct line", "opposed"),
    ];
    expect(
      selectReportQuotes(candidates, { limit: 5 }).map((p) => p.quote),
    ).toEqual(["same quote", "a distinct line"]);
  });

  it("ranks an on-topic quote above an off-topic one within a stance", () => {
    const candidates = [
      q("nothing relevant said today", "supportive"),
      q("bitcoin is the interesting part here", "supportive"),
    ];
    expect(
      selectReportQuotes(candidates, {
        limit: 1,
        topicKeywords: ["bitcoin"],
      })[0].quote,
    ).toBe("bitcoin is the interesting part here");
  });

  it("ranks an opinion-bearing quote above a flat one, and a clean opener above a fragment", () => {
    const candidates = [
      q(
        "Xrt broken opener floating here",
        "supportive",
      ) /* fragment opener → penalized */,
      q("plain statement of record", "supportive") /* neutral */,
      q("i think this is the move", "supportive") /* eval cue → boosted */,
      q(
        "This lands cleanly.",
        "supportive",
      ) /* terminal punctuation → small boost */,
    ];
    expect(
      selectReportQuotes(candidates, { limit: 4 }).map((p) => p.quote),
    ).toEqual([
      "i think this is the move",
      "This lands cleanly.",
      "plain statement of record",
      "Xrt broken opener floating here",
    ]);
  });
});
