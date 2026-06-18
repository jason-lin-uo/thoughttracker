import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { useTheme } from "../../src/theme/themeContext";
import { ThemeToggle } from "../../src/components/ThemeToggle";

/*
 * Probe component that surfaces the current theme mode + resolved value
 * from useTheme as testids, so tests can assert on them.
 */
function ThemeProbe() {
  const { mode, resolved } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolved}</span>
    </div>
  );
}

describe("ThemeProvider + useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("starts in system mode by default and resolves to light or dark", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("mode").textContent).toBe("system");
    expect(["light", "dark"]).toContain(
      screen.getByTestId("resolved").textContent,
    );
  });

  it("reads stored mode from localStorage", () => {
    localStorage.setItem("thoughttracker.theme", "dark");
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("mode").textContent).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("ignores bogus stored mode and falls back to system", () => {
    localStorage.setItem("thoughttracker.theme", "garbage");
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("mode").textContent).toBe("system");
  });

  it("ThemeToggle persists user choice", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
        <ThemeProbe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("radio", { name: /dark/i }));
    expect(screen.getByTestId("mode").textContent).toBe("dark");
    expect(localStorage.getItem("thoughttracker.theme")).toBe("dark");
  });

  it("useTheme throws outside a ThemeProvider", () => {
    expect(() => render(<ThemeProbe />)).toThrow(/within ThemeProvider/);
  });

  it("applyTheme sets dark class on documentElement when dark", () => {
    localStorage.setItem("thoughttracker.theme", "dark");
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applyTheme removes dark class when switching to light", async () => {
    const user = userEvent.setup();
    localStorage.setItem("thoughttracker.theme", "dark");
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("radio", { name: /light/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("ThemeProvider system-preference tracking", () => {
  /*
   * Capture the `change` listener the provider registers so the test can
   * fire a simulated OS theme flip. `matches` starts dark to also cover the
   * `systemDark ? "dark" : "light"` dark arm of the system resolution.
   */
  let changeHandler: ((e: MediaQueryListEvent) => void) | null = null;
  let currentMatches = true;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    changeHandler = null;
    currentMatches = true;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return currentMatches;
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (
        _type: string,
        cb: (e: MediaQueryListEvent) => void,
      ) => {
        changeHandler = cb;
      },
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves to dark in system mode when the OS prefers dark", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("mode").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("live-updates the resolved theme when the OS preference flips", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    /*
     * Simulate the OS switching to light; the registered change handler
     * mirrors it into state (covers the matchMedia `change` listener body).
     */
    currentMatches = false;
    act(() => {
      changeHandler?.({ matches: false } as MediaQueryListEvent);
    });
    expect(screen.getByTestId("resolved").textContent).toBe("light");
  });
});
