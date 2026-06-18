import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "../../src/components/StatCard";

describe("StatCard", () => {
  it("renders label + value", () => {
    render(<StatCard label="Creators" value={3} />);
    expect(screen.getByText("Creators")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    render(<StatCard label="X" value="Y" icon="🎬" />);
    expect(screen.getByText("🎬")).toBeInTheDocument();
  });

  it("renders hint when provided", () => {
    render(<StatCard label="X" value="Y" hint="hint text" />);
    expect(screen.getByText("hint text")).toBeInTheDocument();
  });
});
