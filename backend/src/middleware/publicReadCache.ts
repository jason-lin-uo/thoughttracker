import type { NextFunction, Request, Response } from "express";
import { num } from "../config/env";

interface CacheEntry {
  statusCode: number;
  body: unknown;
  expiresAt: number;
}

const DEFAULT_PUBLIC_READ_CACHE_TTL_MS = 5 * 60 * 1000;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const cache = new Map<string, CacheEntry>();

const CACHEABLE_READ_PATTERNS = [
  /^\/dashboard$/,
  /^\/creators(?:\/compare|\/[^/]+(?:\/overview|\/topics)?)?$/,
  /^\/videos(?:\/[^/]+(?:\/transcript)?)?$/,
  /^\/topics$/,
  /^\/evidence(?:\/[^/]+)?$/,
  /^\/reports(?:\/[^/]+)?$/,
  /^\/charts\/(?:stance-over-time|topic-frequency)$/,
  /^\/search$/,
];

export function clearPublicReadCache(): number {
  const size = cache.size;
  cache.clear();
  return size;
}

export function getPublicReadCacheStats() {
  return { size: cache.size };
}

export function isPublicReadCacheablePath(path: string): boolean {
  const normalized = path.replace(/^\/api(?=\/|$)/, "") || "/";
  return CACHEABLE_READ_PATTERNS.some((pattern) => pattern.test(normalized));
}

function defaultTtlMs(): number {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.PUBLIC_READ_CACHE_TTL_MS === undefined
  ) {
    return 0;
  }
  return num(
    process.env.PUBLIC_READ_CACHE_TTL_MS,
    DEFAULT_PUBLIC_READ_CACHE_TTL_MS,
  );
}

export function publicReadCache(ttlMs = defaultTtlMs()) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (ttlMs <= 0) return next();

    const method = req.method.toUpperCase();
    if (MUTATING_METHODS.has(method)) {
      res.once("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          clearPublicReadCache();
        }
      });
      return next();
    }

    if (method !== "GET" || !isPublicReadCacheablePath(req.path)) {
      return next();
    }

    const key = req.originalUrl;
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && hit.expiresAt > now) {
      res.setHeader("X-Read-Cache", "HIT");
      res.status(hit.statusCode).json(hit.body);
      return;
    }
    if (hit) cache.delete(key);

    res.setHeader("X-Read-Cache", "MISS");
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(key, {
          statusCode: res.statusCode,
          body,
          expiresAt: Date.now() + ttlMs,
        });
      }
      return originalJson(body);
    }) as Response["json"];
    next();
  };
}
