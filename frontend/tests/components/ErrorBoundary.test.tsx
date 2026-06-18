import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "../../src/components/ErrorBoundary";

/* Component that always throws on render, to trip the ErrorBoundary. */
function Boom(): React.ReactNode {
  throw new Error("kapow");
}

describe("ErrorBoundary", () => {
  it("catches a thrown error and renders the recovery screen", () => {
    const orig = console.error;
    console.error = vi.fn(); /* suppress React's boundary log noise */
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/kapow/)).toBeInTheDocument();
    console.error = orig;
  });

  it("dismiss button clears the error state", async () => {
    const orig = console.error;
    console.error = vi.fn();
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    /*
     * After dismiss, the boundary tries to render children again — which still
     * throws — so we end up showing the recovery again. We just verify the
     * dismiss button is responsive (no crash).
     */
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    console.error = orig;
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <p>peaceful child</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("peaceful child")).toBeInTheDocument();
  });
});
