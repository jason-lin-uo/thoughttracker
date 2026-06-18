import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/lib/api";
import {
  prefetchCommonRouteData,
  prefetchRouteData,
} from "../../src/lib/routePrefetch";

vi.mock("../../src/lib/api", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ items: [], totalPages: 1 })),
  },
}));

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

async function callsAfterPrefetch(action: (client: QueryClient) => void) {
  const client = makeClient();
  action(client);
  await vi.waitFor(() => expect(api.get).toHaveBeenCalled());
  return vi.mocked(api.get).mock.calls;
}

describe("route prefetching", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockClear();
  });

  it("prefetches the dashboard route", async () => {
    const calls = await callsAfterPrefetch((client) =>
      prefetchRouteData(client, "/"),
    );

    expect(calls).toContainEqual(["/dashboard"]);
  });

  it("prefetches creator and topic index routes", async () => {
    const creatorCalls = await callsAfterPrefetch((client) =>
      prefetchRouteData(client, "/creators"),
    );
    expect(creatorCalls).toContainEqual(["/creators", { search: "" }]);
    expect(creatorCalls).toContainEqual(["/creators"]);

    vi.mocked(api.get).mockClear();
    const topicCalls = await callsAfterPrefetch((client) =>
      prefetchRouteData(client, "/topics"),
    );
    expect(topicCalls).toContainEqual(["/topics"]);
  });

  it("prefetches first-page list routes with their filter data", async () => {
    const calls = await callsAfterPrefetch((client) =>
      prefetchRouteData(client, "/videos"),
    );

    expect(calls).toContainEqual(["/creators", { search: "" }]);
    expect(calls).toContainEqual(["/topics"]);
    expect(calls).toContainEqual(["/videos", { page: 1, pageSize: 24 }]);
  });

  it("prefetches evidence and reports first pages", async () => {
    const evidenceCalls = await callsAfterPrefetch((client) =>
      prefetchRouteData(client, "/evidence"),
    );
    expect(evidenceCalls).toContainEqual([
      "/evidence",
      { page: 1, pageSize: 12 },
    ]);

    vi.mocked(api.get).mockClear();
    const reportCalls = await callsAfterPrefetch((client) =>
      prefetchRouteData(client, "/reports"),
    );
    expect(reportCalls).toContainEqual([
      "/reports",
      { sort: "date_desc", page: 1, pageSize: 12 },
    ]);
  });

  it("prefetches the common warmup set and ignores unknown routes", async () => {
    const calls = await callsAfterPrefetch((client) =>
      prefetchCommonRouteData(client),
    );
    expect(calls.some(([path]) => path === "/reports")).toBe(true);
    expect(calls.some(([path]) => path === "/videos")).toBe(true);

    vi.mocked(api.get).mockClear();
    prefetchRouteData(makeClient(), "/imports");
    expect(api.get).not.toHaveBeenCalled();
  });
});
