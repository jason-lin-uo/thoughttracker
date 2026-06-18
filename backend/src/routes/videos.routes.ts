import { Router } from "express";
import { listVideos, getVideo } from "../controllers/videos.controller";

/**
 * Express router: videos router.
 */
export const videosRouter = Router();
videosRouter.get("/videos", listVideos);
videosRouter.get("/videos/:videoId", getVideo);
