/**
 * Tests for the bulk-import flow:
 * - POST /api/import-jobs/bulk-import endpoint validation
 * - bulkImportJob worker (folder + manifest → DB rows)
 *
 * These are integration tests: they hit the real Express app via
 * supertest and the real Prisma client against the live test
 * Postgres. They write transient transcript files to a tmpdir and
 * clean up after themselves so they don't leak state across runs.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import { buildApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { bulkImportJob } from "../src/jobs/bulkImport.job";
import { jobRunner } from "../src/jobs/jobRunner";

const app = buildApp();

let currentTmpFolder = "";

/* Creates a unique temp directory under the OS tmpdir for a test fixture. */
async function makeTmpFolder(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

interface ManifestEntryInput {
  videoId: string;
  title: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  sourceUrl: string;
  thumbnailUrl?: string | null;
  transcriptPath: string | null;
  status: "saved" | "skipped" | "failed";
  skipReason?: string | null;
}

/* Writes a bulk-import fixture folder: transcript .txt files plus a manifest.json for the given entries. */
async function writeFixtureFolder(
  slug: string,
  entries: Array<ManifestEntryInput & { body?: string }>,
): Promise<string> {
  const folder = await makeTmpFolder(`tt-bulk-${slug}-`);
  /* Write each saved transcript .txt. */
  for (const e of entries) {
    if (e.status === "saved" && e.transcriptPath && e.body) {
      await fs.writeFile(
        path.join(folder, e.transcriptPath),
        `# ${e.title}\n# ${e.sourceUrl}\n\n${e.body}\n`,
      );
    }
  }
  const manifest = {
    creator: {
      name: `Test Bulk ${slug}`,
      slug: `test-bulk-${slug}`,
      channelUrl: `https://www.youtube.com/@${slug}`,
      description: `Auto-generated bulk-import fixture for ${slug}`,
      thumbnailUrl: null,
    },
    entries: entries.map(({ body: _body, ...rest }) => rest),
    writtenAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(folder, "_manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  currentTmpFolder = folder;
  return folder;
}

afterEach(async () => {
  /*
   * Restore any spies (e.g. the jobRunner.enqueue spy in the incremental test)
   * so they can't leak into other suites sharing the single test fork.
   */
  vi.restoreAllMocks();
  /* Clean up: delete the temp folder + the test creators we created. */
  if (currentTmpFolder) {
    await fs
      .rm(currentTmpFolder, { recursive: true, force: true })
      .catch(() => {});
    currentTmpFolder = "";
  }
  await prisma.creator.deleteMany({
    where: { slug: { startsWith: "test-bulk-" } },
  });
});

beforeAll(async () => {
  /*
   * The folderPath bulk-import is now restricted to BULK_IMPORT_ROOT (H2
   * allowlist guard). Point the allowed root at the OS tmpdir so these
   * fixtures (written via os.tmpdir()) pass the containment check; a
   * dedicated test below verifies a path OUTSIDE the root is rejected.
   */
  process.env.BULK_IMPORT_ROOT = os.tmpdir();
  /* sanity check the DB is up. */
  await prisma.creator.findFirst();
});

describe("POST /api/import-jobs/bulk-import — request validation", () => {
  it("requires the configured admin PIN before validating the import payload", async () => {
    const previous = process.env.ADMIN_ONBOARDING_PIN;
    process.env.ADMIN_ONBOARDING_PIN = "2468";
    try {
      const r = await request(app)
        .post("/api/import-jobs/bulk-import")
        .send({});
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("FORBIDDEN");
    } finally {
      if (previous === undefined) {
        delete process.env.ADMIN_ONBOARDING_PIN;
      } else {
        process.env.ADMIN_ONBOARDING_PIN = previous;
      }
    }
  });

  it("rejects an empty body with 400", async () => {
    const r = await request(app).post("/api/import-jobs/bulk-import").send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("BAD_REQUEST");
  });

  it("rejects a folderPath that does not contain a manifest", async () => {
    const empty = await makeTmpFolder("tt-bulk-empty-");
    currentTmpFolder = empty;
    const r = await request(app)
      .post("/api/import-jobs/bulk-import")
      .send({ folderPath: empty });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Manifest not found/);
  });

  it("rejects a folderPath outside the allowed bulk-import root (H2 allowlist) with 400", async () => {
    /*
     * BULK_IMPORT_ROOT is os.tmpdir() in this suite; a path outside it (e.g.
     * /etc) must be rejected before any filesystem access — the LFI guard.
     */
    const r = await request(app)
      .post("/api/import-jobs/bulk-import")
      .send({ folderPath: "/etc" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/allowed bulk-import directory/);
  });

  it("rejects a manifest body that's missing the creator block", async () => {
    const r = await request(app)
      .post("/api/import-jobs/bulk-import")
      .send({
        inline: { manifest: { creator: { name: "" } }, transcripts: {} },
      });
    expect(r.status).toBe(400);
  });

  it("accepts a well-formed folderPath body with 202 + jobId", async () => {
    const folder = await writeFixtureFolder("smoke1", [
      {
        videoId: "abc1",
        title: "Smoke video 1",
        publishedAt: "2026-01-01",
        durationSeconds: 600,
        sourceUrl: "https://www.youtube.com/watch?v=abc1",
        thumbnailUrl: null,
        transcriptPath: "abc1.txt",
        status: "saved",
        body: "Hello world. This is the transcript text for the smoke video. ".repeat(
          20,
        ),
      },
    ]);
    const r = await request(app)
      .post("/api/import-jobs/bulk-import")
      .send({ folderPath: folder });
    expect(r.status).toBe(202);
    expect(typeof r.body.jobId).toBe("string");
    expect(r.body.status).toBe("pending");
  });
});

describe("bulkImportJob — folder ingestion", () => {
  it("ingests a single saved video + creates Creator/Video/Transcript/chunks", async () => {
    const folder = await writeFixtureFolder("single", [
      {
        videoId: "vid-single",
        title: "Single video fixture",
        publishedAt: "2026-02-15",
        durationSeconds: 1234,
        sourceUrl: "https://www.youtube.com/watch?v=vid-single",
        thumbnailUrl: null,
        transcriptPath: "vid-single.txt",
        status: "saved",
        body:
          "We will talk about a topic for a few minutes. " +
          "Here is some content that the chunker can split into pieces. ".repeat(
            50,
          ),
      },
    ]);
    const job = await prisma.importJob.create({
      data: {
        channelUrl: `bulk:${folder}`,
        requestedLimit: 0,
        status: "pending",
      },
    });
    await bulkImportJob(job.id, folder);

    const refreshed = await prisma.importJob.findUnique({
      where: { id: job.id },
    });
    expect(refreshed?.status).toMatch(/completed|completed_with_errors/);

    const creator = await prisma.creator.findUnique({
      where: { slug: "test-bulk-single" },
    });
    expect(creator).not.toBeNull();
    expect(creator?.name).toBe("Test Bulk single");

    const video = await prisma.video.findFirst({
      where: { sourceVideoId: "vid-single" },
      include: {
        transcript: { include: { _count: { select: { chunks: true } } } },
      },
    });
    expect(video).not.toBeNull();
    expect(video?.transcriptStatus).toBe("available");
    expect(video?.transcript?.wordCount).toBeGreaterThan(50);
    expect(video?.transcript?._count.chunks).toBeGreaterThan(0);
  });

  it("records skipped entries as ImportJobItem with transcript_unavailable", async () => {
    const folder = await writeFixtureFolder("skip", [
      {
        videoId: "vid-skipped",
        title: "Short clip",
        publishedAt: "2026-03-01",
        durationSeconds: 30,
        sourceUrl: "https://www.youtube.com/shorts/vid-skipped",
        transcriptPath: null,
        status: "skipped",
        skipReason: "too_short_30s",
      },
    ]);
    const job = await prisma.importJob.create({
      data: {
        channelUrl: `bulk:${folder}`,
        requestedLimit: 0,
        status: "pending",
      },
    });
    await bulkImportJob(job.id, folder);
    const items = await prisma.importJobItem.findMany({
      where: { importJobId: job.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("transcript_unavailable");
    expect(items[0].transcriptStatus).toBe("unavailable");
    expect(items[0].errorMessage).toBe("too_short_30s");
  });

  it("records failed entries as ImportJobItem with status=failed", async () => {
    const folder = await writeFixtureFolder("failed", [
      {
        videoId: "vid-failed",
        title: "Failed fetch",
        publishedAt: null,
        durationSeconds: null,
        sourceUrl: "https://www.youtube.com/watch?v=vid-failed",
        transcriptPath: null,
        status: "failed",
        skipReason: "ip_blocked_persistent",
      },
    ]);
    const job = await prisma.importJob.create({
      data: {
        channelUrl: `bulk:${folder}`,
        requestedLimit: 0,
        status: "pending",
      },
    });
    await bulkImportJob(job.id, folder);
    const items = await prisma.importJobItem.findMany({
      where: { importJobId: job.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("failed");
  });

  it("handles a missing transcript file as transcript_unavailable", async () => {
    const folder = await writeFixtureFolder("missing", [
      {
        videoId: "vid-missing-file",
        title: "Missing file",
        publishedAt: "2026-04-01",
        durationSeconds: 600,
        sourceUrl: "https://www.youtube.com/watch?v=vid-missing-file",
        transcriptPath: "nope.txt" /* we DON'T write this file */,
        status: "saved",
        /* no body — file won't be written */
      },
    ]);
    const job = await prisma.importJob.create({
      data: {
        channelUrl: `bulk:${folder}`,
        requestedLimit: 0,
        status: "pending",
      },
    });
    await bulkImportJob(job.id, folder);
    /* The job records this as a failed item (file read errored). */
    const refreshed = await prisma.importJob.findUnique({
      where: { id: job.id },
    });
    expect(refreshed?.status).toMatch(/completed_with_errors|completed/);
    expect(
      (refreshed?.totalFailed ?? 0) + (refreshed?.totalVideosImported ?? 0),
    ).toBeGreaterThan(0);
  });

  it("bails out with status=failed when the manifest is missing or unreadable", async () => {
    const emptyFolder = await makeTmpFolder("tt-bulk-no-manifest-");
    currentTmpFolder = emptyFolder;
    const job = await prisma.importJob.create({
      data: {
        channelUrl: `bulk:${emptyFolder}`,
        requestedLimit: 0,
        status: "pending",
      },
    });
    await bulkImportJob(job.id, emptyFolder);
    const refreshed = await prisma.importJob.findUnique({
      where: { id: job.id },
    });
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.errorMessage).toMatch(/manifest/i);
  });

  it("bails out with status=failed when the manifest lacks a creator block", async () => {
    const folder = await makeTmpFolder("tt-bulk-no-creator-");
    currentTmpFolder = folder;
    await fs.writeFile(
      path.join(folder, "_manifest.json"),
      JSON.stringify({ entries: [] }),
    );
    const job = await prisma.importJob.create({
      data: {
        channelUrl: `bulk:${folder}`,
        requestedLimit: 0,
        status: "pending",
      },
    });
    await bulkImportJob(job.id, folder);
    const refreshed = await prisma.importJob.findUnique({
      where: { id: job.id },
    });
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.errorMessage).toMatch(/missing_creator/i);
  });

  it("marks the video transcriptStatus=unavailable when the .txt body is empty", async () => {
    /* Build a folder whose .txt file is just the header (title + url) with no body. */
    const folder = await makeTmpFolder("tt-bulk-emptybody-");
    currentTmpFolder = folder;
    await fs.writeFile(
      path.join(folder, "emptybody-1.txt"),
      "# Title only\n# https://example.com/v1\n\n",
    );
    await fs.writeFile(
      path.join(folder, "_manifest.json"),
      JSON.stringify({
        creator: {
          name: "Bulk EmptyBody",
          slug: `test-bulk-emptybody-${Date.now()}`,
        },
        entries: [
          {
            videoId: "emptybody-1",
            title: "Empty body video",
            publishedAt: "2026-01-01",
            durationSeconds: 700,
            sourceUrl: "https://example.com/v1",
            transcriptPath: "emptybody-1.txt",
            status: "saved",
          },
        ],
      }),
    );
    const job = await prisma.importJob.create({
      data: {
        channelUrl: `bulk:${folder}`,
        requestedLimit: 0,
        status: "pending",
      },
    });
    await bulkImportJob(job.id, folder);
    const items = await prisma.importJobItem.findMany({
      where: { importJobId: job.id },
    });
    expect(items[0].transcriptStatus).toBe("unavailable");
  });

  it("is idempotent at the (platform, sourceVideoId) key", async () => {
    const folder = await writeFixtureFolder("idemp", [
      {
        videoId: "vid-idemp",
        title: "Idempotent video",
        publishedAt: "2026-04-15",
        durationSeconds: 800,
        sourceUrl: "https://www.youtube.com/watch?v=vid-idemp",
        transcriptPath: "vid-idemp.txt",
        status: "saved",
        body: "Idempotency check. " + "Some sample words. ".repeat(40),
      },
    ]);
    const job1 = await prisma.importJob.create({
      data: {
        channelUrl: `bulk:${folder}`,
        requestedLimit: 0,
        status: "pending",
      },
    });
    await bulkImportJob(job1.id, folder);
    const job2 = await prisma.importJob.create({
      data: {
        channelUrl: `bulk:${folder}`,
        requestedLimit: 0,
        status: "pending",
      },
    });
    await bulkImportJob(job2.id, folder);
    const videos = await prisma.video.findMany({
      where: { sourceVideoId: "vid-idemp" },
    });
    expect(videos).toHaveLength(1);
  });

  it("incremental refresh: a re-listed already_on_disk video that is already analyzed is NOT re-chunked or re-analyzed", async () => {
    /*
     * Spy on enqueue so no real (ML) analysis runs and we can assert exactly
     * which videos were scheduled for analysis.
     */
    const enqueueSpy = vi
      .spyOn(jobRunner, "enqueue")
      .mockImplementation(() => {});
    try {
      /* --- Run 1: ingest a fresh video → creates creator + video + chunks. --- */
      const folder = await writeFixtureFolder("incr", [
        {
          videoId: "vid-incr",
          title: "Incremental video",
          publishedAt: "2026-06-01",
          durationSeconds: 900,
          sourceUrl: "https://www.youtube.com/watch?v=vid-incr",
          transcriptPath: "vid-incr.txt",
          status: "saved",
          body: "Original transcript body. " + "Sample words here. ".repeat(40),
        },
      ]);
      const job1 = await prisma.importJob.create({
        data: {
          channelUrl: `bulk:${folder}`,
          requestedLimit: 0,
          status: "pending",
        },
      });
      await bulkImportJob(job1.id, folder);

      const created = await prisma.video.findFirst({
        where: { sourceVideoId: "vid-incr" },
        include: { transcript: { include: { chunks: true } } },
      });
      expect(created).not.toBeNull();
      const incrVideoId = created!.id;
      const originalChunkIds = (created!.transcript?.chunks ?? [])
        .map((c) => c.id)
        .sort();
      expect(originalChunkIds.length).toBeGreaterThan(0);
      /* Fresh video WAS scheduled for analysis on run 1. */
      expect(enqueueSpy.mock.calls.map((c) => c[0])).toContain(
        `analyze:${incrVideoId}`,
      );

      /* Simulate that analysis having completed. */
      await prisma.video.update({
        where: { id: incrVideoId },
        data: { analysisStatus: "completed" },
      });

      /* --- Run 2: refresh — re-list vid-incr as already_on_disk + add a new one. --- */
      await fs.writeFile(
        path.join(folder, "vid-new.txt"),
        "# New video\n# https://example.com/new\n\nBrand new transcript body. " +
          "More sample words. ".repeat(40) +
          "\n",
      );
      const manifest2 = {
        creator: {
          name: "Test Bulk incr",
          slug: "test-bulk-incr",
          channelUrl: "https://www.youtube.com/@incr",
          description: "refresh run",
          thumbnailUrl: null,
        },
        entries: [
          {
            videoId: "vid-incr",
            title: "Incremental video",
            publishedAt: "2026-06-01",
            durationSeconds: 900,
            sourceUrl: "https://www.youtube.com/watch?v=vid-incr",
            thumbnailUrl: null,
            transcriptPath: "vid-incr.txt",
            status: "saved",
            skipReason: "already_on_disk",
          },
          {
            videoId: "vid-new",
            title: "New video",
            publishedAt: "2026-06-10",
            durationSeconds: 800,
            sourceUrl: "https://example.com/new",
            thumbnailUrl: null,
            transcriptPath: "vid-new.txt",
            status: "saved",
          },
        ],
        writtenAt: new Date().toISOString(),
      };
      await fs.writeFile(
        path.join(folder, "_manifest.json"),
        JSON.stringify(manifest2, null, 2),
      );

      enqueueSpy.mockClear();
      const job2 = await prisma.importJob.create({
        data: {
          channelUrl: `bulk:${folder}`,
          requestedLimit: 0,
          status: "pending",
        },
      });
      await bulkImportJob(job2.id, folder);

      const newVideo = await prisma.video.findFirst({
        where: { sourceVideoId: "vid-new" },
      });
      expect(newVideo).not.toBeNull();
      const enqueued = enqueueSpy.mock.calls.map((c) => c[0]);
      /* The NEW video was scheduled; the unchanged already-analyzed one was NOT. */
      expect(enqueued).toContain(`analyze:${newVideo!.id}`);
      expect(enqueued).not.toContain(`analyze:${incrVideoId}`);

      /*
       * The unchanged video's chunks were preserved (not deleted + recreated),
       * and its analysis status was left intact.
       */
      const after = await prisma.video.findFirst({
        where: { id: incrVideoId },
        include: { transcript: { include: { chunks: true } } },
      });
      expect(after?.analysisStatus).toBe("completed");
      expect((after?.transcript?.chunks ?? []).map((c) => c.id).sort()).toEqual(
        originalChunkIds,
      );
    } finally {
      enqueueSpy.mockRestore();
    }
  });
});

describe("POST /api/import-jobs/bulk-import — inline payload", () => {
  it("accepts an inline manifest + transcripts payload with 202", async () => {
    const r = await request(app)
      .post("/api/import-jobs/bulk-import")
      .send({
        inline: {
          manifest: {
            creator: {
              name: "Test Bulk Inline",
              slug: "test-bulk-inline-payload",
              channelUrl: null,
              description: null,
              thumbnailUrl: null,
            },
            entries: [
              {
                videoId: "inline-1",
                title: "Inline video 1",
                publishedAt: "2026-05-01",
                durationSeconds: 600,
                sourceUrl: "https://www.youtube.com/watch?v=inline-1",
                transcriptPath: "inline-1.txt",
                status: "saved",
              },
            ],
          },
          transcripts: {
            "inline-1": "Inline transcript body. " + "Hello world. ".repeat(80),
          },
        },
      });
    expect(r.status).toBe(202);
    expect(typeof r.body.jobId).toBe("string");
    const job = await prisma.importJob.findUnique({
      where: { id: r.body.jobId },
    });
    expect(job?.channelUrl).toBe("bulk-import");
  });

  it("rejects unsafe inline path segments before writing temp files", async () => {
    const r = await request(app)
      .post("/api/import-jobs/bulk-import")
      .send({
        inline: {
          manifest: {
            creator: {
              name: "Unsafe Inline",
              slug: "../unsafe",
              channelUrl: null,
              description: null,
              thumbnailUrl: null,
            },
            entries: [
              {
                videoId: "inline-unsafe",
                title: "Unsafe inline video",
                publishedAt: "2026-05-01",
                durationSeconds: 600,
                sourceUrl: "https://www.youtube.com/watch?v=inline-unsafe",
                transcriptPath: "inline-unsafe.txt",
                status: "saved",
              },
            ],
          },
          transcripts: {
            "inline-unsafe":
              "Inline transcript body. " + "Hello world. ".repeat(80),
          },
        },
      });

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/creator\.slug/);
  });
});
