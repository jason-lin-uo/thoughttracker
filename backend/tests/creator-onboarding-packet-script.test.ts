import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../scripts/build-creator-onboarding-packet";

describe("build-creator-onboarding-packet parseArgs", () => {
  it("parses creator slugs and defaults", () => {
    const options = parseArgs(["--creator-slugs", "mkbhd, huberman, mkbhd"]);

    expect(options.creatorSlugs).toEqual(["mkbhd", "huberman"]);
    expect(options.maxRows).toBe(500);
    expect(options.maxConfidence).toBe(0.72);
    expect(options.minRelevance).toBe(0.35);
    expect(options.outDir).toContain(
      path.join("tmp", "creator-onboarding-packet"),
    );
  });

  it("accepts inline args and numeric overrides", () => {
    const options = parseArgs([
      "--creator-slugs=creator-a,creator-b",
      "--out-dir",
      "tmp/custom-packet",
      "--max-rows",
      "25",
      "--max-confidence=0.5",
      "--min-relevance=0.2",
    ]);

    expect(options.creatorSlugs).toEqual(["creator-a", "creator-b"]);
    expect(options.outDir).toBe(path.resolve("tmp/custom-packet"));
    expect(options.maxRows).toBe(25);
    expect(options.maxConfidence).toBe(0.5);
    expect(options.minRelevance).toBe(0.2);
  });

  it("rejects missing slugs and invalid scores", () => {
    expect(() => parseArgs([])).toThrow("--creator-slugs is required");
    expect(() =>
      parseArgs(["--creator-slugs", "x", "--max-rows", "0"]),
    ).toThrow("--max-rows must be a positive integer");
    expect(() =>
      parseArgs(["--creator-slugs", "x", "--max-confidence", "1.5"]),
    ).toThrow("--max-confidence must be a number from 0 to 1");
    expect(() =>
      parseArgs(["--creator-slugs", "x", "--min-relevance", "-0.1"]),
    ).toThrow("--min-relevance must be a number from 0 to 1");
  });
});
