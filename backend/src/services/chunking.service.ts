export interface ChunkInput {
  text: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface BuiltChunk {
  chunkIndex: number;
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
  tokenCount: number;
}

const TARGET_WORDS = 1000;
const OVERLAP_WORDS = 120;

/**
 * chunkTranscript — splits a transcript into ~1000-word chunks for
 * embedding and per-chunk analysis.
 *
 * If `segments` are provided (timestamped lines from YouTube's
 * auto-captions), chunks honor segment boundaries so a chunk never
 * splits mid-sentence. Each output chunk carries `startSeconds` and
 * `endSeconds` from the underlying segments. Without segments, we
 * chunk by whitespace counts only and timestamps are null.
 *
 * Why ~1000 words: small enough that a single LLM call can summarize
 * a chunk in <1s, big enough that stance signals (which often span a
 * paragraph or two) survive the split.
 */
export function chunkTranscript(input: ChunkInput): BuiltChunk[] {
  const { segments } = input;
  if (segments && segments.length > 0) return chunkFromSegments(segments);
  return chunkFromText(input.text);
}

/**
 * Chunk plain text (no timestamps) into ~TARGET_WORDS-word windows with a
 * fixed OVERLAP_WORDS overlap between consecutive chunks.
 *
 * The overlap (start = end - OVERLAP_WORDS) ensures stance/topic signals
 * that straddle a boundary appear in both neighbouring chunks. Timestamps
 * are null since there are no segments to derive them from; empty input
 * yields no chunks.
 */
function chunkFromText(text: string): BuiltChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: BuiltChunk[] = [];
  let start = 0;
  let idx = 0;
  while (start < words.length) {
    const end = Math.min(words.length, start + TARGET_WORDS);
    const slice = words.slice(start, end).join(" ");
    chunks.push({
      chunkIndex: idx,
      text: slice,
      startSeconds: null,
      endSeconds: null,
      tokenCount: estimateTokenCount(slice),
    });
    if (end >= words.length) break;
    start = end - OVERLAP_WORDS;
    idx += 1;
  }
  return chunks;
}

/**
 * Chunk timestamped caption segments into ~TARGET_WORDS-word chunks that
 * respect segment boundaries, so a chunk never splits mid-segment.
 *
 * Accumulates whole segments until the word target is hit, then flushes a
 * chunk carrying the real start/end seconds of its span. An OVERLAP_WORDS
 * tail is carried into the next chunk (with its start time estimated back
 * from the segment end via estimateSecondsFromWordCount) to preserve
 * boundary-straddling signals. A trailing partial chunk is flushed at the end.
 */
function chunkFromSegments(
  segments: Array<{ start: number; end: number; text: string }>,
): BuiltChunk[] {
  const chunks: BuiltChunk[] = [];
  let currentWords: string[] = [];
  let currentStart = segments[0]?.start ?? 0;
  let currentEnd = segments[0]?.end ?? 0;
  let idx = 0;
  let overlapTailWords: string[] = [];
  let overlapTailStart: number | null = null;

  for (const segment of segments) {
    const segmentWords = segment.text.split(/\s+/).filter(Boolean);
    if (currentWords.length === 0) {
      currentStart = segment.start;
      currentWords = [...overlapTailWords, ...segmentWords];
      if (overlapTailStart !== null) currentStart = overlapTailStart;
      overlapTailWords = [];
      overlapTailStart = null;
    } else {
      currentWords.push(...segmentWords);
    }
    currentEnd = segment.end;

    if (currentWords.length >= TARGET_WORDS) {
      /*
       * A single huge segment (or accumulation) can blow well past
       * TARGET_WORDS. Emit one chunk per TARGET_WORDS window on word
       * boundaries so we never persist a 5k-word chunk, distributing the
       * [currentStart, currentEnd] span proportionally across the splits.
       */
      const spanStart = currentStart;
      const spanEnd = currentEnd;
      const spanWords = currentWords.length;
      let offset = 0;
      let lastSliceWords: string[] = [];
      while (currentWords.length - offset >= TARGET_WORDS) {
        const sliceWords = currentWords.slice(offset, offset + TARGET_WORDS);
        lastSliceWords = sliceWords;
        const text = sliceWords.join(" ");
        const sliceStart =
          spanStart + ((spanEnd - spanStart) * offset) / Math.max(1, spanWords);
        const sliceEnd =
          spanStart +
          ((spanEnd - spanStart) * (offset + TARGET_WORDS)) /
            Math.max(1, spanWords);
        chunks.push({
          chunkIndex: idx,
          text,
          startSeconds: sliceStart,
          endSeconds: Math.min(spanEnd, sliceEnd),
          tokenCount: estimateTokenCount(text),
        });
        idx += 1;
        offset += TARGET_WORDS;
      }
      const remainder = currentWords.slice(offset);
      if (remainder.length > 0) {
        /*
         * The remainder keeps accumulating into the next chunk directly, so it
         * already carries continuity — no separate overlap tail needed. Its
         * start is the proportional position of the first remainder word within
         * the span (same mapping as the emitted slices) — NOT `spanEnd`, which
         * would stamp the next chunk with the END of this span and push its
         * "jump to timestamp" minutes late for a very large segment.
         */
        currentWords = remainder;
        currentStart =
          spanStart + ((spanEnd - spanStart) * offset) / Math.max(1, spanWords);
        overlapTailWords = [];
        overlapTailStart = null;
      } else {
        /*
         * Clean boundary: carry an overlap tail from the last emitted window
         * into the next chunk to preserve boundary-straddling signal.
         */
        currentWords = [];
        overlapTailWords = lastSliceWords.slice(-OVERLAP_WORDS);
        overlapTailStart =
          spanEnd - estimateSecondsFromWordCount(overlapTailWords.length);
      }
    }
  }

  if (currentWords.length > 0) {
    const text = currentWords.join(" ");
    chunks.push({
      chunkIndex: idx,
      text,
      startSeconds: currentStart,
      endSeconds: currentEnd,
      tokenCount: estimateTokenCount(text),
    });
  }

  return chunks;
}

/**
 * Estimate elapsed seconds for a number of spoken words, assuming
 * conversational speech of ~150 wpm (2.5 words/sec). Used to back-date the
 * start time of an overlap tail when chunking segments.
 */
function estimateSecondsFromWordCount(wordCount: number): number {
  /* Conversational speech ~150 wpm = 2.5 wps. */
  return wordCount / 2.5;
}

/** Rough token estimate: ~4 chars per token of English. Used to record per-chunk tokenCount. */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
