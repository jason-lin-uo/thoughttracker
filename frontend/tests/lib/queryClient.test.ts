import { describe, expect, it } from "vitest";
import { keepPreviousData } from "@tanstack/react-query";
import {
  createAppQueryClient,
  DEFAULT_GC_TIME_MS,
  DEFAULT_STALE_TIME_MS,
} from "../../src/lib/queryClient";

describe("createAppQueryClient", () => {
  it("uses a hosted-demo-friendly read cache policy", () => {
    const client = createAppQueryClient();
    const queries = client.getDefaultOptions().queries;

    expect(queries?.retry).toBe(1);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.staleTime).toBe(DEFAULT_STALE_TIME_MS);
    expect(queries?.gcTime).toBe(DEFAULT_GC_TIME_MS);
    expect(queries?.placeholderData).toBe(keepPreviousData);
  });
});
