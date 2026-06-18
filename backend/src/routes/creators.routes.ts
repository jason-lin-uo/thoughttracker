import { Router } from "express";
import {
  compareCreators,
  listCreators,
  getCreator,
  getCreatorOverview,
  getCreatorTopics,
} from "../controllers/creators.controller";

/**
 * Express router: creators router.
 */
export const creatorsRouter = Router();
creatorsRouter.get("/creators", listCreators);
/* /creators/compare must precede /creators/:creatorId so it's not captured. */
creatorsRouter.get("/creators/compare", compareCreators);
creatorsRouter.get("/creators/:creatorId", getCreator);
creatorsRouter.get("/creators/:creatorId/overview", getCreatorOverview);
creatorsRouter.get("/creators/:creatorId/topics", getCreatorTopics);
