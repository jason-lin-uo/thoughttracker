import { keepPreviousData, QueryClient } from "@tanstack/react-query";

export const DEFAULT_STALE_TIME_MS = 2 * 60 * 1000;
export const DEFAULT_GC_TIME_MS = 30 * 60 * 1000;

/**
 * createAppQueryClient centralizes the browser-side data cache policy.
 *
 * The hosted app sits behind Render + Neon, so repeated navigation should
 * reuse fresh-enough reads instead of re-querying on every page hop. Mutations
 * still invalidate their affected keys explicitly, so generated/reset reports
 * update without waiting for these freshness windows to expire.
 */
export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: DEFAULT_STALE_TIME_MS,
        gcTime: DEFAULT_GC_TIME_MS,
        placeholderData: keepPreviousData,
      },
    },
  });
}
