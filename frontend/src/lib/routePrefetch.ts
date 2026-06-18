import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  ChunkTopicAnalysis,
  CreatorListItem,
  DashboardResponse,
  Page,
  Report,
  Topic,
  Video,
} from "./types";

const REPORTS_PAGE_SIZE = 12;
const VIDEOS_PAGE_SIZE = 24;
const EVIDENCE_PAGE_SIZE = 12;

/**
 * prefetchRouteData warms the same React Query keys that the destination page
 * will request. Hover/focus on the nav can therefore spend the network round
 * trip before the user clicks, making Render/Neon latency feel less abrupt.
 */
export function prefetchRouteData(queryClient: QueryClient, to: string) {
  const path = to.split("?")[0];
  switch (path) {
    case "/":
      void queryClient.prefetchQuery({
        queryKey: ["dashboard"],
        queryFn: () => api.get<DashboardResponse>("/dashboard"),
      });
      break;
    case "/creators":
      prefetchCreators(queryClient);
      break;
    case "/topics":
      prefetchTopics(queryClient);
      break;
    case "/videos":
      prefetchFilters(queryClient);
      void queryClient.prefetchQuery({
        queryKey: ["videos", "", "", "", "", "", "", "", "", 1],
        queryFn: () =>
          api.get<Page<Video>>("/videos", {
            page: 1,
            pageSize: VIDEOS_PAGE_SIZE,
          }),
      });
      break;
    case "/evidence":
      prefetchFilters(queryClient);
      void queryClient.prefetchQuery({
        queryKey: ["evidence", "", "", "", "", "", "", "", 1],
        queryFn: () =>
          api.get<Page<ChunkTopicAnalysis>>("/evidence", {
            page: 1,
            pageSize: EVIDENCE_PAGE_SIZE,
          }),
      });
      break;
    case "/reports":
      prefetchFilters(queryClient);
      void queryClient.prefetchQuery({
        queryKey: ["reports", "", "", "", "date_desc", 1],
        queryFn: () =>
          api.get<Page<Report>>("/reports", {
            sort: "date_desc",
            page: 1,
            pageSize: REPORTS_PAGE_SIZE,
          }),
      });
      break;
  }
}

export function prefetchCommonRouteData(queryClient: QueryClient) {
  ["/creators", "/topics", "/reports", "/videos"].forEach((to) =>
    prefetchRouteData(queryClient, to),
  );
}

function prefetchCreators(queryClient: QueryClient) {
  void queryClient.prefetchQuery({
    queryKey: ["creators", ""],
    queryFn: () =>
      api.get<{ items: CreatorListItem[] }>("/creators", { search: "" }),
  });
  void queryClient.prefetchQuery({
    queryKey: ["creators-for-filter"],
    queryFn: () => api.get<{ items: CreatorListItem[] }>("/creators"),
  });
}

function prefetchTopics(queryClient: QueryClient) {
  void queryClient.prefetchQuery({
    queryKey: ["topics-index"],
    queryFn: () => api.get<{ items: Topic[] }>("/topics"),
  });
  void queryClient.prefetchQuery({
    queryKey: ["topics-for-filter"],
    queryFn: () => api.get<{ items: Topic[] }>("/topics"),
  });
}

function prefetchFilters(queryClient: QueryClient) {
  prefetchCreators(queryClient);
  prefetchTopics(queryClient);
}
