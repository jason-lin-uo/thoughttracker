import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { BadRequestError } from "../utils/errors";
import { validateChannelUrl } from "../services/youtubeImport.service";
import { startCreatorOnboardingPipeline } from "../services/creatorOnboardingPipeline.service";

const CreatorOnboardingRunSchema = z.object({
  channelUrls: z.array(z.string().min(1)).min(1).max(10),
  requestedLimit: z.union([
    z.literal(10),
    z.literal(25),
    z.literal(50),
    z.literal(100),
  ]),
});

/**
 * verifyCreatorOnboardingPin - lightweight endpoint used by the UI's Unlock
 * button. The route is protected by the same admin-PIN middleware as the real
 * onboarding runner, so reaching this handler means the submitted PIN is valid.
 */
export function verifyCreatorOnboardingPin(_req: Request, res: Response) {
  res.json({ ok: true });
}

/**
 * startCreatorOnboardingRun — Express handler that validates a creator
 * onboarding request and launches the (detached) pipeline.
 *
 * Validation: the body must match CreatorOnboardingRunSchema (1–10 non
 * empty channel URLs and a `requestedLimit` of exactly 10/25/50/100),
 * and every URL must additionally pass `validateChannelUrl`; either
 * failure raises a BadRequestError forwarded to the error middleware.
 *
 * Contract: this is an async-start endpoint. startCreatorOnboardingPipeline
 * spawns a detached background process and returns immediately, so the
 * handler responds **202 Accepted** with the run handles (pid, status
 * file path, log dir) rather than waiting for the work to finish — the
 * client is expected to poll those handles for progress.
 */
export function startCreatorOnboardingRun(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = CreatorOnboardingRunSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Invalid request", parsed.error.flatten());
    }
    /*
     * Reject the whole request if any submitted channel URL is malformed,
     * surfacing the first offender so the client can point at it.
     */
    const invalidUrl = parsed.data.channelUrls.find(
      (url) => !validateChannelUrl(url),
    );
    if (invalidUrl) {
      throw new BadRequestError(`Creator URL looks invalid: ${invalidUrl}`);
    }

    const run = startCreatorOnboardingPipeline(parsed.data);
    res.status(202).json(run);
  } catch (err) {
    next(err);
  }
}
