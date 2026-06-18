/**
 * reportText — normalize and SELECT transcript-derived evidence quotes for
 * reports.
 *
 * Evidence quotes are sliced out of auto-generated captions, so raw values are
 * messy: caption markers (">>", "[Music]", leading "- " speaker dashes), HTML
 * entities, stray quote characters, ASR stutter/garble ("gr gr gr"), mid-word
 * START fragments (a window sliced mid-utterance, e.g. "Alked about it"), and
 * mid-word END stubs ("...building out its own AI c"). Dumping those verbatim
 * made reports look broken.
 *
 * Two responsibilities live here:
 * - CLEAN a single quote for display (cleanReportQuote) and decide whether it
 * is presentable at all (isUsableQuote — HARD rejects only: unambiguous junk).
 * - SELECT a small, balanced, on-topic set from a large candidate pool
 * (selectReportQuotes) — soft-ranked by quality (topic relevance, an
 * evaluative/stance cue, completeness) and stratified so the report LEADS
 * with the dominant stance and still surfaces the dissenting minority.
 *
 * The functions are pure/deterministic so they're testable and reused by the
 * report-writing pipeline.
 */

/** Common HTML entities that leak into caption text, mapped to their chars. */
const HTML_ENTITIES: Record<string, string> = {
  "&gt;": ">",
  "&lt;": "<",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Frequent sentence-LEADING words. Used only as a soft signal: a quote that
 * opens with a capitalized token that is neither one of these nor a plausible
 * proper noun is likely a mid-word slice ("Alked about it") and is down-ranked
 * (not hard-rejected, so we never lose a good quote that merely opens with an
 * uncommon real word).
 */
const COMMON_LEADING_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "but",
  "so",
  "or",
  "because",
  "if",
  "when",
  "while",
  "as",
  "i",
  "we",
  "you",
  "he",
  "she",
  "they",
  "it",
  "this",
  "that",
  "these",
  "those",
  "there",
  "here",
  "what",
  "why",
  "how",
  "who",
  "which",
  "where",
  "my",
  "our",
  "your",
  "his",
  "her",
  "their",
  "its",
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
  "may",
  "might",
  "must",
  "now",
  "then",
  "also",
  "however",
  "although",
  "though",
  "yes",
  "no",
  "not",
  "in",
  "on",
  "at",
  "to",
  "of",
  "for",
  "with",
  "from",
  "by",
  "about",
  "into",
  "over",
  "after",
  "before",
  "honestly",
  "look",
  "okay",
  "ok",
  "well",
  "actually",
  "really",
  "maybe",
  "let",
  "let's",
  "lets",
  "every",
  "each",
  "all",
  "some",
  "most",
  "more",
  "one",
  "two",
  "first",
  "second",
  "another",
  "people",
  "even",
  "just",
  "still",
  "again",
  "yeah",
  "right",
  "obviously",
  "basically",
  "think",
  "thinking",
  "remember",
  "welcome",
  "today",
]);

/** Tiny words that are legitimately ≤2 chars (so we don't trim them as stubs). */
const SHORT_REAL_WORDS = new Set([
  "a",
  "i",
  "is",
  "it",
  "to",
  "of",
  "in",
  "on",
  "so",
  "no",
  "we",
  "he",
  "ok",
  "oh",
  "up",
  "by",
  "my",
  "an",
  "as",
  "at",
  "be",
  "do",
  "go",
  "me",
  "us",
  "if",
  "or",
]);

/**
 * Evaluative / stance-bearing cues. A quote that contains one of these is
 * stating an opinion or recommendation (the substance a report wants), vs. a
 * bare topic mention or a rhetorical question. Used as a positive ranking
 * signal in selection.
 */
const EVALUATIVE_CUES = [
  "i think",
  "i believe",
  "i feel",
  "i'd say",
  "id say",
  "i would say",
  "in my opinion",
  "honestly",
  "the best",
  "the worst",
  "best",
  "worst",
  "great",
  "amazing",
  "incredible",
  "impressive",
  "terrible",
  "awful",
  "disappointing",
  "love",
  "hate",
  "i like",
  "i love",
  "favorite",
  "should",
  "shouldn't",
  "we need",
  "we have to",
  "recommend",
  "worth it",
  "not worth",
  "the problem",
  "the issue",
  "the thing is",
  "i agree",
  "i disagree",
  "in favor",
  "against",
  "concerns me",
  "i worry",
  "harmful",
  "ridiculous",
  "fantastic",
  "compromise",
  "downside",
  "upside",
  "the point is",
  "but",
  "however",
  "the reality",
  "i'm not",
  "im not",
  "it's not",
  "its not",
  "actually",
  "genuinely",
  "really good",
  "really bad",
  "pretty good",
  "kind of",
  "the truth is",
  "for most people",
];

/**
 * Clean a raw evidence quote for display: decode HTML entities, strip caption
 * markers ("[Music]", ">>", leading "- " speaker dashes) and stray quote
 * characters, collapse whitespace, trim a dangling partial word off the END,
 * and capitalize the first letter (chunk extracts usually start mid-sentence).
 * Returns "" when the input is empty/whitespace.
 */
export function cleanReportQuote(raw: string): string {
  if (!raw) return "";
  let s = raw.normalize("NFKC");
  s = s.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? " ");
  /* Strip caption artifacts anywhere: bracketed cues ([Music], [Applause]) and
 ">>"/">>>" speaker-change markers. */
  s = s.replace(/\[[^\]]*\]/g, " ").replace(/>{2,}/g, " ");
  /* Strip leading caption junk: whitespace, '>' markers, dots/ellipses, a
 leading speaker dash ("- "), and stray straight/curly opening quotes. */
  s = s.replace(/^[\s>.…"“”'-]+/, "");
  /* Strip trailing whitespace, ellipses, and stray closing quotes. */
  s = s.replace(/\s*(?:\.{2,}|…)\s*$/, "").replace(/[\s…"“”]+$/, "");
  s = s.replace(/\s+/g, " ").trim();
  /* Drop a dangling partial word at the END (e.g. "...own AI c" / "deep s") when
 the quote doesn't already close on terminal punctuation. */
  if (s && !/[.!?]$/.test(s)) {
    const tokens = s.split(" ");
    let trimmedTail = false;
    while (tokens.length > 1) {
      const last = tokens[tokens.length - 1]
        .replace(/[^A-Za-z']/g, "")
        .toLowerCase();
      if (last.length <= 2 && !SHORT_REAL_WORDS.has(last)) {
        tokens.pop();
        trimmedTail = true;
      } else break;
    }
    s = tokens.join(" ");
    /* Only flag truncation when we actually dropped a dangling partial word; a
 complete (if unpunctuated) line is left untouched. */
    if (trimmedTail && s && !/[.!?]$/.test(s)) s = `${s}…`;
  }
  if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

/** Words in a cleaned quote (letters/apostrophes), lowercased. */
function wordsOf(cleaned: string): string[] {
  return cleaned
    .toLowerCase()
    .replace(/[^a-z'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Whether a token looks like ASR garble: no vowel and 3+ letters (e.g. "chth", "grpc"). */
function isGarbleToken(tok: string): boolean {
  return tok.length >= 3 && !/[aeiouy]/.test(tok);
}

/**
 * Whether a cleaned quote is presentable at all. HARD rejects only — the
 * unambiguous junk that should never reach a reader regardless of context:
 * - too few words (default 6-word floor),
 * - a bare rhetorical question with no evaluative content,
 * - ASR stutter (a short token repeated 3+ times in a row, "gr gr gr"),
 * - a high ratio of garble/non-word tokens,
 * - a residual caption artifact.
 * Quality/relevance ranking (mid-word starts, topicality, stance) is handled
 * softly in selectReportQuotes so a good pool is never over-pruned.
 */
export function isUsableQuote(cleaned: string, minWords = 6): boolean {
  const words = wordsOf(cleaned);
  if (words.length < minWords) return false;
  if (/[>]{2,}/.test(cleaned)) return false;
  /* Bare question with no opinion (e.g. "Am I having a blood sugar crash?"). */
  if (
    /\?$/.test(cleaned.trim()) &&
    !EVALUATIVE_CUES.some((c) => cleaned.toLowerCase().includes(c))
  ) {
    return false;
  }
  /* Consecutive repeated short token ("gr gr gr", "bitcoin bitcoin bitcoin"). */
  for (let i = 2; i < words.length; i += 1) {
    if (words[i] === words[i - 1] && words[i - 1] === words[i - 2])
      return false;
  }
  /* Too much garble overall. */
  const garble = words.filter(isGarbleToken).length;
  if (garble / words.length > 0.2) return false;
  return true;
}

/** A scored, stance-tagged candidate quote. */
type QuoteLike = { quote: string; stance: string };

/**
 * Quality score for ranking (higher is better). Rewards a quote that is on
 * topic, states an opinion, opens cleanly (real leading word), and ends on a
 * full sentence. Penalizes a likely mid-word opening fragment.
 */
function scoreQuote(quote: string, topicKeywords: string[]): number {
  const lower = quote.toLowerCase();
  let score = 0;
  if (topicKeywords.some((k) => k && lower.includes(k))) score += 3;
  if (EVALUATIVE_CUES.some((c) => lower.includes(c))) score += 2;
  if (/[.!?]$/.test(quote.trim())) score += 1;
  const first = quote.split(" ")[0]?.replace(/[^A-Za-z']/g, "") ?? "";
  /* A capitalized opener that isn't a known leading word and is short is most
 likely a sliced word-fragment ("Alked", "Ategory") — down-rank it. */
  const looksFragment =
    first.length > 0 &&
    first.length <= 8 &&
    !COMMON_LEADING_WORDS.has(first.toLowerCase()) &&
    first[0] === first[0].toUpperCase();
  if (looksFragment) score -= 2;
  return score;
}

/**
 * selectReportQuotes — choose a balanced, on-topic, presentable subset from a
 * confidence-ordered candidate pool.
 *
 * Fixes the two structural defects the old confidence-slice had: (1) it skewed
 * entirely to the dominant stance, and (2) downstream display hard-coded a
 * supportive-first ladder, so mixed/opposed-dominant topics led with a minority
 * quote and the opposed view was excluded. This:
 * 1. de-dupes by normalized text,
 * 2. ranks each stance's candidates by quality score (topic relevance +
 * evaluative cue + completeness − fragment penalty), confidence breaking ties,
 * 3. LEADS with the dominant stance, then round-robins the remaining stances so
 * every present stance (including opposed/neutral) is represented before any
 * stance repeats — surfacing real dissent.
 *
 * `dominantStance` names the stance the report's headline asserts (so the lead
 * quote matches it); when omitted it defaults to the most-common stance in the
 * pool. `topicKeywords` drives the relevance signal.
 */
export function selectReportQuotes<T extends QuoteLike>(
  candidates: T[],
  opts: { limit: number; dominantStance?: string; topicKeywords?: string[] },
): T[] {
  const { limit } = opts;
  const topicKeywords = (opts.topicKeywords ?? []).map((k) => k.toLowerCase());

  /* De-dupe by normalized quote, preserving the first (highest-confidence) hit. */
  const seen = new Set<string>();
  const byStance = new Map<string, Array<{ item: T; score: number }>>();
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const key = c.quote.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    counts.set(c.stance, (counts.get(c.stance) ?? 0) + 1);
    const scored = { item: c, score: scoreQuote(c.quote, topicKeywords) };
    const group = byStance.get(c.stance);
    if (group) group.push(scored);
    else byStance.set(c.stance, [scored]);
  }
  /* Rank within each stance by score, keeping the incoming (confidence) order as
 the stable tie-breaker. */
  for (const group of byStance.values()) {
    group.sort((a, b) => b.score - a.score);
  }

  /* Visit the dominant stance first, then the rest by descending pool share. */
  const dominant =
    opts.dominantStance && byStance.has(opts.dominantStance)
      ? opts.dominantStance
      : [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const order = [...byStance.keys()].sort((a, b) => {
    if (a === dominant) return -1;
    if (b === dominant) return 1;
    return (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
  });

  const selected: T[] = [];
  let progressed = true;
  while (selected.length < limit && progressed) {
    progressed = false;
    for (const stance of order) {
      if (selected.length >= limit) break;
      const next = byStance.get(stance)?.shift();
      if (next) {
        selected.push(next.item);
        progressed = true;
      }
    }
  }
  return selected;
}
