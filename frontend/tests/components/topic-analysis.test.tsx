import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { VerdictHero } from "../../src/components/topic-analysis/VerdictHero";
import { DateRangeBar } from "../../src/components/topic-analysis/DateRangeBar";
import { StanceRibbon } from "../../src/components/topic-analysis/StanceRibbon";
import { StanceHeatmap } from "../../src/components/topic-analysis/StanceHeatmap";
import { StanceTrajectoryChart } from "../../src/components/topic-analysis/StanceTrajectoryChart";
import { EvidenceList } from "../../src/components/topic-analysis/EvidenceList";
import { EpisodeModal } from "../../src/components/topic-analysis/EpisodeModal";
import { ConsoleStats } from "../../src/components/topic-analysis/ConsoleStats";
import {
  computeVerdict,
  stanceCounts,
  type EvidenceRow,
  type StancePoint,
} from "../../src/lib/topicAnalysis";

/** Wrap a tree in a ThemeProvider (the console components read the theme). */
function withTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

/*
 * Two trajectory points (supportive then mixed) used across the chart/heatmap
 * tests; one carries verbatim quotes, the other does not.
 */
const points: StancePoint[] = [
  {
    id: "p1",
    t: Date.parse("2026-03-02T00:00:00Z"),
    date: "2026-03-02T00:00:00Z",
    stance: "supportive",
    conf: 0.92,
    title: "Episode One",
    sourceUrl: "https://example.com/v1",
    quotes: ["A supportive quote."],
    summary: "sup summary",
  },
  {
    id: "p2",
    t: Date.parse("2026-05-20T00:00:00Z"),
    date: "2026-05-20T00:00:00Z",
    stance: "mixed",
    conf: 0.8,
    title: "Episode Two",
    sourceUrl: null,
    quotes: [],
    summary: "mixed summary",
  },
];

describe("VerdictHero", () => {
  it("renders the dominant stance + percentage when there is data", () => {
    withTheme(<VerdictHero verdict={computeVerdict(points)} points={points} />);
    expect(screen.getByText(/Leans/i)).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText(/of 2 videos/i)).toBeInTheDocument();
  });

  it("degrades to 'No data in range' for an empty verdict", () => {
    withTheme(<VerdictHero verdict={computeVerdict([])} points={[]} />);
    expect(screen.getByText(/No data in range/i)).toBeInTheDocument();
  });
});

describe("DateRangeBar", () => {
  const extent = { min: points[0].t, max: points[1].t };
  const fullRange = { start: extent.min, end: extent.max };

  it("reports preset clicks", async () => {
    const user = userEvent.setup();
    const onPreset = vi.fn();
    withTheme(
      <DateRangeBar
        range={fullRange}
        extent={extent}
        preset="all"
        shown={2}
        total={2}
        onPreset={onPreset}
        onRangeChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/showing 2 of 2 videos/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Last 30d/i }));
    expect(onPreset).toHaveBeenCalledWith("30");
  });

  it("reports start + end edits (and falls back on blank input)", async () => {
    const onRangeChange = vi.fn();
    withTheme(
      <DateRangeBar
        range={fullRange}
        extent={extent}
        preset="all"
        shown={2}
        total={2}
        onPreset={vi.fn()}
        onRangeChange={onRangeChange}
      />,
    );
    const start = screen.getByLabelText(/start date/i);
    const end = screen.getByLabelText(/end date/i);

    /* A valid start edit reports the parsed start, end unchanged. */
    fireChange(start, "2026-04-01");
    expect(onRangeChange).toHaveBeenLastCalledWith({
      start: Date.parse("2026-04-01"),
      end: fullRange.end,
    });
    /* A valid end edit pads to end-of-day (inclusive). */
    fireChange(end, "2026-05-01");
    expect(onRangeChange.mock.calls.at(-1)![0].end).toBeGreaterThan(
      Date.parse("2026-05-01"),
    );
    /* A blank edit falls back to the data extent bounds. */
    fireChange(start, "");
    expect(onRangeChange.mock.calls.at(-1)![0].start).toBe(extent.min);
    fireChange(end, "");
    expect(onRangeChange.mock.calls.at(-1)![0].end).toBe(extent.max);
  });
});

/* Helper: set a controlled <input type=date> value the way the browser would. */
function fireChange(input: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("StanceRibbon", () => {
  it("renders a segment + legend entry per present family", () => {
    withTheme(
      <StanceRibbon counts={stanceCounts(points)} total={points.length} />,
    );
    /* Legend names supportive + mixed with their percentages. */
    expect(screen.getByText(/supportive · 50% \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/mixed · 50% \(1\)/i)).toBeInTheDocument();
  });

  it("shows the empty placeholder when there are no videos", () => {
    withTheme(
      <StanceRibbon
        counts={{ supportive: 0, mixed: 0, neutral: 0, opposed: 0 }}
        total={0}
      />,
    );
    /* The em-dash legend stands in for an empty ribbon. */
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("StanceHeatmap", () => {
  it("renders one labeled cell per video grouped by month and fires onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    withTheme(<StanceHeatmap points={points} onSelect={onSelect} />);
    const cell = screen.getByRole("button", { name: /Episode Two: .*Mixed/i });
    await user.click(cell);
    expect(onSelect).toHaveBeenCalledWith(points[1]);
  });

  it("shows the empty-range note when there are no points", () => {
    withTheme(<StanceHeatmap points={[]} onSelect={vi.fn()} />);
    expect(
      screen.getByText(/No videos in this date range/i),
    ).toBeInTheDocument();
  });
});

describe("StanceTrajectoryChart", () => {
  it("renders dots, fires onSelect on click, and shows a hover tooltip", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    withTheme(<StanceTrajectoryChart points={points} onSelect={onSelect} />);
    const dot = screen.getByRole("button", {
      name: /Episode One: .*Supportive/i,
    });
    /* Hover shows the tooltip (a status region) with the episode title. */
    await user.hover(dot);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await user.unhover(dot);
    await user.click(dot);
    expect(onSelect).toHaveBeenCalledWith(points[0]);
  });

  it("centers a single point without dividing by zero", () => {
    withTheme(
      <StanceTrajectoryChart points={[points[0]]} onSelect={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /Episode One/i }),
    ).toBeInTheDocument();
  });

  it("places a neutral/insufficient-evidence stance in the neutral band", () => {
    /* A non-directional stance exercises the `return "neutral"` band fallback. */
    const neutralPoint: StancePoint = {
      ...points[0],
      id: "pn",
      stance: "insufficient_evidence",
      title: "Episode Neutral",
    };
    withTheme(
      <StanceTrajectoryChart points={[neutralPoint]} onSelect={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /Episode Neutral/i }),
    ).toBeInTheDocument();
  });

  it("shows the empty-range note when there are no points", () => {
    withTheme(<StanceTrajectoryChart points={[]} onSelect={vi.fn()} />);
    expect(
      screen.getByText(/No videos in this date range/i),
    ).toBeInTheDocument();
  });
});

describe("EvidenceList", () => {
  const rows: EvidenceRow[] = [
    {
      id: "r1",
      stance: "supportive",
      quote: "Supportive quote",
      claim: "Claim one",
      title: "Ep1",
      date: "2026-03-02T00:00:00Z",
      conf: 0.92,
    },
    {
      id: "r2",
      stance: "mixed",
      quote: "Mixed quote",
      claim: "Claim two",
      title: "Ep2",
      date: "2026-05-20T00:00:00Z",
      conf: 0.8,
    },
  ];

  it("expands a row to reveal its verbatim quote, then collapses it", async () => {
    const user = userEvent.setup();
    withTheme(<EvidenceList rows={rows} />);
    expect(screen.queryByText(/Supportive quote/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Claim one/i }));
    expect(screen.getByText(/“Supportive quote”/)).toBeInTheDocument();
    /* Clicking again collapses it. */
    await user.click(screen.getByRole("button", { name: /Claim one/i }));
    await waitFor(() =>
      expect(screen.queryByText(/“Supportive quote”/)).not.toBeInTheDocument(),
    );
  });

  it("filters by a stance pill and shows the no-evidence note when empty", async () => {
    const user = userEvent.setup();
    withTheme(<EvidenceList rows={rows} />);
    /* Filter to "opposed" — no rows match → the empty note appears. */
    await user.click(screen.getByRole("button", { name: "opposed" }));
    expect(
      screen.getByText(/No opposed evidence in this date range/i),
    ).toBeInTheDocument();
  });

  it("re-sorts via the sort dropdown", async () => {
    const user = userEvent.setup();
    withTheme(<EvidenceList rows={rows} />);
    /* Default is newest-first → Claim two (May) precedes Claim one (Mar). */
    let claims = screen
      .getAllByText(/Claim (one|two)/)
      .map((el) => el.textContent);
    expect(claims).toEqual(["Claim two", "Claim one"]);
    /* Switch to oldest-first → order flips. */
    await user.selectOptions(screen.getByLabelText(/sort/i), "date_asc");
    claims = screen.getAllByText(/Claim (one|two)/).map((el) => el.textContent);
    expect(claims).toEqual(["Claim one", "Claim two"]);
  });

  it("paginates 10 rows per page with Previous/Next and resets on filter change", async () => {
    const user = userEvent.setup();
    const many: EvidenceRow[] = Array.from({ length: 23 }, (_, i) => ({
      id: `p${i}`,
      stance: "supportive",
      quote: `Quote ${i}`,
      claim: `Paged claim ${i}`,
      title: `Ep ${i}`,
      date: new Date(
        2026,
        0,
        23 - i,
      ).toISOString() /* descending → stable newest-first */,
      conf: 0.9,
    }));
    withTheme(<EvidenceList rows={many} />);
    /* Page 1: exactly 10 rows, Previous disabled, totals shown. */
    expect(screen.getAllByText(/Paged claim/).length).toBe(10);
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/Showing 1.10 of 23/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Previous/i })).toBeDisabled();
    /* Next → page 2. */
    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/Showing 11.20 of 23/)).toBeInTheDocument();
    /* Next → page 3 (last): 3 rows, Next disabled. */
    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText(/Showing 21.23 of 23/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/i })).toBeDisabled();
    expect(screen.getAllByText(/Paged claim/).length).toBe(3);
    /* Previous → back to page 2. */
    await user.click(screen.getByRole("button", { name: /Previous/i }));
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
    /* Changing the filter resets to page 1. */
    await user.click(screen.getByRole("button", { name: "supportive" }));
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });
});

describe("ConsoleStats", () => {
  it("renders the four stat tiles", () => {
    withTheme(
      <ConsoleStats videos={2} evidence={1} avgConf="86%" topics={3} />,
    );
    expect(screen.getByText("86%")).toBeInTheDocument();
    expect(screen.getByText("videos")).toBeInTheDocument();
    expect(screen.getByText("topics")).toBeInTheDocument();
  });
});

describe("EpisodeModal", () => {
  it("renders nothing when no point is selected", () => {
    const { container } = withTheme(
      <EpisodeModal point={null} onClose={vi.fn()} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows pull-quotes + a source link and traps Tab focus", async () => {
    const user = userEvent.setup();
    withTheme(<EpisodeModal point={points[0]} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/“A supportive quote.”/)).toBeInTheDocument();
    /* The source link is present (point one has a sourceUrl). */
    const link = screen.getByRole("link", { name: /watch on source/i });
    expect(link).toBeInTheDocument();
    /*
     * Focus starts on the close button (first focusable). Shift+Tab from the
     * first focusable wraps to the LAST (the source link) — the trap's
     * backward-wrap arm.
     */
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(link);
    /* Forward Tab from the last focusable wraps back to the first. */
    await user.tab();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );
  });

  it("falls back to the summary when no quotes exist and omits the link with no sourceUrl", () => {
    withTheme(<EpisodeModal point={points[1]} onClose={vi.fn()} />);
    expect(screen.getByText("mixed summary")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /watch on source/i }),
    ).not.toBeInTheDocument();
  });

  it("closes on ESC and on a backdrop click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = withTheme(
      <EpisodeModal point={points[0]} onClose={onClose} />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    /* The dimmed backdrop button (behind the card) also closes on click. */
    onClose.mockClear();
    const backdrop = container.querySelector(
      "button.absolute.inset-0",
    ) as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to the no-segments note when there are neither quotes nor a summary", () => {
    withTheme(
      <EpisodeModal
        point={{ ...points[1], summary: null }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/No verbatim segments captured/i),
    ).toBeInTheDocument();
  });

  it("does not yank focus on a parent re-render that passes a fresh onClose", async () => {
    const user = userEvent.setup();
    /*
     * Mirrors the real page: the parent owns `open`, passes a NEW `onClose`
     * arrow every render, and can be re-rendered (e.g. a React Query refetch)
     * without any focus change.
     */
    function Harness() {
      const [open, setOpen] = useState(false);
      const [, force] = useState(0);
      return (
        <ThemeProvider>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            open
          </button>
          <button data-testid="rerender" onClick={() => force((n) => n + 1)}>
            rerender
          </button>
          <EpisodeModal
            point={open ? points[0] : null}
            onClose={() => setOpen(false)}
          />
        </ThemeProvider>
      );
    }
    render(<Harness />);
    /* Open (focus → close button), then Tab-wrap focus onto the in-modal link. */
    await user.click(screen.getByTestId("trigger"));
    await user.tab({ shift: true });
    const link = screen.getByRole("link", { name: /watch on source/i });
    expect(document.activeElement).toBe(link);
    /*
     * A background re-render (fresh onClose identity, focus untouched) must NOT
     * re-run the open-effect — which would rip focus back to the close button.
     */
    fireEvent.click(screen.getByTestId("rerender"));
    expect(document.activeElement).toBe(link);
  });
});
