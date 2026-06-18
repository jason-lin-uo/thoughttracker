/**
 * Middleware-level unit tests. We mount each middleware on a tiny test
 * Express app and drive it with supertest to verify behavior without
 * needing the full backend up.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { requestIdAndLogger, httpLogger } from "../src/middleware/requestId";
import { createTimeoutTracker } from "./testHelpers";
import { requestTimeout } from "../src/middleware/timeout";
import { errorHandler } from "../src/middleware/errorHandler";
import {
  isCreatorOnboardingPinRequired,
  requireCreatorOnboardingPin,
} from "../src/middleware/adminPin";
import {
  idempotencyMiddleware,
  resetIdempotencyStoreForTests,
} from "../src/middleware/idempotency";
import { HttpError, NotFoundError, BadRequestError } from "../src/utils/errors";
import { z } from "zod";
import { Prisma } from "@prisma/client";

/* Builds a bare Express app wired with the request-id and HTTP logging middleware under test. */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdAndLogger);
  app.use(httpLogger as unknown as express.RequestHandler);
  return app;
}

describe("requestIdAndLogger", () => {
  it("attaches req.id and echoes X-Request-Id", async () => {
    const app = makeApp();
    app.get("/x", (req: Request, res: Response) => {
      res.json({ id: req.id });
    });
    const r = await request(app).get("/x");
    expect(r.status).toBe(200);
    expect(r.headers["x-request-id"]).toBeTruthy();
    expect(r.body.id).toBe(r.headers["x-request-id"]);
  });

  it("honors a valid incoming X-Request-Id", async () => {
    const app = makeApp();
    app.get("/x", (req: Request, res: Response) => {
      res.json({ id: req.id });
    });
    const r = await request(app).get("/x").set("X-Request-Id", "abc-12345678");
    expect(r.body.id).toBe("abc-12345678");
  });

  it("generates a new id when the incoming one is invalid format", async () => {
    const app = makeApp();
    app.get("/x", (req: Request, res: Response) => {
      res.json({ id: req.id });
    });
    const r = await request(app).get("/x").set("X-Request-Id", "@@@");
    expect(r.body.id).not.toBe("@@@");
  });
});

describe("requestTimeout", () => {
  /*
   * Late-firing setTimeouts in these tests can call res.json() AFTER
   * the timeout middleware already 503'd — that throws "Cannot set
   * headers after they are sent" as an unhandled exception. The
   * shared sink in `testHelpers.ts` tracks the handles so afterEach
   * can clear them between tests.
   */
  const timers = createTimeoutTracker();
  afterEach(() => timers.clear());

  it("returns 503 with structured shape after timeout on a slow GET", async () => {
    const app = makeApp();
    app.use(requestTimeout(80));
    app.get("/slow", (_req, res) => {
      timers.add(setTimeout(() => res.json({ ok: true }), 500));
    });
    const r = await request(app).get("/slow");
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("REQUEST_TIMEOUT");
    expect(r.body.message).toMatch(/exceeded/);
  });

  it("skips non-GET methods", async () => {
    const app = makeApp();
    app.use(requestTimeout(50));
    app.post("/slow", (_req, res) => {
      timers.add(setTimeout(() => res.json({ ok: true }), 200));
    });
    const r = await request(app).post("/slow").send({});
    expect(r.status).toBe(200);
  });

  it("does not fire when the handler responds fast", async () => {
    const app = makeApp();
    app.use(requestTimeout(500));
    app.get("/fast", (_req, res) => res.json({ ok: true }));
    const r = await request(app).get("/fast");
    expect(r.status).toBe(200);
  });
});

describe("errorHandler", () => {
  it("HttpError → structured response with code + message + requestId", async () => {
    const app = makeApp();
    app.get("/boom", (_req, _res, next) =>
      next(new HttpError(418, "INTERNAL_ERROR", "teapot")),
    );
    app.use(errorHandler);
    const r = await request(app).get("/boom");
    expect(r.status).toBe(418);
    expect(r.body).toMatchObject({
      error: "INTERNAL_ERROR",
      message: "teapot",
    });
    expect(r.body.requestId).toBeTruthy();
  });

  it("BadRequestError surfaces details", async () => {
    const app = makeApp();
    app.get("/bad", (_req, _res, next) =>
      next(new BadRequestError("nope", { field: "x" })),
    );
    app.use(errorHandler);
    const r = await request(app).get("/bad");
    expect(r.status).toBe(400);
    expect(r.body.details).toEqual({ field: "x" });
  });

  it("NotFoundError → 404 NOT_FOUND", async () => {
    const app = makeApp();
    app.get("/nf", (_req, _res, next) => next(new NotFoundError()));
    app.use(errorHandler);
    const r = await request(app).get("/nf");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("NOT_FOUND");
  });

  it("generic Error → 500 INTERNAL_ERROR", async () => {
    const app = makeApp();
    app.get("/oops", () => {
      throw new Error("kapow");
    });
    app.use(errorHandler);
    const r = await request(app).get("/oops");
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("INTERNAL_ERROR");
  });

  it("ZodError → 422 VALIDATION_ERROR with flattened details", async () => {
    const app = makeApp();
    app.get("/zod", (_req, _res, next) => {
      const parsed = z.object({ name: z.string() }).safeParse({ name: 123 });
      if (!parsed.success) return next(parsed.error);
      return next();
    });
    app.use(errorHandler);
    const r = await request(app).get("/zod");
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("VALIDATION_ERROR");
    expect(r.body.details).toBeTruthy();
  });

  it("Prisma P2025 (record not found) → 404 NOT_FOUND", async () => {
    const app = makeApp();
    app.get("/p2025", (_req, _res, next) =>
      next(
        new Prisma.PrismaClientKnownRequestError("not found", {
          code: "P2025",
          clientVersion: "5.x",
        }),
      ),
    );
    app.use(errorHandler);
    const r = await request(app).get("/p2025");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("NOT_FOUND");
  });

  it("Prisma P2002 (unique violation) → 409 CONFLICT", async () => {
    const app = makeApp();
    app.get("/p2002", (_req, _res, next) =>
      next(
        new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "5.x",
        }),
      ),
    );
    app.use(errorHandler);
    const r = await request(app).get("/p2002");
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("CONFLICT");
  });

  it("Prisma error with an other code falls through to 500", async () => {
    const app = makeApp();
    app.get("/p2003", (_req, _res, next) =>
      next(
        new Prisma.PrismaClientKnownRequestError("fk", {
          code: "P2003",
          clientVersion: "5.x",
        }),
      ),
    );
    app.use(errorHandler);
    const r = await request(app).get("/p2003");
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("INTERNAL_ERROR");
  });
});

describe("adminPin", () => {
  it("reports whether creator onboarding requires a configured PIN", () => {
    const previous = process.env.ADMIN_ONBOARDING_PIN;
    const previousDemoMode = process.env.DEMO_MODE;
    try {
      delete process.env.ADMIN_ONBOARDING_PIN;
      delete process.env.DEMO_MODE;
      expect(isCreatorOnboardingPinRequired()).toBe(false);

      process.env.ADMIN_ONBOARDING_PIN = " 2468 ";
      expect(isCreatorOnboardingPinRequired()).toBe(true);

      delete process.env.ADMIN_ONBOARDING_PIN;
      process.env.DEMO_MODE = "true";
      expect(isCreatorOnboardingPinRequired()).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.ADMIN_ONBOARDING_PIN;
      } else {
        process.env.ADMIN_ONBOARDING_PIN = previous;
      }
      if (previousDemoMode === undefined) {
        delete process.env.DEMO_MODE;
      } else {
        process.env.DEMO_MODE = previousDemoMode;
      }
    }
  });

  it("fails closed in demo mode when the owner PIN is not configured", async () => {
    const previous = process.env.ADMIN_ONBOARDING_PIN;
    const previousDemoMode = process.env.DEMO_MODE;
    try {
      delete process.env.ADMIN_ONBOARDING_PIN;
      process.env.DEMO_MODE = "true";
      const app = makeApp();
      app.post("/owner", requireCreatorOnboardingPin, (_req, res) =>
        res.json({ ok: true }),
      );
      app.use(errorHandler);

      const response = await request(app).post("/owner").send({});

      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/not configured/);
    } finally {
      if (previous === undefined) {
        delete process.env.ADMIN_ONBOARDING_PIN;
      } else {
        process.env.ADMIN_ONBOARDING_PIN = previous;
      }
      if (previousDemoMode === undefined) {
        delete process.env.DEMO_MODE;
      } else {
        process.env.DEMO_MODE = previousDemoMode;
      }
    }
  });

  it("fails closed in demo mode when the configured PIN is too short (min-length guard)", async () => {
    const previous = process.env.ADMIN_ONBOARDING_PIN;
    const previousDemoMode = process.env.DEMO_MODE;
    try {
      /*
       * A 3-char PIN is below MIN_ADMIN_PIN_LENGTH (4): treated as NOT securely
       * configured, so even the correct value must not authorize in demo mode.
       */
      process.env.ADMIN_ONBOARDING_PIN = "123";
      process.env.DEMO_MODE = "true";
      /*
       * A too-short PIN is not "required" because it isn't securely configured
       * — but DEMO_MODE still forces the gate on (fail closed).
       */
      expect(isCreatorOnboardingPinRequired()).toBe(true);
      const app = makeApp();
      app.post("/owner", requireCreatorOnboardingPin, (_req, res) =>
        res.json({ ok: true }),
      );
      app.use(errorHandler);

      const response = await request(app)
        .post("/owner")
        .set("X-Admin-Pin", "123")
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/too short/);
    } finally {
      if (previous === undefined) {
        delete process.env.ADMIN_ONBOARDING_PIN;
      } else {
        process.env.ADMIN_ONBOARDING_PIN = previous;
      }
      if (previousDemoMode === undefined) {
        delete process.env.DEMO_MODE;
      } else {
        process.env.DEMO_MODE = previousDemoMode;
      }
    }
  });
});

describe("idempotencyMiddleware", () => {
  beforeEach(() => {
    resetIdempotencyStoreForTests();
  });

  it("first POST executes; second with same key replays cached body", async () => {
    const app = makeApp();
    app.use(idempotencyMiddleware);
    let counter = 0;
    app.post("/x", (_req, res) => {
      counter += 1;
      res.status(201).json({ counter });
    });
    const r1 = await request(app)
      .post("/x")
      .set("Idempotency-Key", "key-1")
      .send({});
    const r2 = await request(app)
      .post("/x")
      .set("Idempotency-Key", "key-1")
      .send({});
    expect(r1.body.counter).toBe(1);
    expect(r2.body.counter).toBe(1);
    expect(r2.headers["idempotent-replay"]).toBe("true");
    expect(counter).toBe(1);
  });

  it("requests without Idempotency-Key always execute", async () => {
    const app = makeApp();
    app.use(idempotencyMiddleware);
    let counter = 0;
    app.post("/x", (_req, res) => {
      counter += 1;
      res.json({ counter });
    });
    await request(app).post("/x").send({});
    await request(app).post("/x").send({});
    expect(counter).toBe(2);
  });

  it("GETs are never deduplicated", async () => {
    const app = makeApp();
    app.use(idempotencyMiddleware);
    let counter = 0;
    app.get("/x", (_req, res) => {
      counter += 1;
      res.json({ counter });
    });
    await request(app).get("/x").set("Idempotency-Key", "k");
    await request(app).get("/x").set("Idempotency-Key", "k");
    expect(counter).toBe(2);
  });

  it("does not cache admin-gated creator onboarding mutations", async () => {
    const app = makeApp();
    app.use(idempotencyMiddleware);
    let counter = 0;
    app.post("/api/import-jobs/youtube-channel", (_req, res) => {
      counter += 1;
      res.status(202).json({ counter });
    });

    const r1 = await request(app)
      .post("/api/import-jobs/youtube-channel")
      .set("Idempotency-Key", "owner-action")
      .send({});
    const r2 = await request(app)
      .post("/api/import-jobs/youtube-channel")
      .set("Idempotency-Key", "owner-action")
      .send({});

    expect(r1.body.counter).toBe(1);
    expect(r2.body.counter).toBe(2);
    expect(r2.headers["idempotent-replay"]).toBeUndefined();
    expect(counter).toBe(2);
  });

  /*
   * The other admin-gated mutations (topic create, creator/-topic report
   * generation) must likewise never be served from the idempotency cache, or a
   * replayed key could return a cached body in front of their requireAdmin
   * check. Mount-relative so req.path is `/topics`, `/reports/creator/...`.
   */
  for (const [name, path] of [
    ["create topic", "/topics"],
    ["generate creator report", "/reports/creator/c1/generate"],
    ["generate creator-topic report", "/reports/creator/c1/topic/t1/generate"],
  ] as const) {
    it(`does not cache admin-gated mutation: ${name}`, async () => {
      const app = makeApp();
      const router = express.Router();
      let counter = 0;
      router.use(idempotencyMiddleware);
      router.post(path, (_req, res) => {
        counter += 1;
        res.status(202).json({ counter });
      });
      app.use("/api", router);

      const r1 = await request(app)
        .post(`/api${path}`)
        .set("Idempotency-Key", "k")
        .send({});
      const r2 = await request(app)
        .post(`/api${path}`)
        .set("Idempotency-Key", "k")
        .send({});

      expect(r1.body.counter).toBe(1);
      expect(r2.body.counter).toBe(2);
      expect(r2.headers["idempotent-replay"]).toBeUndefined();
      expect(counter).toBe(2);
    });
  }

  it("does not cache a pin-gated mutation when mounted at /api (mount-relative path)", async () => {
    /*
     * Mount the middleware under /api so req.path is mount-RELATIVE
     * (`/creator-onboarding/run`) — this is the H1 case the guard must match
     * on req.path directly, not just originalUrl.
     */
    const app = makeApp();
    const router = express.Router();
    let counter = 0;
    router.use(idempotencyMiddleware);
    router.post("/creator-onboarding/run", (_req, res) => {
      counter += 1;
      res.status(202).json({ counter });
    });
    app.use("/api", router);

    const r1 = await request(app)
      .post("/api/creator-onboarding/run")
      .set("Idempotency-Key", "owner-run")
      .send({});
    const r2 = await request(app)
      .post("/api/creator-onboarding/run")
      .set("Idempotency-Key", "owner-run")
      .send({});

    expect(r1.body.counter).toBe(1);
    expect(r2.body.counter).toBe(2);
    expect(counter).toBe(2);
  });

  it("different keys do not collide", async () => {
    const app = makeApp();
    app.use(idempotencyMiddleware);
    let counter = 0;
    app.post("/x", (_req, res) => {
      counter += 1;
      res.json({ counter });
    });
    await request(app).post("/x").set("Idempotency-Key", "a").send({});
    await request(app).post("/x").set("Idempotency-Key", "b").send({});
    expect(counter).toBe(2);
  });

  it("different paths with same key do not collide", async () => {
    const app = makeApp();
    app.use(idempotencyMiddleware);
    let aCount = 0;
    let bCount = 0;
    app.post("/a", (_req, res) => {
      aCount += 1;
      res.json({ aCount });
    });
    app.post("/b", (_req, res) => {
      bCount += 1;
      res.json({ bCount });
    });
    await request(app).post("/a").set("Idempotency-Key", "k").send({});
    await request(app).post("/b").set("Idempotency-Key", "k").send({});
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);
  });
});
