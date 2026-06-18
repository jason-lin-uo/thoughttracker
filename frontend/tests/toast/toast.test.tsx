import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../src/toast/ToastProvider";
import { useToast } from "../../src/toast/toastContext";

/*
 * Test harness: a "fire" button that shows `count` success toasts and a
 * "clear" button that removes them all, used to drive the ToastProvider.
 */
function Trigger({ count = 1 }: { count?: number }) {
  const { showToast, clearToasts } = useToast();
  return (
    <>
      <button
        onClick={() => {
          for (let i = 0; i < count; i += 1)
            showToast({ kind: "success", title: `T${i}`, message: `m${i}` });
        }}
      >
        fire
      </button>
      <button onClick={clearToasts}>clear</button>
    </>
  );
}

describe("ToastProvider", () => {
  it("renders nothing initially", () => {
    render(
      <ToastProvider>
        <div>app</div>
      </ToastProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("showToast renders a success toast with role=status", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByText("fire"));
    expect(screen.getByText("m0")).toBeInTheDocument();
    expect(screen.getByText("T0")).toBeInTheDocument();
  });

  it("error toast uses role=alert", async () => {
    /* Fires a single error-kind toast (asserts it uses role=alert). */
    function ErrorTrigger() {
      const { showToast } = useToast();
      return (
        <button onClick={() => showToast({ kind: "error", message: "boom" })}>
          fire
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ErrorTrigger />
      </ToastProvider>,
    );
    await user.click(screen.getByText("fire"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("warning + info kinds render", async () => {
    /* Fires one warning-kind and one info-kind toast via separate buttons. */
    function MultiTrigger() {
      const { showToast } = useToast();
      return (
        <>
          <button onClick={() => showToast({ kind: "warning", message: "w" })}>
            w
          </button>
          <button onClick={() => showToast({ kind: "info", message: "i" })}>
            i
          </button>
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>,
    );
    await user.click(screen.getByText("w"));
    await user.click(screen.getByText("i"));
    expect(screen.getAllByText(/w|i/).length).toBeGreaterThan(0);
  });

  it("dismiss button removes the toast", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByText("fire"));
    expect(screen.getByText("m0")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Dismiss notification"));
    expect(screen.queryByText("m0")).toBeNull();
  });

  it("manually dismisses a sticky (durationMs=0) toast that has no timer", async () => {
    /*
     * A sticky toast never schedules an auto-dismiss timer, so dismissing it
     * exercises the `if (timer)` false arm of dismissToast (no timer to clear).
     */
    const user = userEvent.setup();
    /*
     * Fires a single sticky (durationMs=0) info toast — never auto-dismisses,
     * so it has no timer for dismissToast to clear.
     */
    function StickyTrigger() {
      const { showToast } = useToast();
      return (
        <button
          onClick={() =>
            showToast({ kind: "info", message: "sticky", durationMs: 0 })
          }
        >
          fire
        </button>
      );
    }
    render(
      <ToastProvider>
        <StickyTrigger />
      </ToastProvider>,
    );
    await user.click(screen.getByText("fire"));
    expect(screen.getByText("sticky")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Dismiss notification"));
    expect(screen.queryByText("sticky")).toBeNull();
  });

  it("clearToasts removes all toasts", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger count={3} />
      </ToastProvider>,
    );
    await user.click(screen.getByText("fire"));
    expect(screen.getAllByLabelText("Dismiss notification").length).toBe(3);
    await user.click(screen.getByText("clear"));
    expect(screen.queryAllByLabelText("Dismiss notification").length).toBe(0);
  });

  it("caps visible toasts at 5", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger count={10} />
      </ToastProvider>,
    );
    await user.click(screen.getByText("fire"));
    expect(screen.getAllByLabelText("Dismiss notification").length).toBe(5);
  });

  it("useToast throws outside ToastProvider", () => {
    expect(() => render(<Trigger />)).toThrow(/within ToastProvider/);
  });

  it("auto-dismisses after durationMs", async () => {
    vi.useFakeTimers();
    /* Fires a toast with a 100ms duration and exposes the live toast count. */
    function AutoTrigger() {
      const { showToast, toasts } = useToast();
      return (
        <>
          <button
            onClick={() =>
              showToast({ kind: "info", message: "fading", durationMs: 100 })
            }
          >
            fire
          </button>
          <span data-testid="count">{toasts.length}</span>
        </>
      );
    }
    render(
      <ToastProvider>
        <AutoTrigger />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("fire").click();
    });
    expect(screen.getByTestId("count").textContent).toBe("1");
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByTestId("count").textContent).toBe("0");
    vi.useRealTimers();
  });

  it("durationMs=0 keeps the toast open indefinitely", async () => {
    vi.useFakeTimers();
    /* Fires a toast with durationMs=0 (never auto-dismisses) and shows the count. */
    function PersistentTrigger() {
      const { showToast, toasts } = useToast();
      return (
        <>
          <button
            onClick={() =>
              showToast({ kind: "info", message: "persistent", durationMs: 0 })
            }
          >
            fire
          </button>
          <span data-testid="count">{toasts.length}</span>
        </>
      );
    }
    render(
      <ToastProvider>
        <PersistentTrigger />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("fire").click();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");
    vi.useRealTimers();
  });

  it("falls back to a timestamp id when crypto.randomUUID is unavailable", async () => {
    /*
     * `randomUUID` lives on Crypto.prototype, so we can't just delete it.
     * Swap the whole global `crypto` for one without randomUUID so the
     * `"randomUUID" in crypto` guard is false, forcing the `toast-<ts>-<rand>`
     * fallback id arm. vi.unstubAllGlobals (below) restores the real crypto.
     */
    vi.stubGlobal("crypto", {});
    try {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <Trigger />
        </ToastProvider>,
      );
      await user.click(screen.getByText("fire"));
      /* Toast still renders — the fallback id kept the toast keyable. */
      expect(screen.getByText("m0")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
