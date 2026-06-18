/**
 * useFilters — shared filter-state hook for the paginated list pages
 * (VideosPage, EvidencePage).
 *
 * Both pages held an identical `useState` + `update()` pair: a flat object
 * of filter values plus a single-field setter that resets `page` to 1 on
 * any change except a `page` change itself. That logic was copy-pasted in
 * two files (drift risk); this hook is the single source of truth.
 *
 * The reset-to-page-1 rule exists because a page index is meaningless
 * against a freshly filtered result set — e.g. you can't stay on page 3
 * after narrowing to a creator with only one page of results.
 */

import { useState } from "react";

/** Any filter object carried by a list page; must include a numeric `page`. */
type FilterState = { page: number } & Record<string, unknown>;

/**
 * Hold a flat filter object plus a type-safe single-field updater.
 *
 * @typeParam T - The concrete filter-state shape (must include `page: number`).
 * @param initial - The initial filter values.
 * @returns A tuple `[filters, update]` where `update(key, value)` sets one
 * field and resets `page` to 1 unless the changed key is `page`.
 */
export function useFilters<T extends FilterState>(
  initial: T,
): [T, <K extends keyof T>(key: K, value: T[K]) => void] {
  const [filters, setFilters] = useState<T>(initial);

  /* Set one filter field; reset page→1 on any change other than page itself. */
  function update<K extends keyof T>(key: K, value: T[K]) {
    setFilters((f) => ({
      ...f,
      [key]: value,
      page: key === "page" ? (value as number) : 1,
    }));
  }

  return [filters, update];
}
