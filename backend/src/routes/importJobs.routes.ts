import { Router } from "express";
import {
  createImportJob,
  createBulkImportJob,
  listImportJobs,
  getImportJob,
  listImportJobItems,
} from "../controllers/importJobs.controller";
import { requireCreatorOnboardingPin } from "../middleware/adminPin";

/**
 * Router covering every endpoint under `/api/import-jobs/...`.
 *
 * Two POST entry points:
 * - `/youtube-channel` — the classic "paste a channel URL, we fetch
 * metadata + transcripts ourselves" flow.
 * - `/bulk-import` — ingest a folder of pre-fetched transcripts
 * produced by `thoughttracker-ml/scripts/fetch_transcripts.py`.
 * We use this for the demo because YouTube's anonymous caption
 * endpoint now requires a PO token and our Python script
 * (youtube-transcript-api) is the path that still works.
 *
 * GET endpoints are read-only views the ImportsPage UI polls while a
 * job is in flight.
 *
 * The /bulk-import route is declared BEFORE /:jobId so Express doesn't
 * accidentally capture "bulk-import" as a jobId path param.
 */
export const importJobsRouter = Router();

importJobsRouter.post(
  "/import-jobs/youtube-channel",
  requireCreatorOnboardingPin,
  createImportJob,
);
importJobsRouter.post(
  "/import-jobs/bulk-import",
  requireCreatorOnboardingPin,
  createBulkImportJob,
);
importJobsRouter.get("/import-jobs", listImportJobs);
importJobsRouter.get("/import-jobs/:jobId", getImportJob);
importJobsRouter.get("/import-jobs/:jobId/items", listImportJobItems);
