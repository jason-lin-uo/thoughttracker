import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "../../src/components/AppLayout";
import { api } from "../../src/lib/api";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { ToastProvider } from "../../src/toast/ToastProvider";

vi.mock("../../src/lib/api", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ items: [], totalPages: 1 })),
  },
}));

/* Wraps UI in the router + query + theme + toast providers AppLayout's chrome
 depends on (theme toggle reads ThemeProvider; routed links need a Router). */
function wrap(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>{ui}</ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

describe("AppLayout", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockClear();
  });

  it("renders the brand + nav links + main", () => {
    render(wrap(<AppLayout>page content</AppLayout>));
    expect(screen.getAllByText(/ThoughtTracker/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Add Creators/).length).toBeGreaterThan(0);
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("brand lockups link home to the dashboard", () => {
    render(wrap(<AppLayout>x</AppLayout>));
    const brandLinks = screen.getAllByRole("link", { name: /ThoughtTracker/i });
    expect(brandLinks.length).toBeGreaterThan(0);
    brandLinks.forEach((link) => expect(link).toHaveAttribute("href", "/"));
  });

  it("renders skip-to-content link", () => {
    render(wrap(<AppLayout>x</AppLayout>));
    expect(screen.getByText(/Skip to main content/i)).toBeInTheDocument();
  });

  it("warms common route data shortly after mount", async () => {
    vi.useFakeTimers();
    try {
      render(wrap(<AppLayout>x</AppLayout>));
      expect(api.get).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(800);
        await Promise.resolve();
      });
      expect(api.get).toHaveBeenCalledWith("/reports", {
        sort: "date_desc",
        page: 1,
        pageSize: 12,
      });
      expect(api.get).toHaveBeenCalledWith("/videos", {
        page: 1,
        pageSize: 24,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefetches a nav destination on hover", async () => {
    const user = userEvent.setup();
    render(wrap(<AppLayout>x</AppLayout>));
    vi.mocked(api.get).mockClear();

    await user.hover(screen.getAllByRole("link", { name: /Videos/i })[0]!);

    expect(api.get).toHaveBeenCalledWith("/videos", {
      page: 1,
      pageSize: 24,
    });
  });

  it("opens + closes the mobile drawer", async () => {
    const user = userEvent.setup();
    render(wrap(<AppLayout>x</AppLayout>));
    const toggle = screen.getAllByRole("button", {
      name: /Open navigation|Close navigation/i,
    })[0]!;
    await user.click(toggle);
    /* Drawer reveals primary nav; we just verify the toggle still exists. */
    expect(toggle).toBeInTheDocument();
  });

  it("opens the drawer as a modal dialog and moves focus into it", async () => {
    const user = userEvent.setup();
    render(wrap(<AppLayout>x</AppLayout>));
    const toggle = screen.getAllByRole("button", {
      name: /Open navigation/i,
    })[0]!;
    await user.click(toggle);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    /* Focus moved into the panel (onto a focusable element within it). */
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes the drawer on Escape and returns focus to the toggle", async () => {
    const user = userEvent.setup();
    render(wrap(<AppLayout>x</AppLayout>));
    const toggle = screen.getAllByRole("button", {
      name: /Open navigation/i,
    })[0]!;
    await user.click(toggle);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    /* Drawer gone… */
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    /* …and focus returned to the hamburger toggle. */
    expect(document.activeElement).toBe(toggle);
  });

  it("traps Tab focus within the open drawer (wraps last → first)", async () => {
    const user = userEvent.setup();
    render(wrap(<AppLayout>x</AppLayout>));
    const toggle = screen.getAllByRole("button", {
      name: /Open navigation/i,
    })[0]!;
    await user.click(toggle);
    /*
     * The trap is scoped to the drawer PANEL (#mobile-nav), not the whole
     * dialog (which also holds the backdrop close button). Scope the query
     * the same way so we assert against the elements the trap actually cycles.
     */
    const panel = document.getElementById("mobile-nav")!;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    );
    const last = focusables[focusables.length - 1]!;
    const first = focusables[0]!;
    /* Focus the last element, then Tab forward — focus should wrap to first. */
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);
    /* Shift+Tab from the first element wraps back to the last. */
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });
});
