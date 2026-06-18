/**
 * i18n (internationalization) — single source of truth for user-facing
 * English strings.
 *
 * Why a single file (and not react-intl / i18next)? V1 is English-only and
 * a full i18n framework is dead weight. By centralising strings here we get:
 * - Easy review of all copy in one place
 * - A trivial future swap to react-intl / i18next (one mechanical pass)
 * - Cleaner JSX (no inline copy strings)
 *
 * Convention: keys group by surface (`dashboard.*`, `evidence.*`, etc.).
 * Sentences end with a period. UI strings use Title Case for headings and
 * sentence case for body copy.
 *
 * Add a new language by creating a sibling file (e.g. `es.ts`) with the
 * same `Strings` type, then switching the `strings` export at the module
 * boundary.
 */

export const en = Object.freeze({
  /* Layout / nav */
  nav: {
    dashboard: "Dashboard",
    imports: "Imports",
    addCreators: "Add Creators",
    creators: "Creators",
    compare: "Compare",
    videos: "Videos",
    topics: "Topics",
    evidence: "Evidence",
    reports: "Reports",
  },
  brand: {
    name: "ThoughtTracker",
    tagline: "See how viewpoints change over time",
    authorByline: "Built by Jason Lin",
    openNav: "Open navigation",
    closeNav: "Close navigation",
    navMenu: "Navigation menu",
    skipToContent: "Skip to main content",
  },

  /* Global app header actions */
  header: {
    /* Same destination + concept as the nav's "Add Creators"; kept singular for
 the button so the two surfaces read as one action, not two features. */
    addCreator: "Add creator",
  },

  /* Common */
  common: {
    loading: "Loading…",
    tryAgain: "Try again",
    somethingWentWrong: "Something went wrong",
    none: "—",
    all: "All",
    any: "Any",
    page: "Page",
    of: "of",
    next: "Next",
    prev: "Prev",
    open: "Open",
    viewAll: "View all",
    search: "Search",
    from: "From",
    to: "To",
    creator: "Creator",
    topic: "Topic",
    stance: "Stance",
    confidence: "Confidence",
    insufficientEvidence: "Insufficient evidence",
    status: "Status",
    transcriptStatus: "Transcript status",
    analysisStatus: "Analysis status",
    results: "Results",
    similarity: "similarity",
    save: "Save",
  },

  /* Dashboard */
  dashboard: {
    title: "Dashboard",
    subtitle: "Evidence-backed summary of imported transcripts.",
    newImport: "New import",
    emptyTitle: "No data yet",
    emptyDescription:
      "Restore the real-data dump or use the owner transcript workflow to import verified creator transcripts.",
    emptyCta: "Start an import",
    statsCreators: "Creators",
    /*
     * Labeled "Videos (Transcripts)" because every "video" in the corpus is
     * really an imported TRANSCRIPT to read/analyze, not an embedded YouTube
     * player — the parenthetical sets that expectation up front.
     */
    statsVideos: "Videos (Transcripts)",
    statsTopics: "Topics",
    statsEvidence: "Evidence quotes",
    recentImports: "Recent imports",
    recentCreators: "Recent creators",
    recentReports: "Recent reports",
    noImportJobs: "No import jobs yet.",
    noCreators: "No creators yet.",
    noReports: "No reports yet.",
    /* Import-row progress line: "{imported} of {found} videos imported". */
    videosImportedOf: "{imported} of {found} videos imported",
    /*
     * Featured-insight hero. The server prefers the latest topic report when
     * it maps to analyzed data, then falls back to the strongest analyzed
     * insight. Eyebrow + title vary by trend; `{creator}` / `{topic}` are
     * filled at render.
     */
    featured: {
      eyebrowShift: "Biggest stance shift",
      eyebrowMixed: "Most debated topic",
      eyebrowSteady: "Topic spotlight",
      titleAbrupt: "{creator} pivoted sharply on {topic}",
      titleGradual: "{creator}'s stance on {topic} has been shifting",
      titleMixed: "{creator} is divided on {topic}",
      titleSteady: "{creator} holds a steady line on {topic}",
      fallbackBody:
        "Explore the full stance trajectory and the evidence behind it.",
    },
  },

  /* Imports */
  imports: {
    title: "Import Center",
    subtitle: "Monitor creator import and analysis jobs.",
    startNew: "Add a creator",
    description:
      "Creator onboarding is PIN-gated. Use the admin workflow to queue new channels, then return here to monitor progress.",
    adminHandoff:
      "New creator imports are managed from the PIN-protected Add Creators workflow.",
    openAddCreators: "Add Creators",
    channelUrl: "Channel URL",
    channelUrlPlaceholder: "https://www.youtube.com/@channel",
    limit: "Limit",
    limitVideos: "videos",
    creatorOverride: "Creator name override (optional)",
    creatorOverridePlaceholder: "Leave blank to use the resolved channel title",
    startImport: "Start import",
    starting: "Starting…",
    recentJobs: "Recent import jobs",
    emptyTitle: "No import jobs yet",
    emptyDescription: "Start your first import above to see job progress here.",
  },
  importJob: {
    title: "Import Job",
    statusLabel: "Status",
    videosFound: "Videos found",
    imported: "Imported",
    transcripts: "Transcripts",
    started: "Started",
    completed: "Completed",
    error: "Error",
    videosInImport: "Videos in this import",
    failedCount: "failed",
    viewCreator: "View creator",
    openVideo: "Open video",
    noItems: "No items yet",
    noItemsDescription: "Items appear here as the import progresses.",
  },
  addCreators: {
    title: "Add Creators",
    subtitle:
      "Queue transcript import and analysis jobs for one or more YouTube creators.",
    adminLocked: "Admin controls locked",
    adminUnlocked: "Admin controls unlocked",
    pinDescription:
      "Creator onboarding is visible in the product, but only an administrator with the PIN can operate it.",
    pinLabel: "Admin PIN",
    pinPlaceholder: "Enter PIN",
    unlock: "Unlock",
    unlocking: "Checking...",
    lockHint:
      "Enter the admin PIN above to enable creator onboarding controls.",
    reportResetTitle: "Report library reset",
    reportResetDescription:
      "Clear generated reports and restore the clean report library state used by fresh installs.",
    reportResetButton: "Reset all reports",
    reportResetting: "Resetting...",
    reportResetConfirm:
      "Reset reports to the clean report library state? This removes generated reports.",
    reportResetDone: "Report library reset: {title}",
    urlsLabel: "Creator URLs",
    urlsPlaceholder:
      "https://www.youtube.com/@creator\nhttps://www.youtube.com/@anothercreator",
    limit: "Videos per creator",
    start: "Start onboarding",
    starting: "Starting...",
    queuedJobs: "Queued jobs",
    emptyResult: "Queued jobs will appear here after submission.",
    invalidEmpty: "Paste at least one creator URL.",
    invalidUrl: "Creator URL looks invalid.",
    resultSummary: "Queued {success} of {total} creators.",
    viewJob: "View job",
    started: "Started",
    failed: "Failed",
  },

  /* Creators */
  creators: {
    title: "Creators",
    subtitle: "Browse imported creators and their analyzed content.",
    searchPlaceholder: "Search creators…",
    emptyTitle: "No creators yet",
    emptyDescription: "Run an import to populate creator data.",
    emptyCta: "Start an import",
    cardVideos: "videos",
    cardTranscripts: "transcripts",
    cardTopics: "topics",
    lastImported: "Last imported",
  },
  creatorOverview: {
    rerunAnalysis: "Re-run analysis",
    generateReport: "Generate creator report",
    compareWith: "Compare with…",
    generating: "Generating…",
    topTopics: "Top topics",
    recentVideos: "Recent video transcripts",
    latestReport: "Latest report",
    noTopics: "No topic summaries yet.",
    noVideos: "No videos yet.",
    noReport:
      'No reports generated yet. Click "Generate creator report" above to create one.',
    statsVideos: "Videos",
    statsTranscripts: "Transcripts",
    statsTopics: "Topics",
    statsEvidence: "Evidence",
    latestImport: "Latest import",
    viewJob: "View job",
    videosImported: "videos imported",
  },

  /* Videos */
  videos: {
    title: "Video library",
    subtitle: "Browse, filter, and inspect imported videos and analyses.",
    searchLabel: "Search",
    searchPlaceholder: "title or description",
    emptyTitle: "No videos match",
    emptyDescription: "Try clearing filters or starting an import.",
    table: {
      title: "Title",
      creator: "Creator",
      published: "Published",
      transcript: "Transcript",
      analysis: "Analysis",
    },
  },
  videoDetail: {
    openOnYouTube: "Open on YouTube",
    rechunk: "Rechunk",
    rerunAnalysis: "Re-run analysis",
    queued: "Queued…",
    topicSummaries: "Topic summaries",
    noSummaries: "No topic summaries yet.",
    mentions: "mentions",
    transcript: "Transcript",
    manualTranscriptDescription:
      "No transcript is currently available for this video. Paste a transcript below to enable analysis.",
    manualTranscriptPlaceholder: "Paste the full transcript here…",
    transcriptPending:
      "The transcript is being fetched for this video. Check back shortly.",
    saveAndAnalyze: "Save and analyze",
    saving: "Saving…",
    chunkPrefix: "chunk",
    wordsLabel: "words",
    chunksLabel: "chunks",
    /*
     * Human-readable labels for a transcript's `sourceType` (the provenance
     * of the text). The raw enum (e.g. "youtube_auto") leaked into the UI as
     * "youtube auto", which reads as a typo; map the known values to clear
     * phrasing and fall back to a humanized form for anything unmapped.
     */
    transcriptSource: {
      youtube_auto: "YouTube auto-captions",
      youtube_manual: "YouTube captions",
      manual_paste: "Manual transcript",
      manual: "Manual transcript",
    } as Record<string, string>,
  },

  /* Topics index (the taxonomy catalog reachable from the dashboard stat) */
  topics: {
    title: "Topics",
    subtitle: "The topic taxonomy detected across all imported transcripts.",
    searchPlaceholder: "Filter topics by name…",
    searchLabel: "Filter topics",
    /* Per-topic coverage line: "{videos} videos · {mentions} mentions". */
    coverage: "{videos} videos · {mentions} mentions",
    emptyTitle: "No topics yet",
    emptyDescription:
      "Topics appear once transcripts have been imported and analyzed.",
    noMatches: "No topics match your filter.",
    sortLabel: "Sort",
    sortAlphaAsc: "A → Z",
    sortAlphaDesc: "Z → A",
    sortMostVideos: "Most videos",
    sortFewestVideos: "Fewest videos",
    sortMostMentions: "Most mentions",
    sortFewestMentions: "Fewest mentions",
    sortNewest: "Newest",
    sortOldest: "Oldest",
    /* Count line above the grid: "{shown} of {total} topics". */
    countLine: "{shown} of {total} topics",
  },

  /* Topic analysis — the "analyst console" centerpiece */
  topicAnalysis: {
    /* Subtitle template: "<creator> · stance trajectory + evidence · <start> – <end>". */
    subtitleTemplate:
      "{creator} · stance trajectory + evidence · {start} – {end}",
    subtitleNoRange:
      "{creator} · stance trajectory + evidence · no videos in range",
    generateTopicReport: "Generate topic report",

    /* Verdict hero */
    verdictLabel: "Verdict",
    verdictLeans: "Leans {stance}",
    verdictNoData: "No data in range",
    verdictMeta: "{pct}% of {count} videos",

    /* Date-range bar */
    dateRange: "Date range",
    dateStartLabel: "Start date",
    dateEndLabel: "End date",
    presetAll: "All",
    preset90: "Last 90d",
    preset60: "Last 60d",
    preset30: "Last 30d",
    showingCount: "showing {shown} of {total} videos",

    /* Section eyebrows */
    trajectoryHeading: "Stance trajectory",
    balanceHeading: "Overall balance",
    heatmapHeading: "Per-video stance heatmap · oldest → newest",
    evidenceHeading: "Evidence · click a row for the verbatim quote",

    /* Stats row */
    statsVideos: "videos",
    statsEvidence: "evidence",
    statsAvgConf: "avg conf",
    statsTopics: "topics",

    /* Empty / fallback copy */
    noVideosInRange: "No videos in this date range.",
    noEvidenceInRange: "No {stance}evidence in this date range.",
    noReportSection: "Topic report",
    noReport: 'No topic report yet. Click "Generate topic report" above.',
    viewReport: "View topic report",

    /* Trajectory band labels (the horizontal stance lanes) */
    bandSupportive: "supportive",
    bandMixed: "mixed",
    bandNeutral: "neutral",
    bandOpposed: "opposed",

    /* Chart / accessibility */
    trajectoryAlt:
      "Stance trajectory line chart with {count} videos plotted by publish date and stance.",
    heatmapAlt:
      "Per-video stance heatmap with {count} videos grouped by month.",
    ribbonAlt: "Overall stance balance ribbon across {count} videos.",

    /* Evidence controls */
    filterAll: "All",
    sortLabel: "Sort",
    sortNewest: "Newest first",
    sortOldest: "Oldest first",
    sortHighConf: "Highest confidence",
    sortLowConf: "Lowest confidence",
    confidenceSuffix: "confidence",
    evidencePrev: "Previous",
    evidenceNext: "Next",
    evidencePageOf: "Page {page} of {total}",
    evidenceShowing: "Showing {from}–{to} of {count}",

    /* Episode modal */
    modalClose: "Close",
    modalNoQuotes: "No verbatim segments captured.",
    modalWatch: "Watch on source →",
  },

  /* Stance timeline (the topic-analysis hero) */
  stanceTimeline: {
    eyebrow: "Stance over time",
    subtitle: "How this creator's position evolved on",
    empty: "Not enough dated evidence to plot a stance timeline yet.",
    selectHint: "Select a point on the timeline to see the moment's evidence.",
    noQuote: "No evidence quote captured for this moment.",
    viewVideo: "Watch:",
    biggestShift: "Biggest stance shift",
  },

  /* Evidence */
  evidence: {
    title: "Evidence Explorer",
    subtitle:
      "Inspect every analyzed transcript excerpt that backs a stance classification.",
    searchLabel: "Search quote / claim",
    searchPlaceholder: "search excerpt text",
    emptyTitle: "No evidence yet",
    emptyDescription: "Try clearing filters or running analyses.",
    viewContext: "View context",
    items: "items",
  },
  evidenceDetail: {
    title: "Evidence detail",
    relevance: "Relevance",
    confidence: "Confidence",
    claimSummary: "Claim summary",
    rationale: "Rationale",
    sourceVideo: "Source video",
    openOnYouTube: "Open on YouTube",
    transcriptContext: "Transcript context",
    previousChunk: "Previous chunk",
    mainChunk: "Main chunk",
    nextChunk: "Next chunk",
    related: "Related evidence in this video",
    chunkLabel: "chunk",
  },

  /* Reports */
  reports: {
    title: "Reports",
    subtitle: "Generated creator and topic summary reports.",
    typeLabel: "Type",
    emptyTitle: "No reports yet",
    emptyDescription:
      "Reports are generated from creator or topic analysis pages.",
    sortLabel: "Sort",
    sortNewest: "Newest",
    sortOldest: "Oldest",
    sortTitleAsc: "Title A → Z",
    sortTitleDesc: "Title Z → A",
    selectAll: "Select all",
    selectOne: "Select report: {title}",
    deleteOne: "Delete report: {title}",
    selectedCount: "{count} selected",
    deleteSelected: "Delete selected",
    deleteAll: "Delete all",
    deleting: "Deleting…",
    confirmDeleteAll: "Delete ALL {count} reports? This cannot be undone.",
  },
  reportDetail: {
    summary: "Summary",
    sources: "Sources",
    caveats: "Caveats",
  },

  /* Charts */
  charts: {
    stanceOverTime: "Stance over time",
    stanceOverTimeHelp:
      "Averaged stance score per month. Opposed = -1, Neutral/Mixed = 0, Supportive = +1.",
    topicFrequency: "Topic frequency",
    topicFrequencyHelp: "Mentions per topic per month from imported videos.",
    noStance: "No stance-over-time data yet.",
    noTopicFrequency: "No topic frequency data yet.",
    loading: "Loading chart…",
    error: "Couldn't load this chart.",
    stanceTextAlternative:
      "Stance over time chart. {count} monthly data points.",
    overlayTextAlternative:
      "Stance over time chart comparing {count} creators.",
    frequencyTextAlternative:
      "Topic frequency chart with {count} monthly data points.",
  },

  /* Theme */
  theme: {
    light: "Light",
    dark: "Dark",
    system: "System",
    toggleLabel: "Toggle theme",
  },

  /* Errors */
  errors: {
    boundaryTitle: "Something went wrong",
    boundaryBody:
      "The app hit an unexpected error. Reloading usually fixes it.",
    dismiss: "Dismiss",
    reload: "Reload",
  },
  notFound: {
    title: "404",
    subtitle: "This page doesn't exist.",
    body: "The URL you followed isn't a route in ThoughtTracker.",
    backToDashboard: "← Back to dashboard",
  },

  /* Compare page (multi-creator side-by-side) */
  compare: {
    title: "Compare creators",
    subtitle:
      "Pick 2-5 creators to see side-by-side coverage, shared topics, and stance over time.",
    pickCreators: "Pick creators (2-5)",
    needAtLeastTwo: "Pick at least 2 creators to start.",
    statsSection: "Coverage",
    sharedTopicsSection: "Shared topics",
    sharedTopicsEmpty: "These creators don't share any analyzed topics yet.",
    timelineSection: "Stance over time",
    timelineEmpty: "Not enough dated stance data to plot a timeline.",
    statVideos: "Videos",
    statTranscripts: "Transcripts",
    statTopics: "Topics",
    statEvidence: "Evidence",
    mentionsCol: "Mentions",
    videosCol: "Videos",
  },

  /* Toast notifications shown after user actions */
  toasts: {
    reportQueuedTitle: "Report queued",
    reportQueuedBody:
      "Generating with the local model. This can take a moment.",
    reportReadyTitle: "Report ready",
    reportReadyBody: "Open it from the Reports tab.",
    reportFailedTitle: "Report generation failed",
    actionFailedTitle: "Something went wrong",
    dismiss: "Dismiss notification",
    reanalysisQueuedTitle: "Re-analysis queued",
    reanalysisQueuedBody: "We'll refresh this view as results land.",
    rechunkQueuedTitle: "Re-chunk queued",
    rechunkQueuedBody: "The transcript is being re-chunked.",
    transcriptSavedTitle: "Transcript saved",
    transcriptSavedBody: "Analysis has been queued for this video.",
    creatorsQueuedTitle: "Submission processed",
    creatorsQueuedBody:
      "See the queued jobs list below for per-creator results.",
    reportsDeletedTitle: "Reports deleted",
    reportsDeletedBody: "The selected reports have been removed.",
    reportsResetTitle: "Reports reset",
    reportsResetBody: "The report library is ready on the dashboard.",
  },

  /* Stance verdict copy — words, never color alone (WCAG 1.4.1) */
  verdict: {
    notEnough: "Not enough dated evidence yet",
    onDate: "{family} on {date}",
    shifted: "Shifted: {from} → {to}{where}",
    inYear: " in {year}",
    steadySince: "Leans {family} — steady since {year}",
    steady: "Leans {family} — steady",
  },
  ai: {
    disclaimer: "AI-generated analysis — may be inaccurate.",
    reportDisclaimer:
      "This report was generated by AI from transcripts and may contain inaccuracies.",
  },
});

export type Strings = typeof en;
/**
 * App strings dictionary.
 */
export const strings = en;
