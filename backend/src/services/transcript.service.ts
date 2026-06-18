/**
 * Transcript text utilities used by the import + manual-paste flows.
 *
 * Cleaning is intentionally conservative — we preserve line breaks (which
 * become chunk boundaries downstream) while normalising whitespace inside
 * lines and collapsing runs of blank lines. Original `rawText` is always
 * kept untouched on the Transcript record alongside `cleanedText` so the
 * UI can show the source verbatim if needed.
 */

/** Non-breaking space (U+00A0) — appears in YouTube auto-transcripts. */
const NBSP = " ";

/**
 * Zero-width / formatting characters that carry no visible content but corrupt
 * downstream processing: a BOM (U+FEFF) at the start of a fetched file, and
 * zero-width space/non-joiner/joiner (U+200B–U+200D) that YouTube auto-captions
 * and some copy-paste sources inject. Left in, they (a) split or pad "words" so
 * `countWords` and chunk boundaries drift, (b) defeat `evidenceQuote` exact-
 * substring matching (a quote with an invisible char won't match the rendered
 * text), and (c) are a known prompt-injection / homoglyph smuggling vector.
 * We strip them outright (vs. the NFKC step below, which canonicalizes visible
 * compatibility characters rather than deleting them).
 */
const ZERO_WIDTH_AND_BOM = /[\uFEFF\u200B\u200C\u200D]/g;

/**
 * Normalise whitespace + Unicode in a transcript while preserving paragraph
 * breaks.
 *
 * Steps:
 * 1. Apply Unicode NFKC normalization, folding compatibility forms (ligatures,
 * full-width ABC, circled digits, etc.) to their canonical equivalents so
 * the same word always hashes/matches the same way. NFKC (compatibility
 * composition) is the right form for text we tokenize and exact-substring-
 * match against, since it removes invisible-distinction duplicates rather
 * than preserving them (NFC) — important for cache keys, word counts, and
 * `evidenceQuote` matching.
 * 2. Strip BOM + zero-width characters (see ZERO_WIDTH_AND_BOM).
 * 3. Convert Windows line endings (CRLF) to LF.
 * 4. Replace non-breaking spaces with regular spaces.
 * 5. Trim trailing spaces from each line.
 * 6. Collapse 3+ consecutive newlines down to a single blank line.
 * 7. Collapse runs of horizontal whitespace inside a line.
 *
 * @param raw - the raw transcript text as fetched or pasted
 * @returns the cleaned transcript text suitable for chunking
 */
export function cleanTranscriptText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(ZERO_WIDTH_AND_BOM, "")
    .replace(/\r\n/g, "\n")
    .replace(new RegExp(NBSP, "g"), " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Count whitespace-separated tokens in a string. A reasonable proxy for
 * "words" that doesn't try to be too clever about punctuation.
 *
 * @param text - input string
 * @returns number of tokens; 0 for empty / falsy input
 */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}
