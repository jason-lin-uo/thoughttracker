import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { StanceTimeline } from "../../src/components/StanceTimeline";
import type { StanceMoment } from "../../src/lib/stanceTimeline";

/*
 * Wrap in ThemeProvider (the timeline reads resolved theme for token hues)
 * and a router (the detail panel renders a <Link>).
 */
function wrap(ui: React.ReactNode) {
  return (
    <ThemeProvider>
      <BrowserRouter>{ui}</BrowserRouter>
    </ThemeProvider>
  );
}

/* Factory: a StanceMoment with defaults so each test states only what it cares about. */
function moment(
  over: Partial<StanceMoment> & Pick<StanceMoment, "id" | "date" | "stance">,
): StanceMoment {
  return {
    videoTitle: "A video",
    videoHref: "/videos/v1",
    evidenceQuote: null,
    summary: null,
    ...over,
  };
}

describe("StanceTimeline", () => {
  it("renders the empty verdict and no dots when there are no moments", () => {
    render(wrap(<StanceTimeline moments={[]} topicName="Climate" />));
    /* Matches both the verdict headline and the empty-state body line. */
    expect(
      screen.getAllByText(/not enough dated evidence/i).length,
    ).toBeGreaterThan(0);
    /* No dot buttons rendered in the empty state. */
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the derived verdict headline above the dots", () => {
    render(
      wrap(
        <StanceTimeline
          moments={[
            moment({ id: "1", date: "2021-01-01", stance: "supportive" }),
            moment({ id: "2", date: "2023-01-01", stance: "supportive" }),
          ]}
          topicName="Climate"
        />,
      ),
    );
    expect(
      screen.getByRole("heading", { name: /leans supportive/i }),
    ).toBeInTheDocument();
  });

  it("centers the single dot (left = 50%) without crashing on one moment", () => {
    render(
      wrap(
        <StanceTimeline
          moments={[
            moment({
              id: "1",
              date: "2022-06-01",
              stance: "opposed",
              videoTitle: "Solo",
            }),
          ]}
          topicName="Climate"
        />,
      ),
    );
    /* Desktop + mobile both render a button for the moment in jsdom. */
    const buttons = screen.getAllByRole("button", { name: /Solo/ });
    expect(buttons.length).toBeGreaterThan(0);
    /* The desktop dot is absolutely positioned at 50% for a single moment. */
    const centered = buttons.find((b) => b.style.left === "50%");
    expect(centered).toBeDefined();
  });

  it("reveals the evidence quote when a dot is selected, then hides it on re-click", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <StanceTimeline
          moments={[
            moment({
              id: "1",
              date: "2021-01-01",
              stance: "supportive",
              videoTitle: "Episode One",
              evidenceQuote: "I strongly support this.",
            }),
            moment({
              id: "2",
              date: "2022-01-01",
              stance: "supportive",
              videoTitle: "Episode Two",
            }),
          ]}
          topicName="Climate"
        />,
      ),
    );
    /* Hint shown before selection. */
    expect(
      screen.getByText(/select a point on the timeline/i),
    ).toBeInTheDocument();

    const [dot] = screen.getAllByRole("button", { name: /Episode One/ });
    await user.click(dot);
    expect(screen.getByText(/I strongly support this/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Episode One/ })).toHaveAttribute(
      "href",
      "/videos/v1",
    );

    /* Clicking the same dot again toggles the selection back off. */
    await user.click(dot);
    expect(
      screen.queryByText(/I strongly support this/),
    ).not.toBeInTheDocument();
  });

  it("falls back to the summary, then to a no-quote message", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <StanceTimeline
          moments={[
            moment({
              id: "1",
              date: "2021-01-01",
              stance: "neutral",
              videoTitle: "Summary Only",
              summary: "A balanced take.",
            }),
            moment({
              id: "2",
              date: "2022-01-01",
              stance: "neutral",
              videoTitle: "Bare Moment",
            }),
          ]}
          topicName="Climate"
        />,
      ),
    );

    const [summaryDot] = screen.getAllByRole("button", {
      name: /Summary Only/,
    });
    await user.click(summaryDot);
    expect(screen.getByText("A balanced take.")).toBeInTheDocument();

    const [bareDot] = screen.getAllByRole("button", { name: /Bare Moment/ });
    await user.click(bareDot);
    expect(screen.getByText(/no evidence quote captured/i)).toBeInTheDocument();
  });

  it("exposes the dots as a labeled group and marks the selected dot pressed", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <StanceTimeline
          moments={[
            moment({
              id: "1",
              date: "2022-01-01",
              stance: "opposed",
              videoTitle: "Only",
            }),
          ]}
          topicName="Climate"
        />,
      ),
    );
    const groups = screen.getAllByRole("group");
    expect(groups.length).toBeGreaterThan(0);
    const [dot] = screen.getAllByRole("button", { name: /Only/ });
    expect(dot).toHaveAttribute("aria-pressed", "false");
    await user.click(dot);
    /* After selection the same logical moment's button reports pressed. */
    const pressed = screen
      .getAllByRole("button", { name: /Only/ })
      .some((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toBe(true);
  });

  it("shows the mobile stacked list with a stance badge per moment", () => {
    render(
      wrap(
        <StanceTimeline
          moments={[
            moment({
              id: "1",
              date: "2022-01-01",
              stance: "supportive",
              videoTitle: "M",
            }),
          ]}
          topicName="Climate"
        />,
      ),
    );
    /* The mobile list is a <ul>; assert a StanceBadge label appears within it. */
    const lists = screen.getAllByRole("list");
    /* Pick the <ul> that contains the supportive badge. */
    const mobileList = lists.find((l) => within(l).queryByText(/supportive/i));
    expect(mobileList).toBeDefined();
  });

  it("toggles selection from the mobile stacked-list button", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <StanceTimeline
          moments={[
            moment({
              id: "1",
              date: "2022-01-01",
              stance: "supportive",
              videoTitle: "Mobile Pick",
              evidenceQuote: "Said on mobile.",
            }),
          ]}
          topicName="Climate"
        />,
      ),
    );
    /* Reach the button that lives inside the mobile <ul> specifically. */
    const lists = screen.getAllByRole("list");
    /* The <ul> whose button names the mobile pick. */
    const mobileList = lists.find((l) =>
      within(l).queryByRole("button", { name: /Mobile Pick/ }),
    );
    expect(mobileList).toBeDefined();
    const mobileButton = within(mobileList as HTMLElement).getByRole("button", {
      name: /Mobile Pick/,
    });

    await user.click(mobileButton);
    expect(screen.getByText(/said on mobile/i)).toBeInTheDocument();
    /* Re-click toggles the selection off (exercises the `? null` arm). */
    await user.click(mobileButton);
    expect(screen.queryByText(/said on mobile/i)).not.toBeInTheDocument();
  });
});
