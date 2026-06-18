import { strings } from "../../i18n/en";

/**
 * ConsoleStats — the compact stats row beneath the heatmap (the prototype's
 * `.stats`): videos / evidence / avg-confidence / topics, each a small card
 * with a big mono number and an uppercase caption.
 *
 * All four values recompute from the in-range data the parent passes in (the
 * date range filters them upstream), so the row stays in sync with the rest
 * of the console. `avgConf` is a pre-formatted string ("87%" or "—") so the
 * empty-range case renders an em-dash rather than "NaN%".
 *
 * @param props.videos - In-range video count.
 * @param props.evidence - In-range evidence-row count.
 * @param props.avgConf - Pre-formatted average-confidence string ("87%"/"—").
 * @param props.topics - The creator's total topic count (context, not range-scoped).
 */
export function ConsoleStats({
  videos,
  evidence,
  avgConf,
  topics,
}: {
  videos: number;
  evidence: number;
  avgConf: string;
  topics: number;
}) {
  /* Each tile is [value, caption]; rendered uniformly so the row stays tidy. */
  const tiles: Array<[string | number, string]> = [
    [videos, strings.topicAnalysis.statsVideos],
    [evidence, strings.topicAnalysis.statsEvidence],
    [avgConf, strings.topicAnalysis.statsAvgConf],
    [topics, strings.topicAnalysis.statsTopics],
  ];
  return (
    <div className="mt-1.5 flex gap-3">
      {tiles.map(([value, caption]) => (
        <div
          key={caption}
          className="flex-1 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-card dark:border-ink-800 dark:bg-ink-900"
        >
          <p className="font-mono text-xl font-semibold text-ink-900 dark:text-ink-50">
            {value}
          </p>
          <p className="mt-0.5 text-[10.5px] uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {caption}
          </p>
        </div>
      ))}
    </div>
  );
}
