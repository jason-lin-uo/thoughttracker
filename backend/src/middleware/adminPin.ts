import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/errors";

const ADMIN_PIN_HEADER = "x-admin-pin";

/**
 * Minimum acceptable length for a configured admin PIN.
 *
 * A 1–3 character PIN is trivially brute-forced (the gate is the ONLY control
 * on every destructive mutation), so a PIN below this length is treated as
 * "not securely configured" rather than a usable secret. We don't silently
 * accept it: see `isAdminPinSecurelyConfigured` / the gate, which fail CLOSED
 * in production/demo when the configured PIN is too short. 4 matches the
 * minimum the onboarding UI advertises and keeps the demo's example PINs valid.
 */
export const MIN_ADMIN_PIN_LENGTH = 4;

/**
 * pinsMatch — compare a provided PIN against the expected PIN in
 * constant time to avoid leaking length/content via a timing side
 * channel.
 *
 * Both sides are hashed to a fixed-length SHA-256 digest before being
 * handed to `crypto.timingSafeEqual`. Because the digests are always
 * 32 bytes, there is no length-mismatch branch (`timingSafeEqual`
 * throws on unequal lengths), so the comparison stays a single code
 * path regardless of input.
 */
function pinsMatch(provided: string, expected: string): boolean {
  const providedDigest = crypto.createHash("sha256").update(provided).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * configuredAdminPin — read the admin onboarding PIN from the
 * environment, trimmed of surrounding whitespace.
 *
 * Returns an empty string when `ADMIN_ONBOARDING_PIN` is unset or blank,
 * which callers treat as "no PIN configured".
 */
function configuredAdminPin(): string {
  return (process.env.ADMIN_ONBOARDING_PIN ?? "").trim();
}

/**
 * shouldFailClosedWithoutPin — decide whether a missing/blank PIN should
 * deny access (fail closed) rather than allow it (fail open).
 *
 * In production or demo mode we fail closed so that a misconfigured
 * deployment (no PIN set) cannot accidentally expose the creator
 * onboarding endpoints; in local dev it stays open for convenience.
 */
function shouldFailClosedWithoutPin(): boolean {
  return (
    process.env.NODE_ENV === "production" || process.env.DEMO_MODE === "true"
  );
}

/**
 * isAdminPinSecurelyConfigured — true only when a configured PIN meets the
 * minimum-length bar. A configured-but-too-short PIN is NOT a usable secret;
 * the gate treats it the same as "no PIN configured" (fail closed in
 * production/demo, open in dev) so a weak value can never actually authorize.
 */
function isAdminPinSecurelyConfigured(): boolean {
  return configuredAdminPin().length >= MIN_ADMIN_PIN_LENGTH;
}

/**
 * isCreatorOnboardingPinRequired — report whether the creator onboarding
 * routes are PIN-gated under the current configuration.
 *
 * True when a securely-configured admin PIN exists, OR when we fail closed
 * without one (production/demo). Exposed so callers (e.g. config/status
 * endpoints or the UI) can tell clients that a PIN header is expected.
 */
export function isCreatorOnboardingPinRequired(): boolean {
  return isAdminPinSecurelyConfigured() || shouldFailClosedWithoutPin();
}

/**
 * requireCreatorOnboardingPin — Express middleware that gates creator
 * onboarding endpoints behind the `x-admin-pin` header.
 *
 * Behavior:
 * - No PIN configured: in production/demo, fail closed with 403 so a
 * misconfigured deploy never leaves the endpoint open; in local dev,
 * pass through (`next()`) to keep the demo frictionless.
 * - PIN configured: compare the provided `x-admin-pin` header (trimmed)
 * against the expected value using a constant-time comparison and only
 * call `next()` on an exact match; otherwise reject with 403.
 */
export function requireCreatorOnboardingPin(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const expected = configuredAdminPin();
  /*
   * A missing OR too-short PIN is "not securely configured": never authorize on
   * it. Fail closed in production/demo (403), pass through in local dev.
   */
  if (!isAdminPinSecurelyConfigured()) {
    if (shouldFailClosedWithoutPin()) {
      const reason = expected
        ? `Admin PIN is too short (min ${MIN_ADMIN_PIN_LENGTH} chars) for creator onboarding`
        : "Admin PIN is not configured for creator onboarding";
      next(new HttpError(403, "FORBIDDEN", reason));
      return;
    }
    next();
    return;
  }

  const provided = String(req.header(ADMIN_PIN_HEADER) ?? "").trim();
  if (pinsMatch(provided, expected)) {
    next();
    return;
  }

  next(new HttpError(403, "FORBIDDEN", "Admin PIN required to add creators"));
}

/**
 * requireAdmin — shared admin-PIN gate applied to ALL mutating routes
 * (analysis, transcripts, topics, reports, embeddings, imports, onboarding).
 *
 * Identical policy to requireCreatorOnboardingPin — fail OPEN in local dev so
 * the demo runs credential-free, fail CLOSED (403) in production/demo when no
 * PIN is configured, and require an exact constant-time `x-admin-pin` match
 * when a PIN is set. Defined as the canonical name so every destructive POST
 * shares one authorization control rather than leaving most of them
 * unauthenticated (the prior state where only import/onboarding were gated).
 */
export const requireAdmin = requireCreatorOnboardingPin;
