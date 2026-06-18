import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { AppHeader } from "../../src/components/AppHeader";
import { renderPage } from "../pages/_render";

describe("AppHeader", () => {
  it("renders the stylized brand and the remaining global actions", () => {
    renderPage(<AppHeader />);
    expect(screen.getByText("ThoughtTracker")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Add creator/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: /Toggle theme/i }),
    ).toBeInTheDocument();
  });

  it("links the brand back to the dashboard home", () => {
    renderPage(<AppHeader />);
    const brand = screen.getByText("ThoughtTracker").closest("a");
    expect(brand).toHaveAttribute("href", "/");
  });
});
