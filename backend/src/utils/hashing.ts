import crypto from "crypto";

/**
 * Hashing helpers used for cache keys and content fingerprints.
 *
 * We use SHA-256 because some inputs can include transcript text or prompt
 * material; collision resistance matters more than shaving a few characters.
 */

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Collapse a variadic list of inputs into a stable cache key.
 *
 * The full 64-character digest is persisted as `AnalysisRun.inputHash`, so it
 * should remain long enough to make accidental collisions negligible.
 */
export function inputHash(
  ...parts: Array<string | number | object | undefined>
): string {
  const normalized = parts
    .map((part) =>
      typeof part === "object" ? JSON.stringify(part) : String(part ?? ""),
    )
    .join("::");
  return sha256(normalized);
}
