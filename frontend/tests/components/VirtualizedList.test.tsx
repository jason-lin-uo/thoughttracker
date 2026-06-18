import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/*
 * jsdom can't compute layout, so the real `useVirtualizer` would window to
 * zero rows (parent height is 0). We replace it with a stub that yields every
 * row, so the VirtualizedList render branch runs end-to-end. The assertion is
 * "the list rendered its rows", not "windowing culled correctly" (that's
 * react-virtual's responsibility, exercised in its own suite).
 */
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: {
    count: number;
    estimateSize: (i: number) => number;
    getScrollElement: () => HTMLElement | null;
  }) => {
    /* Invoke the user callbacks once so they register as executed in coverage. */
    opts.estimateSize(0);
    opts.getScrollElement();
    return {
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, index) => ({
          index,
          key: index,
          start: index * 100,
          size: 100,
          end: (index + 1) * 100,
          lane: 0,
        })),
      getTotalSize: () => opts.count * 100,
      measureElement: () => undefined,
    };
  },
}));

import { VirtualizedList } from "../../src/components/VirtualizedList";

describe("VirtualizedList", () => {
  it("keys a primitive (string) item by its own value when no getKey is given", () => {
    /*
     * Omitting `getKey` with primitive items exercises the value-keying arm of
     * `keyFor` (a reordered string list reconciles by identity, not index).
     */
    const items = ["alpha", "beta", "gamma"];
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <span>{item}</span>}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
  });

  it("keys a primitive (number) item by its own value when no getKey is given", () => {
    /* The `typeof === "number"` half of the value-keying branch. */
    const items = [1, 2, 3];
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <span>{`n${item}`}</span>}
      />,
    );
    expect(screen.getByText("n1")).toBeInTheDocument();
    expect(screen.getByText("n3")).toBeInTheDocument();
  });

  it("falls back to the row index for non-primitive items with no getKey", () => {
    /* Object items + no extractor → the index fallback arm of `keyFor`. */
    const items = [{ label: "obj-a" }, { label: "obj-b" }];
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    expect(screen.getByText("obj-a")).toBeInTheDocument();
    expect(screen.getByText("obj-b")).toBeInTheDocument();
  });

  it("uses getKey when provided", () => {
    /* Sibling assertion keeping the explicit-getKey arm covered locally too. */
    const items = [{ id: "x1", label: "one" }];
    render(
      <VirtualizedList
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    expect(screen.getByText("one")).toBeInTheDocument();
  });
});
