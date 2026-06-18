import { Router } from "express";
import { searchAll } from "../controllers/search.controller";

/**
 * Express router: search router.
 */
export const searchRouter = Router();
searchRouter.get("/search", searchAll);
