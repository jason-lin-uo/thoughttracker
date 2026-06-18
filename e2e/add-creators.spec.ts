import { test, expect } from "@playwright/test";

test.describe("Add Creators admin onboarding", () => {
  test("queues unique creator URLs with the admin PIN header", async ({
    page,
  }) => {
    const posts: Array<{
      headers: Record<string, string>;
      body: { channelUrls: string[]; requestedLimit: number };
    }> = [];
    const resetPosts: Array<Record<string, string>> = [];

    await page.route("**/api/creator-onboarding/verify-pin", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.route("**/api/reports/reset-starter", async (route) => {
      resetPosts.push(route.request().headers());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          deleted: 4,
          report: {
            id: "starter-report",
            title:
              "MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs",
            summary: "Starter summary",
            creatorId: "mkbhd-id",
            topicId: "foldable-id",
            reportType: "topic_summary",
          },
        }),
      });
    });

    await page.route("**/api/creator-onboarding/run", async (route) => {
      const request = route.request();
      const body = request.postDataJSON() as {
        channelUrls: string[];
        requestedLimit: number;
      };
      posts.push({ headers: request.headers(), body });
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          status: "started",
          processId: 123,
          statusPath: "reports/metrics/add_creator_pipeline_status.json",
          logDir: "logs",
        }),
      });
    });

    await page.goto("/add-creators");

    await expect(
      page.getByRole("heading", { name: "Add Creators" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start onboarding" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reset all reports" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Creator URLs")).toBeDisabled();

    await page.getByLabel("Admin PIN").fill("2468");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText("Admin controls unlocked")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reset all reports" }).click();
    await expect(
      page.getByText(
        "Report library reset: MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs",
      ),
    ).toBeVisible();
    expect(resetPosts.every((headers) => headers["x-admin-pin"] === "2468")).toBe(
      true,
    );

    await page
      .getByLabel("Creator URLs")
      .fill(
        [
          "https://www.youtube.com/@mkbhd",
          "https://www.youtube.com/@verge",
          "https://www.youtube.com/@MKBHD",
        ].join("\n"),
      );
    await page.getByLabel("Videos per creator").selectOption("50");
    await page.getByRole("button", { name: "Start onboarding" }).click();

    await expect.poll(() => posts.length).toBe(1);
    expect(posts.map((post) => post.body)).toEqual([
      {
        channelUrls: [
          "https://www.youtube.com/@mkbhd",
          "https://www.youtube.com/@verge",
        ],
        requestedLimit: 50,
      },
    ]);
    expect(posts.every((post) => post.headers["x-admin-pin"] === "2468")).toBe(
      true,
    );

    await expect(page.getByText("Queued 2 of 2 creators.")).toBeVisible();
    await expect(
      page.getByText(/add_creator_pipeline_status\.json/),
    ).toHaveCount(2);
  });

  test("keeps the form locked when the server rejects the PIN", async ({
    page,
  }) => {
    await page.route("**/api/creator-onboarding/verify-pin", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: "FORBIDDEN",
          message: "Admin PIN required to add creators",
        }),
      });
    });

    await page.goto("/add-creators");
    await page.getByLabel("Admin PIN").fill("0000");
    await page.getByRole("button", { name: "Unlock" }).click();

    await expect(
      page.getByText("Admin PIN required to add creators"),
    ).toBeVisible();
    await expect(page.getByText("Admin controls locked")).toBeVisible();
    await expect(page.getByLabel("Creator URLs")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Start onboarding" }),
    ).toBeDisabled();
  });

  test("falls back to import jobs when the full pipeline is unavailable", async ({
    page,
  }) => {
    const pipelinePosts: Array<{
      channelUrls: string[];
      requestedLimit: number;
    }> = [];
    const fallbackPosts: Array<{
      headers: Record<string, string>;
      body: { channelUrl: string; requestedLimit: number };
    }> = [];

    await page.route("**/api/creator-onboarding/verify-pin", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.route("**/api/creator-onboarding/run", async (route) => {
      pipelinePosts.push(
        route.request().postDataJSON() as {
          channelUrls: string[];
          requestedLimit: number;
        },
      );
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "ML_UNAVAILABLE",
          message: "Creator onboarding pipeline script is not available",
        }),
      });
    });

    await page.route("**/api/import-jobs/youtube-channel", async (route) => {
      const request = route.request();
      fallbackPosts.push({
        headers: request.headers(),
        body: request.postDataJSON() as {
          channelUrl: string;
          requestedLimit: number;
        },
      });
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: `job-${fallbackPosts.length}`,
          status: "pending",
        }),
      });
    });

    await page.goto("/add-creators");
    await page.getByLabel("Admin PIN").fill("2468");
    await page.getByRole("button", { name: "Unlock" }).click();
    await page
      .getByLabel("Creator URLs")
      .fill(
        [
          "https://www.youtube.com/@alpha",
          "https://www.youtube.com/@beta",
        ].join("\n"),
      );
    await page.getByLabel("Videos per creator").selectOption("10");
    await page.getByRole("button", { name: "Start onboarding" }).click();

    await expect(page.getByText("Queued 2 of 2 creators.")).toBeVisible();
    expect(pipelinePosts).toEqual([
      {
        channelUrls: [
          "https://www.youtube.com/@alpha",
          "https://www.youtube.com/@beta",
        ],
        requestedLimit: 10,
      },
    ]);
    expect(fallbackPosts.map((post) => post.body)).toEqual([
      { channelUrl: "https://www.youtube.com/@alpha", requestedLimit: 10 },
      { channelUrl: "https://www.youtube.com/@beta", requestedLimit: 10 },
    ]);
    expect(
      fallbackPosts.every((post) => post.headers["x-admin-pin"] === "2468"),
    ).toBe(true);
    await expect(page.getByRole("link", { name: "View job" })).toHaveCount(2);
  });

  test("mobile navigation exposes Add Creators in locked mode", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Add Creators" }).click();

    await expect(
      page.getByRole("heading", { name: "Add Creators" }),
    ).toBeVisible();
    await expect(page.getByText("Admin controls locked")).toBeVisible();
    await expect(page.getByLabel("Creator URLs")).toBeDisabled();
  });
});
