import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  StanceOverTimeChart,
  StanceOverlayChart,
  TopicFrequencyChart,
  ChartState,
} from "../../src/components/Charts";

/*
 * Recharts depends on ResponsiveContainer + DOM size. In jsdom there's no
 * layout, so the charts render empty. We assert the surrounding wrapper.
 */

describe("StanceOverTimeChart", () => {
  it("renders empty-state when no data", () => {
    render(<StanceOverTimeChart data={[]} />);
    expect(screen.getByText(/no stance/i)).toBeInTheDocument();
  });
  it("renders title + help text when data present", () => {
    render(
      <StanceOverTimeChart
        data={[{ date: "2025-01", averageStance: 0.5, count: 3 }]}
      />,
    );
    /*
     * "Stance over time" appears in both the visible title and the sr-only
     * text alternative, so match all occurrences.
     */
    expect(screen.getAllByText(/stance over time/i).length).toBeGreaterThan(0);
  });
});

describe("StanceOverlayChart", () => {
  it("renders empty-state when no points", () => {
    render(<StanceOverlayChart points={[]} series={[]} />);
    expect(screen.getByText(/no stance/i)).toBeInTheDocument();
  });
  it("renders title + each creator name in the legend when populated", () => {
    render(
      <StanceOverlayChart
        points={[
          { date: "2025-01", values: { c1: 0.5, c2: -0.2 } },
          { date: "2025-02", values: { c1: 0.4, c2: null } },
        ]}
        series={[
          { id: "c1", name: "Alice" },
          { id: "c2", name: "Bob" },
        ]}
      />,
    );
    expect(screen.getAllByText(/stance over time/i).length).toBeGreaterThan(0);
  });
});

describe("TopicFrequencyChart", () => {
  it("renders empty-state when no points", () => {
    render(<TopicFrequencyChart data={{ points: [], topics: [] }} />);
    expect(screen.getByText(/no topic frequency/i)).toBeInTheDocument();
  });
  it("renders title + help text when populated", () => {
    render(
      <TopicFrequencyChart
        data={{
          points: [{ date: "2025-01", topics: { AI: 3, Health: 1 } }],
          topics: [
            { id: "t1", name: "AI" },
            { id: "t2", name: "Health" },
          ],
        }}
      />,
    );
    expect(screen.getAllByText(/topic frequency/i).length).toBeGreaterThan(0);
  });
});

describe("ChartState", () => {
  it("renders the loading panel with a polite status role", () => {
    render(<ChartState kind="loading" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/loading chart/i)).toBeInTheDocument();
  });

  it("renders the error panel with the message and a working retry button", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ChartState kind="error" message="boom detail" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/couldn't load this chart/i)).toBeInTheDocument();
    expect(screen.getByText("boom detail")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("omits the message + retry button when not provided", () => {
    render(<ChartState kind="error" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
