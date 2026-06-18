import { Router } from "express";
import {
  getVideoTranscript,
  postManualTranscript,
  rechunkTranscript,
} from "../controllers/transcripts.controller";
import { requireAdmin } from "../middleware/adminPin";

/**
 * Express router: transcripts router. The mutating POSTs (manual-transcript
 * injection, re-chunk) are admin-gated by `requireAdmin`. Local development can
 * pass through when no admin PIN is configured; transcript GET is read-only and
 * ungated.
 */
export const transcriptsRouter = Router();
transcriptsRouter.get("/videos/:videoId/transcript", getVideoTranscript);
transcriptsRouter.post(
  "/videos/:videoId/transcript/manual",
  requireAdmin,
  postManualTranscript,
);
transcriptsRouter.post(
  "/videos/:videoId/transcript/rechunk",
  requireAdmin,
  rechunkTranscript,
);
