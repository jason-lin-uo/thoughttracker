import { Router } from "express";
import {
  startCreatorOnboardingRun,
  verifyCreatorOnboardingPin,
} from "../controllers/creatorOnboarding.controller";
import { requireCreatorOnboardingPin } from "../middleware/adminPin";

export const creatorOnboardingRouter = Router();

creatorOnboardingRouter.post(
  "/creator-onboarding/verify-pin",
  requireCreatorOnboardingPin,
  verifyCreatorOnboardingPin,
);

creatorOnboardingRouter.post(
  "/creator-onboarding/run",
  requireCreatorOnboardingPin,
  startCreatorOnboardingRun,
);
