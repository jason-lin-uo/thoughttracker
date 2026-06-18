/**
 * slugify — convert a human-readable string into a URL-safe slug.
 *
 * Used to mint slugs for Creator and Topic rows. We persist both the
 * original `name` and a derived `slug` so URLs like `/creators/huberman`
 * are stable even if the display name is later edited (renaming a
 * Creator updates `name` but `slug` is the historical identifier).
 *
 * Algorithm:
 * 1. Lowercase. Slugs are case-insensitive by convention.
 * 2. Unicode NFKD normalize. This decomposes composed characters
 * (e.g. "é" → "e" + combining acute accent) so we can strip the
 * accents next.
 * 3. Strip combining diacritical marks (the U+0300..U+036F range,
 * written here as the literal accent characters for readability).
 * 4. Collapse any run of non-[a-z0-9] characters into a single dash.
 * Spaces, underscores, em-dashes, emoji — anything not alphanumeric
 * becomes a dash.
 * 5. Trim leading/trailing dashes that step 4 may have produced.
 * 6. Cap at 96 characters. Long enough for any real name; short
 * enough that the resulting URL stays under most CDN and browser
 * limits even when stacked into a longer path.
 *
 * The function is idempotent: `slugify(slugify(x)) === slugify(x)`.
 *
 * @param input - any human-typed string (display name, title, etc.).
 * @returns a URL-safe slug — lowercase, alphanumeric + dashes only,
 * guaranteed ≤96 chars and NEVER empty: emoji/punctuation-only input
 * (which would otherwise slug to "") falls back to a short hash-based
 * slug so two such names don't collide on an empty-string slug.
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 96)
    /*
     * Trim AFTER the length cap: trimming before could re-introduce a trailing
     * dash when the 96-char cut lands mid-separator (e.g. "…long-name-" → cut →
     * "…long-name-"), leaving an ugly/again-non-idempotent trailing dash.
     */
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  /*
   * Input had no slug-able characters (e.g. all emoji/punctuation). Derive a
   * deterministic, collision-resistant fallback from the raw input so distinct
   * names yield distinct slugs instead of all upserting onto "".
   */
  return `item-${fnv1aHex(input)}`;
}

/**
 * fnv1aHex — tiny deterministic FNV-1a hash of a string as 8 hex chars. Used
 * only as the empty-slug fallback seed; not security-sensitive.
 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
