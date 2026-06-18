import type { LlmRequest, LlmResult } from "../../src/ai/llmClient";
import { sha256 } from "../../src/utils/hashing";

const PROVIDER = "mock";
const MODEL = "mock-llm-v1";

/**
 * Deterministic mock LLM. Same input → same output. Uses sha256 hashes of the
 * input as the random seed so the demo is stable across runs.
 */
export function runMockLlm(req: LlmRequest): Promise<LlmResult> {
 const seed = sha256(`${req.task}::${req.userPrompt}`);
 let json: unknown;

 switch (req.task) {
 case "topic_detection":
 json = mockTopicDetection(req, seed);
 break;
 case "stance_classification":
 json = mockStanceClassification(req, seed);
 break;
 case "video_topic_summary":
 json = mockVideoTopicSummary(req, seed);
 break;
 case "creator_timeline":
 json = mockCreatorTimeline(req, seed);
 break;
 case "creator_report":
 json = mockCreatorReport(req, seed);
 break;
 case "topic_report":
 json = mockTopicReport(req, seed);
 break;
 default:
 json = {};
 }

 return Promise.resolve({
 rawText: JSON.stringify(json),
 json,
 provider: PROVIDER,
 modelName: MODEL,
 });
}

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

/**
 * Deterministic integer in [0, mod) derived from `seed + salt`.
 *
 * Hashes the salted seed and reduces the first 32 bits modulo `mod`; the
 * `Math.max(1, mod)` guard avoids a divide-by-zero when callers pass an
 * empty collection length.
 */
function seededIndex(seed: string, salt: string, mod: number): number {
 const h = sha256(seed + salt);
 return parseInt(h.slice(0, 8), 16) % Math.max(1, mod);
}

/**
 * Deterministic float in [0, 1) derived from `seed + salt`. Used wherever
 * the mock wants stable jitter (e.g. confidence noise) without a real RNG.
 */
function seededFloat(seed: string, salt: string): number {
 const h = sha256(seed + salt);
 return (parseInt(h.slice(0, 8), 16) % 10_000) / 10_000;
}

/** Deterministically pick one element of `arr` using the seeded index. */
function seededPick<T>(arr: T[], seed: string, salt: string): T {
 return arr[seededIndex(seed, salt, arr.length)];
}

const STANCE_VALUES = [
 "supportive",
 "opposed",
 "neutral",
 "mixed",
 "unclear",
 "insufficient_evidence",
] as const;

const CONFIDENCE_VALUES = ["low", "medium", "high"] as const;

const TREND_VALUES = ["stable", "gradual_shift", "abrupt_shift", "mixed", "insufficient_data"] as const;

/*
 * ---------------------------------------------------------------------------
 * Topic detection
 * ---------------------------------------------------------------------------
 */

function mockTopicDetection(req: LlmRequest, seed: string): unknown {
 /*
 * taskInput.taxonomy mirrors what the prompt sends. The real topic-detection
 * path now passes the full taxonomy ENTRY objects ({ name, slug, ... }); older
 * callers passed plain name strings. Normalize both to a name string so the
 * keyword-match below works regardless of which shape arrives.
 */
 const rawTaxonomy = (req.taskInput?.taxonomy as Array<string | { name?: string }> | undefined) ?? [];
 const taxonomy = rawTaxonomy
 .map((t) => (typeof t === "string" ? t : t?.name ?? ""))
 .filter((name): name is string => name.length > 0);
 const transcript = (req.taskInput?.transcript as string | undefined) ?? "";

 const hits: Array<{ name: string; slug: string; relevance: number; mentions: number }> = [];
 const lower = transcript.toLowerCase();
 for (const t of taxonomy) {
 const tl = t.toLowerCase();
 let mentions = 0;
 let from = 0;
 while (true) {
 const idx = lower.indexOf(tl, from);
 if (idx < 0) break;
 mentions += 1;
 from = idx + tl.length;
 }
 if (mentions > 0) {
 hits.push({
 name: t,
 slug: t.toLowerCase().replace(/\s+/g, "-"),
 relevance: Math.min(1, mentions / 5),
 mentions,
 });
 }
 }

 if (hits.length === 0) {
 const fallback = taxonomy.slice(0, 4);
 fallback.forEach((t, i) => {
 hits.push({
 name: t,
 slug: t.toLowerCase().replace(/\s+/g, "-"),
 relevance: 0.4 + seededFloat(seed, `t${i}`) * 0.4,
 mentions: 1 + seededIndex(seed, `m${i}`, 4),
 });
 });
 }

 hits.sort((a, b) => b.relevance - a.relevance);

 return {
 topics: hits.slice(0, 6).map((h) => ({
 name: h.name,
 slug: h.slug,
 description: `Recurring discussion of ${h.name.toLowerCase()} in the transcript.`,
 mentionCount: h.mentions,
 relevanceScore: Math.round(h.relevance * 100) / 100,
 })),
 };
}

/*
 * ---------------------------------------------------------------------------
 * Stance classification
 * ---------------------------------------------------------------------------
 */

const SUPPORTIVE_CUES = [
 "we should",
 "we need to",
 "this is a great",
 "i support",
 "i agree",
 "the right thing",
 "we have to",
 "i believe",
 "in favor",
 "embrace",
 "promote",
 "encourage",
];

const OPPOSED_CUES = [
 "i disagree",
 "this is wrong",
 "we shouldn't",
 "we shouldn't be",
 "i don't support",
 "i am against",
 "we need to stop",
 "concerns me",
 "i worry",
 "this is bad",
 "the problem with",
 "harmful",
];

const NEUTRAL_CUES = ["on one hand", "some say", "research shows", "according to", "the data"];

const MIXED_CUES = ["on the other hand", "however", "but also", "at the same time"];

/**
 * Heuristic stance detector for the mock LLM: count supportive / opposed /
 * neutral / mixed cue phrases in the chunk and derive a stance + scores.
 *
 * With no cue hits it returns "neutral" or "insufficient_evidence" (seeded
 * coin-flip) at low relevance. Otherwise "mixed" wins when a mixed cue
 * co-occurs with a directional one, else the highest directional count
 * wins (ties → neutral, then unclear). Confidence and relevance scale with
 * the strongest count / total hits, with a little seeded jitter so the
 * output looks model-like but stays deterministic.
 */
function detectStance(chunkText: string, seed: string): {
 stance: (typeof STANCE_VALUES)[number];
 confidence: number;
 relevance: number;
} {
 const lower = chunkText.toLowerCase();
 let supportive = 0;
 let opposed = 0;
 let neutral = 0;
 let mixed = 0;

 for (const cue of SUPPORTIVE_CUES) if (lower.includes(cue)) supportive += 1;
 for (const cue of OPPOSED_CUES) if (lower.includes(cue)) opposed += 1;
 for (const cue of NEUTRAL_CUES) if (lower.includes(cue)) neutral += 1;
 for (const cue of MIXED_CUES) if (lower.includes(cue)) mixed += 1;

 const total = supportive + opposed + neutral + mixed;
 if (total === 0) {
 const rel = seededFloat(seed, "rel-empty");
 return {
 stance: rel > 0.7 ? "neutral" : "insufficient_evidence",
 confidence: 0.2 + seededFloat(seed, "conf-empty") * 0.3,
 relevance: rel * 0.4,
 };
 }

 let stance: (typeof STANCE_VALUES)[number];
 if (mixed > 0 && (supportive > 0 || opposed > 0)) stance = "mixed";
 else if (supportive > opposed && supportive > neutral) stance = "supportive";
 else if (opposed > supportive && opposed > neutral) stance = "opposed";
 else if (neutral >= supportive && neutral >= opposed) stance = "neutral";
 else stance = "unclear";

 const max = Math.max(supportive, opposed, neutral, mixed);
 const confidence = Math.min(0.95, 0.4 + max * 0.15 + seededFloat(seed, "c-bias") * 0.1);
 const relevance = Math.min(1, 0.45 + total * 0.12 + seededFloat(seed, "r-bias") * 0.05);

 return { stance, confidence, relevance };
}

/** Bucket a numeric confidence score into the low / medium / high label (>=0.7 high, >=0.45 medium). */
function confidenceLabelFor(score: number): (typeof CONFIDENCE_VALUES)[number] {
 if (score >= 0.7) return "high";
 if (score >= 0.45) return "medium";
 return "low";
}

/**
 * Pick a plausible evidence quote from `text` for the mock output.
 *
 * Splits on sentence boundaries and keeps mid-length sentences (20–220
 * chars) so the quote isn't a fragment or a wall of text, then seed-selects
 * one deterministically. Falls back to the first 160 chars when no
 * sentence qualifies.
 */
function pickEvidenceQuote(text: string, seed: string): string {
 const sentences = text
 .replace(/\s+/g, " ")
 .split(/(?<=[.!?])\s+/)
 .filter((s) => s.length > 20 && s.length < 220);
 if (sentences.length === 0) return text.slice(0, 160);
 const sentence = sentences[seededIndex(seed, "evq", sentences.length)];
 return sentence ?? text.slice(0, 160);
}

/**
 * Mock implementation of the `stance_classification` task: run detectStance
 * on the chunk and shape the result into the schema the real LLM returns
 * (relevance, stance + confidence label, a templated claim summary and
 * rationale, and a representative evidence quote). The rationale explicitly
 * notes no private beliefs are inferred, matching the product's framing.
 */
function mockStanceClassification(req: LlmRequest, seed: string): unknown {
 const chunkText = (req.taskInput?.chunkText as string | undefined) ?? "";
 const topicName = (req.taskInput?.topicName as string | undefined) ?? "topic";
 const { stance, confidence, relevance } = detectStance(chunkText, seed);

 return {
 relevanceScore: Math.round(relevance * 100) / 100,
 stanceLabel: stance,
 confidenceScore: Math.round(confidence * 100) / 100,
 confidenceLabel: confidenceLabelFor(confidence),
 claimSummary: `Speaker references ${topicName.toLowerCase()} in this segment.`,
 rationale: `The chunk contains language patterns associated with a ${stance.replace(
 /_/g,
 " "
 )} stance toward ${topicName.toLowerCase()}. No private beliefs are inferred.`,
 evidenceQuote: pickEvidenceQuote(chunkText, seed),
 };
}

/*
 * ---------------------------------------------------------------------------
 * Video topic summary
 * ---------------------------------------------------------------------------
 */

function mockVideoTopicSummary(req: LlmRequest, _seed: string): unknown {
 const analyses =
 (req.taskInput?.chunkAnalyses as Array<{
 chunkIndex: number;
 relevanceScore: number;
 stanceLabel: string;
 confidenceScore: number;
 evidenceQuote: string;
 }>) ?? [];

 /* Keep only sufficiently on-topic chunks (>=0.4) before tallying stance. */
 const relevant = analyses.filter((a) => a.relevanceScore >= 0.4);
 const tally: Record<string, number> = {};
 let confSum = 0;
 for (const a of relevant) {
 tally[a.stanceLabel] = (tally[a.stanceLabel] ?? 0) + 1;
 confSum += a.confidenceScore;
 }

 let dominantStance: string = "insufficient_evidence";
 let max = 0;
 for (const [label, count] of Object.entries(tally)) {
 if (count > max) {
 max = count;
 dominantStance = label;
 }
 }

 /*
 * Promote to "mixed" when the runner-up stance is nearly as common as the
 * top one (within 1, and at least 2 occurrences) — i.e. no clear winner.
 */
 const sortedKeys = Object.keys(tally).sort((a, b) => (tally[b] ?? 0) - (tally[a] ?? 0));
 if (sortedKeys.length >= 2 && (tally[sortedKeys[1]] ?? 0) >= Math.max(2, max - 1)) {
 dominantStance = "mixed";
 }

 const confidence = relevant.length === 0 ? 0.2 : confSum / relevant.length;

 const topicName = (req.taskInput?.topicName as string | undefined) ?? "this topic";
 const summary =
 relevant.length === 0
 ? `Across imported transcripts, this video does not discuss ${topicName.toLowerCase()} in detail.`
 : `Across the chunks in this video, the expressed stance toward ${topicName.toLowerCase()} appears ${dominantStance.replace(
 /_/g,
 " "
 )}. The speaker references ${topicName.toLowerCase()} in roughly ${relevant.length} segment${
 relevant.length === 1 ? "" : "s"
 }.`;

 const notableEvidence = relevant
 .slice(0, 3)
 .map((a) => ({ chunkIndex: a.chunkIndex, quote: a.evidenceQuote }));

 return {
 dominantStance,
 confidenceScore: Math.round(confidence * 100) / 100,
 confidenceLabel: confidenceLabelFor(confidence),
 mentionCount: relevant.length,
 summary,
 notableEvidence,
 };
}

/*
 * ---------------------------------------------------------------------------
 * Creator timeline
 * ---------------------------------------------------------------------------
 */

function mockCreatorTimeline(req: LlmRequest, seed: string): unknown {
 const summaries =
 (req.taskInput?.summaries as Array<{
 videoId: string;
 publishedAt?: string;
 dominantStance: string;
 }>) ?? [];

 const creator = (req.taskInput?.creatorName as string | undefined) ?? "the creator";
 const topic = (req.taskInput?.topicName as string | undefined) ?? "this topic";

 if (summaries.length < 2) {
 return {
 trendLabel: "insufficient_data",
 summary: `Across imported transcripts there is not yet enough data to characterize a trend for ${creator} on ${topic.toLowerCase()}. Import or analyze additional videos to enable trend interpretation.`,
 evidence: summaries.slice(0, 3).map((s) => ({
 videoId: s.videoId,
 publishedAt: s.publishedAt,
 note: `Single data point with dominant stance ${s.dominantStance}.`,
 })),
 };
 }

 /*
 * Sort chronologically (missing publishedAt sorts oldest) so we can
 * compare the earlier half vs. the later half for a trend.
 */
 const ordered = [...summaries].sort((a, b) => {
 const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
 const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
 return da - db;
 });

 const firstHalf = ordered.slice(0, Math.floor(ordered.length / 2));
 const secondHalf = ordered.slice(Math.floor(ordered.length / 2));
 const firstTop = topStance(firstHalf);
 const secondTop = topStance(secondHalf);

 let trendLabel: (typeof TREND_VALUES)[number];
 if (firstTop === secondTop) trendLabel = "stable";
 else if ((firstTop === "supportive" && secondTop === "opposed") || (firstTop === "opposed" && secondTop === "supportive")) trendLabel = "abrupt_shift";
 else if (firstTop !== "insufficient_evidence" && secondTop !== "insufficient_evidence") trendLabel = "gradual_shift";
 else trendLabel = seededPick(["stable", "mixed"] as Array<(typeof TREND_VALUES)[number]>, seed, "trend-fallback");

 const summary = `Across imported transcripts, the expressed stance of ${creator} toward ${topic.toLowerCase()} appears to follow a ${trendLabel.replace(
 /_/g,
 " "
 )} pattern. Earlier videos lean ${firstTop.replace(/_/g, " ")} while more recent videos lean ${secondTop.replace(
 /_/g,
 " "
 )}. This interpretation is limited to the ${ordered.length} videos currently imported.`;

 return {
 trendLabel,
 summary,
 evidence: ordered.slice(0, 5).map((s) => ({
 videoId: s.videoId,
 publishedAt: s.publishedAt,
 note: `Dominant stance ${s.dominantStance}.`,
 })),
 };
}

/**
 * Return the most common `dominantStance` across a set of video summaries,
 * defaulting to "insufficient_evidence" when the set is empty. Used to
 * characterize each half of the timeline before labeling the trend.
 */
function topStance(items: Array<{ dominantStance: string }>): string {
 const tally: Record<string, number> = {};
 for (const i of items) tally[i.dominantStance] = (tally[i.dominantStance] ?? 0) + 1;
 let best = "insufficient_evidence";
 let max = 0;
 for (const [k, v] of Object.entries(tally))
 if (v > max) {
 max = v;
 best = k;
 }
 return best;
}

/*
 * ---------------------------------------------------------------------------
 * Creator report
 * ---------------------------------------------------------------------------
 */

/**
 * Standard ThoughtTracker data caveat appended to every report. Kept as one
 * constant so the wording can't drift between the creator + topic reports (and
 * so the "transcript data" assertion the controller tests rely on holds).
 */
const REPORT_CAVEAT =
 "This report is based only on the imported transcript data available in ThoughtTracker. It should be interpreted as an evidence-backed summary of transcript patterns, not a definitive judgment of the creator's beliefs.";

/** Stance labels that carry a real position (vs. "no signal"). */
const DEFINITE_STANCES = new Set(["supportive", "opposed", "neutral", "mixed"]);

/** Human-friendly stance phrasing for prose ("insufficient_evidence" → "insufficient evidence"). */
function humanStance(stance: string): string {
 return stance.replace(/_/g, " ");
}

/** `YYYY-MM` slice of an ISO date, or a stable placeholder when absent. */
function reportMonth(iso?: string): string {
 return iso && iso.length >= 7 ? iso.slice(0, 7) : "an undated point";
}

/**
 * Mock creator INSIGHT report — synthesis over the supplied per-topic trends,
 * not a re-listing of topics. Leads with the creator's most pronounced stance
 * movement (or steadiness) so the title reads as a finding, mirroring what the
 * upgraded creator-report prompt asks a real LLM to produce.
 */
function mockCreatorReport(req: LlmRequest, _seed: string): unknown {
 const creator = (req.taskInput?.creatorName as string | undefined) ?? "the creator";
 const topics =
 (req.taskInput?.topics as Array<{
 topicName: string;
 trendLabel: string;
 timelineSummary: string;
 videoCount: number;
 dominantStance?: string;
 opinionatedShare?: number;
 }>) ?? [];

 if (topics.length === 0) {
 return {
 title: `Limited transcript data for ${creator}`,
 summary: `Only a limited amount of imported transcript data is available for ${creator}, so a full picture of recurring themes and stance movement can't yet be drawn.`,
 caveats: REPORT_CAVEAT,
 sections: [
 {
 heading: "What the data can't show yet",
 body: "No topics with sufficient analyzed evidence are available for this creator. Import and analyze more videos to surface stance patterns.",
 },
 {
 heading: "Limitations",
 body: "Findings are limited to videos imported into ThoughtTracker, and stance is inferred from transcript text only — not audio tone or prosody.",
 },
 ],
 evidence: [],
 };
 }

 const enriched = topics
 .slice()
 .sort((a, b) => b.videoCount - a.videoCount)
 .map((t) => ({
 ...t,
 stance: t.dominantStance ?? "insufficient_evidence",
 share: t.opinionatedShare ?? 0,
 }));

 const shifting = enriched.filter(
 (t) => t.trendLabel === "gradual_shift" || t.trendLabel === "abrupt_shift"
 );
 /* Topics with a real, dominant supportive/opposed lean — where they're outspoken. */
 const opinionated = enriched
 .filter((t) => t.share >= 0.5 && (t.stance === "supportive" || t.stance === "opposed"))
 .sort((a, b) => b.share - a.share || b.videoCount - a.videoCount);
 /* Topics they stay neutral/guarded on — honest negative space. */
 const neutral = enriched.filter((t) => t.share < 0.25);
 const supportiveTopics = opinionated.filter((t) => t.stance === "supportive");
 const opposedTopics = opinionated.filter((t) => t.stance === "opposed");
 const topThemes = enriched.slice(0, 5).map((t) => t.topicName).join(", ");

 let title: string;
 if (shifting.length) {
 title = `${creator}'s sharpest move is on ${shifting[0].topicName}`;
 } else if (opinionated.length) {
 title = `${creator} is most outspoken — ${humanStance(opinionated[0].stance)} — on ${opinionated[0].topicName}`;
 } else {
 title = `${creator} keeps a measured, mostly-neutral line across ${topics.length} topics`;
 }

 let summary: string;
 if (shifting.length) {
 summary = `The most pronounced movement in ${creator}'s imported transcripts is on ${shifting[0].topicName} (${humanStance(
 shifting[0].trendLabel
 )}). ${
 opinionated.length
 ? `They're most outspoken on ${opinionated[0].topicName} (mostly ${humanStance(opinionated[0].stance)}).`
 : "Most other topics draw a measured, neutral stance."
 } Recurring themes: ${topThemes}.`;
 } else if (opinionated.length) {
 summary = `${creator} is most outspoken on ${opinionated[0].topicName} (mostly ${humanStance(
 opinionated[0].stance
 )})${opinionated.length > 1 ? `, with a clear lean on ${opinionated[1].topicName} too` : ""}, while staying comparatively neutral elsewhere. Recurring themes: ${topThemes}.`;
 } else {
 summary = `Across ${creator}'s imported transcripts the recurring themes are ${topThemes}, but the stance is measured and largely neutral — no topic carries a dominant supportive or opposed position.`;
 }

 const sections: Array<{ heading: string; body: string }> = [];
 sections.push({
 heading: "Most outspoken on",
 body: opinionated.length
 ? opinionated
 .slice(0, 3)
 .map(
 (t) =>
 `• ${t.topicName} — mostly ${humanStance(t.stance)} (${Math.round(
 t.share * 100
 )}% of ${t.videoCount} videos)`
 )
 .join("\n")
 : "No topic shows a dominant supportive or opposed stance — the creator stays measured across the board.",
 });
 sections.push({
 heading: "Biggest shift",
 body: shifting.length
 ? `${shifting[0].topicName}: ${shifting[0].timelineSummary || `trend classified as ${humanStance(shifting[0].trendLabel)}.`}`
 : "No pronounced stance shifts surfaced across the tracked topics — positions are stable in the imported window.",
 });
 if (supportiveTopics.length && opposedTopics.length) {
 sections.push({
 heading: "Tensions & contradictions",
 body: `Holds opposing positions across topics — supportive on ${supportiveTopics[0].topicName}, opposed on ${opposedTopics[0].topicName}. Worth reading the evidence on each directly.`,
 });
 }
 if (neutral.length) {
 sections.push({
 heading: "Where they stay neutral",
 body: `Comparatively guarded on ${neutral
 .slice(0, 3)
 .map((t) => t.topicName)
 .join(", ")} — mostly descriptive coverage rather than a strong position.`,
 });
 }
 sections.push({
 heading: "Limitations",
 body: "Findings are limited to videos imported into ThoughtTracker, and stance is inferred from transcript text only — not audio tone, prosody, or anything said off-record.",
 });

 return { title, summary, caveats: REPORT_CAVEAT, sections, evidence: [] };
}

/*
 * ---------------------------------------------------------------------------
 * Topic report
 * ---------------------------------------------------------------------------
 */

/** Trend labels that represent a real, analyzed stance movement over time. */
const SHIFT_TRENDS = new Set(["gradual_shift", "abrupt_shift"]);

/**
 * A qualitative, in-words descriptor for a dominant stance — so the report
 * LEADS with characterization ("a nuanced, divided take") instead of dumping
 * raw counts. `mixed` is the nuance case; supportive/opposed/neutral get their
 * natural phrasing.
 */
function stanceDescriptor(stance: string): string {
 switch (stance) {
 case "supportive":
 return "a broadly favorable take";
 case "opposed":
 return "a largely critical take";
 case "mixed":
 return "a nuanced, divided take";
 case "neutral":
 return "an even-handed, descriptive take";
 default:
 return "a mostly tentative take";
 }
}

/** The most common stance in a distribution (ties resolve to first inserted). */
function dominantStanceOf(distribution: Record<string, number>): string {
 let best = "insufficient_evidence";
 let bestN = -1;
 for (const [stance, n] of Object.entries(distribution)) {
 if (n > bestN) {
 best = stance;
 bestN = n;
 }
 }
 return best;
}

/**
 * Mock topic INSIGHT report — an HONEST, quote-grounded digest of a creator's
 * stance on one topic.
 *
 * Driven by the analyzed `trendLabel` (ground truth), NOT a cherry-picked
 * first/last video: a stable topic is characterized by its dominant stance
 * ("consistently nuanced"); only a real gradual/abrupt-shift trend gets a
 * movement narrative (early-window vs late-window aggregate). This keeps the
 * title, summary, and "How it's evolved" section internally consistent (the old
 * version could title a "shift" while the body said "stable"). The report is
 * anchored on the creator's own cleaned verbatim quotes, contrasting supportive
 * and critical lines. Mirrors what the upgraded topic-report prompt asks of a
 * real LLM, so mock and live modes agree.
 */
function mockTopicReport(req: LlmRequest, _seed: string): unknown {
 const creator = (req.taskInput?.creatorName as string | undefined) ?? "the creator";
 const topic = (req.taskInput?.topicName as string | undefined) ?? "this topic";
 const timelineSummary = (req.taskInput?.timelineSummary as string | undefined) ?? "";
 const trendLabel = (req.taskInput?.trendLabel as string | undefined) ?? "insufficient_data";
 const summaries =
 (req.taskInput?.summaries as Array<{
 videoId: string;
 videoTitle: string;
 publishedAt?: string;
 dominantStance: string;
 summary: string;
 }>) ?? [];
 const quotes =
 (req.taskInput?.quotes as Array<{
 quote: string;
 stance: string;
 videoTitle: string;
 publishedAt?: string;
 }>) ?? [];

 const distribution: Record<string, number> = {};
 for (const s of summaries)
 distribution[s.dominantStance] = (distribution[s.dominantStance] ?? 0) + 1;
 const total = summaries.length;
 const dominant = dominantStanceOf(distribution);
 const dominantPct = total ? Math.round(((distribution[dominant] ?? 0) / total) * 100) : 0;
 /* Distribution string, most-common first. */
 const distributionStr = Object.entries(distribution)
 .sort((a, b) => b[1] - a[1])
 .map(([k, v]) => `${humanStance(k)} (${v})`)
 .join(", ");

 /* Chronological, stance-bearing videos — the window comparison reads from these. */
 const dated = summaries
 .filter((s) => s.publishedAt && DEFINITE_STANCES.has(s.dominantStance))
 .sort((a, b) => Date.parse(a.publishedAt as string) - Date.parse(b.publishedAt as string));
 const spanStr =
 dated.length >= 2
 ? ` between ${reportMonth(dated[0].publishedAt)} and ${reportMonth(dated[dated.length - 1].publishedAt)}`
 : "";

 /*
 * Honor the GROUND-TRUTH trend label. Only describe a shift when the analyzed
 * trend says one happened; otherwise characterize the consistent stance. This
 * is what keeps the title from contradicting the body.
 */
 const isShift = SHIFT_TRENDS.has(trendLabel);
 /* Aggregate the early third vs late third (robust to single-video noise). */
 const third = Math.max(1, Math.floor(dated.length / 3));
 const earlyDom = dated.length ? dominantStanceOf(countStances(dated.slice(0, third))) : dominant;
 const lateDom = dated.length ? dominantStanceOf(countStances(dated.slice(-third))) : dominant;
 const movementVisible = isShift && dated.length >= 2 && earlyDom !== lateDom;

 let title: string;
 if (movementVisible) {
 title = `${creator}'s take on ${topic} shifted from ${humanStance(earlyDom)} to ${humanStance(lateDom)}`;
 } else if (isShift) {
 title = `${creator}'s take on ${topic} has been evolving`;
 } else if (dominant === "mixed") {
 title = `${creator} takes a consistently nuanced view of ${topic}`;
 } else if (dominant === "supportive" || dominant === "opposed") {
 title = `${creator} is consistently ${dominant} on ${topic}`;
 } else {
 title = `${creator} keeps an even-handed line on ${topic}`;
 }

 const movementSentence = movementVisible
 ? ` Over time the emphasis moved from ${humanStance(earlyDom)} toward ${humanStance(lateDom)}.`
 : isShift
 ? " The analyzed trend flags movement over the window."
 : " The position has stayed broadly consistent rather than shifting.";
 /*
 * Lead with the qualitative characterization and how it moved — NOT a count
 * dump. The distribution is demoted to one trailing clause; the full split and
 * exact percentages live in the "Overall stance" section, never the headline.
 * (A mock can only characterize; genuine claim-level synthesis is what the real
 * LLM adds on top of this same shape.)
 */
 const leanClause =
 dominantPct > 0 ? ` That read holds across most of the ${total} analyzed videos.` : "";
 const summary =
 total > 0
 ? `${creator}'s coverage of ${topic}${spanStr} reflects ${stanceDescriptor(dominant)}.${movementSentence}${leanClause}`
 : `There isn't enough analyzed data on ${topic} for ${creator} to characterize a stance yet.`;

 const sections: Array<{ heading: string; body: string }> = [];

 sections.push({
 heading: "Overall stance",
 body:
 total > 0
 ? `Across ${total} analyzed videos, ${creator}'s stance on ${topic} is best described as ${stanceDescriptor(
 dominant
 )} (${humanStance(dominant)} ${dominantPct}%). Full breakdown: ${distributionStr}.`
 : "No analyzed videos with a stance signal are available for this topic yet.",
 });

 sections.push({
 heading: "How it's evolved",
 body: movementVisible
 ? `Early videos (${reportMonth(dated[0].publishedAt)}) skewed ${humanStance(
 earlyDom
 )}; the most recent (${reportMonth(dated[dated.length - 1].publishedAt)}) skew ${humanStance(
 lateDom
 )}.${timelineSummary ? ` ${timelineSummary}` : ""}`
 : `Broadly stable across the window — no marked stance shift.${
 timelineSummary ? ` ${timelineSummary}` : ""
 }`,
 });

 /*
 * "In their own words" — the grounding the report lives on. Show the cleaned
 * verbatim quotes, leading with a supportive/critical CONTRAST when both
 * exist (more revealing than same-stance repetition); fall back to the
 * per-video summaries only when no quotes survived cleaning.
 */
 const supportive = quotes.filter((q) => q.stance === "supportive");
 const critical = quotes.filter((q) => q.stance === "opposed" || q.stance === "mixed");
 const featured =
 supportive.length && critical.length
 ? [...supportive.slice(0, 2), ...critical.slice(0, 2)]
 : quotes.slice(0, 4);
 const ownWords = featured.length
 ? featured
 .map(
 (q) =>
 `“${q.quote}” — ${q.videoTitle}, ${reportMonth(q.publishedAt)} · ${humanStance(q.stance)}`
 )
 .join("\n")
 : summaries
 .slice(0, 4)
 .map((s) => `• ${s.videoTitle}: ${s.summary}`)
 .join("\n");
 sections.push({
 heading: "In their own words",
 body: ownWords || "No verbatim excerpts are available for this topic yet.",
 });

 sections.push({
 heading: "Limitations",
 body: "Findings reflect imported transcripts only. Tone, intent, and off-record statements are not captured, and a dominant stance per video flattens nuance within it.",
 });

 return {
 title,
 summary,
 caveats: REPORT_CAVEAT,
 sections,
 evidence: summaries.slice(0, 5).map((s) => ({
 videoId: s.videoId,
 note: `Dominant stance ${humanStance(s.dominantStance)}.`,
 })),
 };
}

/** Tally dominant stances across a set of per-video summaries. */
function countStances(rows: Array<{ dominantStance: string }>): Record<string, number> {
 const counts: Record<string, number> = {};
 for (const r of rows) counts[r.dominantStance] = (counts[r.dominantStance] ?? 0) + 1;
 return counts;
}
