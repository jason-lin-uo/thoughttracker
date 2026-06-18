const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

/**
 * ApiError — thrown by `request` for any non-2xx response. Carries the HTTP
 * `status` (so callers can branch on 403/404/503, as AddCreatorsPage does)
 * and the parsed response `details` body for richer error rendering.
 */
export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * request — the single fetch wrapper every API call funnels through.
 *
 * Prefixes relative paths with `BASE_URL` (absolute `http…` paths pass
 * through untouched), always sends/expects JSON, and parses the body
 * defensively via `safeJson`. On a non-2xx response it digs a human message
 * out of the body (`message`, then `error`, then `HTTP <status>`) and throws
 * an `ApiError` so callers get a typed failure with the status attached.
 *
 * The optional `signal` (forwarded to `fetch`) lets React Query abort an
 * in-flight request when its query is cancelled — e.g. the user changes a
 * filter or navigates away before the previous fetch resolves. Without it,
 * fast filter/nav changes race and a stale response can clobber a newer one.
 *
 * @typeParam T - The expected shape of the successful JSON response.
 * @param path - API path (e.g. "/creators") or an absolute URL.
 * @param init - Standard fetch options; merged over the default JSON headers.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: string }).message)
        : null) ??
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: string }).error)
        : null) ??
      `HTTP ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

/**
 * safeJson — parse a response body as JSON, but never throw. Some endpoints
 * (and proxy/error pages) return plain text; in that case we return the raw
 * string so `request` can still surface it rather than blowing up on a
 * malformed-JSON SyntaxError.
 */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * api — the typed HTTP client used across the app. Thin sugar over `request`:
 * - `get` serializes a params object into a query string, dropping
 * undefined/empty values and URL-encoding keys and values. An optional
 * `AbortSignal` is forwarded so React Query can cancel the request.
 * - `post` JSON-encodes the body (omitting it entirely when undefined) and
 * sets the POST method, while still allowing header overrides (and a
 * `signal`) via `init`.
 */
export const api = {
  get<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ): Promise<T> {
    const query = params
      ? "?" +
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(
            ([k, v]) =>
              `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
          )
          .join("&")
      : "";
    return request<T>(`${path}${query}`, { signal });
  },
  post<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    return request<T>(path, {
      ...init,
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },
};
