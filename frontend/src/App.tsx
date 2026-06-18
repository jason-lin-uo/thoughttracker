import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { LoadingState } from "./components/States";
import { NotFoundPage } from "./pages/NotFoundPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportsPage } from "./pages/ImportsPage";
import { AddCreatorsPage } from "./pages/AddCreatorsPage";
import { ImportJobDetailPage } from "./pages/ImportJobDetailPage";
import { CreatorsPage } from "./pages/CreatorsPage";
import { CreatorOverviewPage } from "./pages/CreatorOverviewPage";
import { VideosPage } from "./pages/VideosPage";
import { VideoDetailPage } from "./pages/VideoDetailPage";
import { TopicsPage } from "./pages/TopicsPage";
import { EvidencePage } from "./pages/EvidencePage";
import { EvidenceDetailPage } from "./pages/EvidenceDetailPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ReportDetailPage } from "./pages/ReportDetailPage";

/*
 * Lazy-load the two pages that import Charts (which transitively pulls
 * in recharts — ~383 KB raw / ~105 KB gzipped, our heaviest dep). The
 * rest of the app loads without paying that cost; users only pay it
 * when they navigate to a topic-analysis or comparison view.
 */
const TopicAnalysisPage = lazy(() =>
  import("./pages/TopicAnalysisPage").then((m) => ({
    default: m.TopicAnalysisPage,
  })),
);
/* Compare is the other recharts consumer, so it gets the same lazy split. */
const ComparePage = lazy(() =>
  import("./pages/ComparePage").then((m) => ({ default: m.ComparePage })),
);

/**
 * App — the root component. Wraps every route in the shared `AppLayout`
 * (header, nav, theme/toast context already mounted above this in
 * `main.tsx`) and defines the React Router route table.
 *
 * The `<Suspense fallback={<LoadingState />}>` boundary backs the two
 * lazy-loaded routes above (TopicAnalysis + Compare) so navigating to one
 * shows the spinner while its recharts chunk downloads, instead of
 * suspending with no fallback. The trailing `path="*"` route is the
 * catch-all 404.
 */
export function App() {
  return (
    <AppLayout>
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/imports" element={<ImportsPage />} />
          <Route path="/add-creators" element={<AddCreatorsPage />} />
          <Route path="/imports/:jobId" element={<ImportJobDetailPage />} />
          <Route path="/creators" element={<CreatorsPage />} />
          <Route
            path="/creators/:creatorId"
            element={<CreatorOverviewPage />}
          />
          <Route
            path="/creators/:creatorId/topics/:topicId"
            element={<TopicAnalysisPage />}
          />
          <Route path="/videos" element={<VideosPage />} />
          <Route path="/videos/:videoId" element={<VideoDetailPage />} />
          <Route path="/topics" element={<TopicsPage />} />
          <Route path="/evidence" element={<EvidencePage />} />
          <Route
            path="/evidence/:analysisId"
            element={<EvidenceDetailPage />}
          />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:reportId" element={<ReportDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppLayout>
  );
}
