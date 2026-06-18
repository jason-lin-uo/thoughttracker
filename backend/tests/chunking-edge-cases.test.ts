/**
 * Extra chunking.service tests aimed at the segment-driven code path
 * (chunkFromSegments) and the multi-chunk overlap behavior, which the
 * existing services.test.ts only partially exercises.
 */

import { describe, it, expect } from "vitest";
import { chunkTranscript } from "../src/services/chunking.service";

describe("chunkTranscript — segment-driven path", () => {
  it("returns a single chunk when total words < TARGET_WORDS", () => {
    const segments = [
      { start: 0, end: 10, text: "short segment text" },
      { start: 10, end: 20, text: "another short segment" },
    ];
    const chunks = chunkTranscript({ text: "ignored", segments });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startSeconds).toBe(0);
    expect(chunks[0].endSeconds).toBe(20);
    expect(chunks[0].text).toContain("short segment");
  });

  it("emits multiple chunks with overlap when segments exceed TARGET_WORDS", () => {
    /* Generate ~2500 words across segments (each ~50 words, 50 segs). */
    const segments = Array.from({ length: 50 }, (_, i) => ({
      start: i * 20,
      end: i * 20 + 20,
      text: ("word " + i + " ").repeat(50),
    }));
    const chunks = chunkTranscript({ text: "ignored", segments });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    /* Every chunk carries a non-null startSeconds + endSeconds. */
    for (const c of chunks) {
      expect(c.startSeconds).not.toBeNull();
      expect(c.endSeconds).not.toBeNull();
      expect(c.endSeconds).toBeGreaterThanOrEqual(c.startSeconds!);
    }
    /*
     * The second chunk should start before the first chunk ended
     * because of the overlap region — proves overlap math runs.
     */
    expect(chunks[1].startSeconds).toBeLessThan(chunks[0].endSeconds!);
  });

  it("handles a single very long segment without crashing", () => {
    /* Build a 1500-word string to stress the chunker with one oversized segment. */
    const huge = Array.from({ length: 1500 }, (_, i) => `w${i}`).join(" ");
    const segments = [{ start: 0, end: 600, text: huge }];
    const chunks = chunkTranscript({ text: "ignored", segments });
    /* At least one chunk produced; details vary by chunker. */
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].startSeconds).toBe(0);
  });

  it("handles an empty segments array by falling back to text path", () => {
    const chunks = chunkTranscript({ text: "hello world", segments: [] });
    expect(chunks.length).toBe(1);
    expect(chunks[0].startSeconds).toBeNull();
    expect(chunks[0].endSeconds).toBeNull();
  });
});

describe("chunkTranscript — text path overlap math", () => {
  it("subsequent chunks overlap with the previous chunk", () => {
    /* Build a 2500-word string large enough to force multiple overlapping chunks. */
    const words = Array.from({ length: 2500 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkTranscript({ text: words });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    /*
     * The first word of chunk[1] should be one of the last 200 words
     * of chunk[0] (proves overlap is happening, exact size flexible).
     */
    const chunk0Tail = chunks[0].text.split(/\s+/).slice(-200);
    const chunk1First = chunks[1].text.split(/\s+/)[0];
    expect(chunk0Tail).toContain(chunk1First);
  });
});
