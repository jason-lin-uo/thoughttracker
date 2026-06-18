/**
 * Pagination helpers — used by every list endpoint that returns more
 * than a handful of rows (videos, evidence, reports, etc.).
 *
 * Why a shared helper? Without it every controller would re-implement
 * "default page 1, cap pageSize at 100, coerce strings to ints" — and
 * any one of those defaults would drift across endpoints over time.
 * Centralizing it means every list page in the UI has identical
 * pagination behavior.
 */

/**
 * The shape we accept off `req.query`. Both fields are typed as
 * `number | string` because Express's query parser hands us strings,
 * but the helper is also useful from internal callers (background
 * jobs) where the values are already numbers.
 */
export interface PageInput {
  /** 1-indexed page number. */
  page?: number | string;
  /** Page size (rows per page). Capped server-side, see parsePagination. */
  pageSize?: number | string;
}

/**
 * The shape we hand BACK to the client. Both `total` and `totalPages`
 * are included so the UI can render `"Page 2 of 7 · 84 items"` without
 * a second round-trip.
 */
export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * parsePagination — normalize raw `req.query.page` + `req.query.pageSize`
 * into the structured `{ page, pageSize, skip, take }` quad that Prisma
 * accepts directly.
 *
 * Behavior:
 * - Missing / NaN values fall back to `defaults.page` / `defaults.pageSize`.
 * - `pageSize` is clamped to `[1, defaults.maxPageSize]` (default cap 100)
 * so a malicious client can't request `pageSize=10000000` and OOM us.
 * - `page` is clamped to `>= 1` — negative pages don't mean anything
 * and Prisma's `skip` doesn't accept negatives.
 *
 * @param input - raw query input (`req.query`).
 * @param defaults - per-endpoint overrides for page / pageSize / max cap.
 * @returns - structured pagination ready for Prisma:
 * - page, pageSize: echo what we settled on for the response
 * - skip, take: pass directly into `prisma.foo.findMany`
 */
export function parsePagination(
  input: PageInput,
  defaults: { page?: number; pageSize?: number; maxPageSize?: number } = {},
): { page: number; pageSize: number; skip: number; take: number } {
  const defaultPage = defaults.page ?? 1;
  const defaultPageSize = defaults.pageSize ?? 20;
  const maxPageSize = defaults.maxPageSize ?? 100;

  const page = Math.max(
    1,
    Math.floor(Number(input.page ?? defaultPage)) || defaultPage,
  );
  const rawSize =
    Math.floor(Number(input.pageSize ?? defaultPageSize)) || defaultPageSize;
  const pageSize = Math.min(Math.max(1, rawSize), maxPageSize);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

/**
 * buildPageResult — wrap a Prisma findMany result + a separate count
 * into the standardized response envelope.
 *
 * Always returns `totalPages >= 1` (even when `total === 0`) so the UI
 * can render "Page 1 of 1 · 0 items" without a divide-by-zero branch.
 *
 * @param items - the row slice for the current page.
 * @param total - total matching rows (from `prisma.foo.count(...)` ran
 * in parallel with the findMany).
 * @param page - the 1-indexed page number we returned items for.
 * @param pageSize - the resolved page size after clamping.
 * @returns - the envelope ready to JSON-serialize.
 */
export function buildPageResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PageResult<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
