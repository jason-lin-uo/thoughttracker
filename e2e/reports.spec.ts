import { test, expect } from "@playwright/test";

const API_BASE = "http://localhost:4000/api";

/**
 * Report detail e2e coverage.
 *
 * These checks cover the recruiter-facing report output rather than the
 * report-generation internals. Unit tests already validate schema repair,
 * provider fallback, and citation hydration; this spec verifies that the
 * rendered report remains useful to a reader:
 * - source citations link back into the app's video/transcript pages
 * - prompt-internal wording is not visible in the UI
 */
test.describe("ThoughtTracker report detail flow", () => {
  test("report detail renders source-video links without prompt-internal text", async ({
    page,
    request,
  }) => {
    const reportsResponse = await request.get(
      `${API_BASE}/reports?pageSize=10`,
    );
    expect(reportsResponse.ok()).toBe(true);
    const reports = (await reportsResponse.json()) as {
      items: Array<{ id: string; title: string }>;
    };

    test.skip(
      reports.items.length === 0,
      "No reports are available for this data set.",
    );
    const report = reports.items[0];

    await page.goto(`/reports/${report.id}`);
    await expect(page.getByText(report.title).first()).toBeVisible({
      timeout: 10_000,
    });

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /trendLabel|dominantStance|section MUST feature/i,
    );
    expect(bodyText).not.toMatch(
      /supplied verbatim quotes|return valid json|output json only/i,
    );

    const sourceVideoLink = page.locator('a[href^="/videos/"]').first();
    await expect(sourceVideoLink).toBeVisible();
    await expect(sourceVideoLink).toHaveAttribute("href", /^\/videos\/[^/]+$/);

    await sourceVideoLink.click();
    await expect(page).toHaveURL(/\/videos\/[^/]+$/);
    await expect(
      page.getByText(/Transcript|Evidence|Video/i).first(),
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test("renders own-words quotes with nested transcript citations", async ({
    page,
  }) => {
    await page.route("**/api/reports/e2e-quote-report", async (route) => {
      await route.fulfill({
        json: {
          id: "e2e-quote-report",
          creatorId: "creator-mkbhd",
          topicId: null,
          reportType: "topic_summary",
          title:
            "MKBHD on Foldables: Future-Ready Hardware, Real-World Tradeoffs",
          summary: "A practical-optimism report about foldable smartphones.",
          caveats: "Transcript-backed summary only.",
          createdAt: "2026-06-17T00:00:00Z",
          creator: {
            id: "creator-mkbhd",
            name: "Marques Brownlee",
            slug: "mkbhd",
          },
          topic: null,
          evidence: {
            sections: [
              {
                heading: "In their own words",
                bullets: [
                  {
                    quote:
                      "for years these folding phones never really had flagship cameras, because there wasn't enough room.",
                    citation:
                      "So This is Peak Foldable transcript (2026-03-30, supportive)",
                    videoId: "video-foldable",
                  },
                ],
              },
            ],
            evidence: [],
          },
        },
      });
    });

    await page.goto("/reports/e2e-quote-report");
    await expect(page.getByText("In their own words")).toBeVisible();
    await expect(
      page.getByText(
        '"for years these folding phones never really had flagship cameras, because there wasn\'t enough room."',
      ),
    ).toBeVisible();

    const quoteCitationLink = page.getByRole("link", {
      name: /So This is Peak Foldable transcript \(2026-03-30, supportive\)/,
    });
    await expect(quoteCitationLink).toBeVisible();
    await expect(quoteCitationLink).toHaveAttribute(
      "href",
      "/videos/video-foldable",
    );
  });

  test("report stance trajectory dots open the episode evidence modal", async ({
    page,
  }) => {
    await page.route("**/api/reports/e2e-chart-report", async (route) => {
      await route.fulfill({
        json: {
          id: "e2e-chart-report",
          creatorId: "creator-mkbhd",
          topicId: "topic-foldables",
          reportType: "topic_summary",
          title: "MKBHD on Foldable Smartphone Reviews",
          summary: "A practical report about foldable smartphone reviews.",
          caveats: "Transcript-backed summary only.",
          createdAt: "2026-06-17T00:00:00Z",
          creator: {
            id: "creator-mkbhd",
            name: "Marques Brownlee",
            slug: "mkbhd",
          },
          topic: {
            id: "topic-foldables",
            name: "Foldable Smartphone Reviews",
            slug: "foldable-smartphone-reviews",
          },
          evidence: { sections: [], evidence: [] },
        },
      });
    });
    await page.route(
      "**/api/creators/creator-mkbhd/topics/topic-foldables/analysis",
      async (route) => {
        await route.fulfill({
          json: {
            creator: {
              id: "creator-mkbhd",
              name: "Marques Brownlee",
              slug: "mkbhd",
            },
            topic: {
              id: "topic-foldables",
              name: "Foldable Smartphone Reviews",
              slug: "foldable-smartphone-reviews",
            },
            timeline: null,
            summaries: [
              {
                id: "summary-foldable",
                videoId: "video-foldable",
                topicId: "topic-foldables",
                creatorId: "creator-mkbhd",
                dominantStance: "supportive",
                confidenceScore: 0.91,
                confidenceLabel: "high",
                mentionCount: 3,
                summary: "The creator sees foldables as promising.",
                notableEvidence: [
                  {
                    quote:
                      "for years these folding phones never really had flagship cameras, because there wasn't enough room.",
                    chunkIndex: 0,
                  },
                ],
                video: {
                  id: "video-foldable",
                  title: "So This is Peak Foldable",
                  publishedAt: "2026-03-30T00:00:00Z",
                  sourceUrl: "https://www.youtube.com/watch?v=test",
                  thumbnailUrl: null,
                },
              },
            ],
            topEvidence: [],
            report: null,
          },
        });
      },
    );

    await page.goto("/reports/e2e-chart-report");
    await expect(
      page.getByText("Stance trajectory", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: /So This is Peak Foldable/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/for years these folding phones never really had/i),
    ).toBeVisible();
  });
});
