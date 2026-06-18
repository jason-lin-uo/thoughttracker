import { Router } from "express";
import {
  listEvidenceController,
  getEvidenceDetailController,
} from "../controllers/evidence.controller";

/**
 * Express router: evidence router.
 */
export const evidenceRouter = Router();
evidenceRouter.get("/evidence", listEvidenceController);
evidenceRouter.get("/evidence/:analysisId", getEvidenceDetailController);
