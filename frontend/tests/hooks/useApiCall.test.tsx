import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  act,
  renderHook,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../../src/toast/ToastProvider";
import { useToast } from "../../src/toast/toastContext";
import { useApiCall } from "../../src/hooks/useApiCall";

/* renderHook wrapper providing a fresh react-query client + ToastProvider. */
function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

describe("useApiCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toasts success message + calls onSuccess after a successful call", async () => {
    /* Stub api fn that resolves with a payload to exercise the success path. */
    const fn = vi.fn(async () => ({ id: "ok" }));
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () =>
        useApiCall(fn, {
          successMessage: "All good",
          successTitle: "Done",
          onSuccess,
        }),
      { wrapper },
    );

    act(() => {
      result.current.run(undefined as void);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fn).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith({ id: "ok" });
    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("toasts error message + calls onError after a failed call", async () => {
    /* Stub api fn that rejects, to exercise the error/onError path. */
    const fn = vi.fn(async () => {
      throw new Error("nope");
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useApiCall(fn, { onError }), {
      wrapper,
    });

    act(() => {
      result.current.run(undefined as void);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(screen.getByText("nope")).toBeInTheDocument();
  });

  it("suppresses error toast when suppressErrorToast=true", async () => {
    /* Rejecting stub used to verify suppressErrorToast hides the toast. */
    const fn = vi.fn(async () => {
      throw new Error("hidden");
    });
    const { result } = renderHook(
      () => useApiCall(fn, { suppressErrorToast: true }),
      { wrapper },
    );

    act(() => {
      result.current.run(undefined as void);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(screen.queryByText("hidden")).not.toBeInTheDocument();
  });

  it("omits success toast when successMessage is undefined", async () => {
    /* Resolving stub with no successMessage configured, so no toast appears. */
    const fn = vi.fn(async () => "silent");
    const { result } = renderHook(() => useApiCall(fn), { wrapper });

    act(() => {
      result.current.run(undefined as void);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    /* No toast should be visible. */
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses errorMessage override when provided", async () => {
    /* Rejecting stub whose error text is overridden by errorMessage. */
    const fn = vi.fn(async () => {
      throw new Error("ignored");
    });
    const { result } = renderHook(
      () =>
        useApiCall(fn, {
          errorMessage: "custom msg",
          errorTitle: "Custom title",
        }),
      { wrapper },
    );

    act(() => {
      result.current.run(undefined as void);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(screen.getByText("custom msg")).toBeInTheDocument();
    expect(screen.getByText("Custom title")).toBeInTheDocument();
  });

  it("reset() clears mutation state", async () => {
    /* Resolving stub used to verify reset() clears mutation state. */
    const fn = vi.fn(async () => "x");
    const { result } = renderHook(() => useApiCall(fn), { wrapper });

    act(() => {
      result.current.run(undefined as void);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    act(() => {
      result.current.reset();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(false));
    expect(result.current.data).toBeUndefined();
  });

  it("supports a custom argument in run()", async () => {
    /* Stub that doubles its argument, verifying run() forwards custom args. */
    const fn = vi.fn(async (n: number) => n * 2);
    const { result } = renderHook(() => useApiCall<number, number>(fn), {
      wrapper,
    });

    act(() => {
      result.current.run(21);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(42);
  });

  it("integrates with a button click in a real component", async () => {
    const user = userEvent.setup();
    /* Resolving stub driven through a real button-click integration. */
    const fn = vi.fn(async () => "ok");

    /* Button that invokes the hook's run() and reflects its pending state. */
    function Trigger() {
      const c = useApiCall(fn, { successMessage: "done" });
      return (
        <button type="button" onClick={() => c.run(undefined as void)}>
          {c.isPending ? "pending" : "go"}
        </button>
      );
    }
    /* Wrapper that subscribes to toasts so the success toast renders. */
    function Stage() {
      /* Read the toasts so we can assert a toast appears. */
      useToast();
      return <Trigger />;
    }
    render(<Stage />, { wrapper });

    await user.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(fn).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());
  });
});
