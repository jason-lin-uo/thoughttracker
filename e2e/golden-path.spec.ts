import { test, expect } from "@playwright/test";
import {
  openCreatorFromList,
  openFirstTopicCard,
  pickCreatorWithTopics,
  pickDashboardCreatorName,
} from "./helpers";

/**
 * Golden-path E2E: a recruiter (or a new hire on their first day) walks
 * through the demo end-to-end. This is the "if any one of these breaks the
 * whole demo is broken" spec — it covers the five highest-traffic flows in
 * order, using only buttons and links a real user would touch.
 *
 * Prerequisites:
 * 1. Postgres is up with the real snapshot restored by `npm run setup:local`.
 * 2. Backend (port 4000) + frontend (port 5173) are running with
 * test-safe provider settings so no paid API keys are required.
 *
 * If this spec ever needs to be split, the natural seams are:
 * - Dashboard → Creators (read-only home flow)
 * - Creator overview → Topic analysis (drill-down)
 * - Evidence → Evidence detail (provenance flow)
 * - Reports / Add Creators are covered in their own focused specs.
 */
test.describe("ThoughtTracker golden path", () => {
  /**
   * Walks the canonical "first-time visitor" path through ThoughtTracker.
   *
   * Expected outcome: every routed page renders without errors, the seeded
   * a real current creator surfaces on the dashboard, the topic analysis
   * page renders both charts plus the chronological summaries section,
   * the evidence-detail page shows the main chunk.
   *
   * What the test does:
   * 1. Test navigates to the dashboard at `/`.
   * 2. Test verifies the H1 "Dashboard" heading is visible.
   * 3. Test verifies a current real creator appears somewhere on
   * the dashboard — this guards against a broken `/api/dashboard` query.
   * 4. Test clicks the "Creators" sidebar link.
   * 5. Test verifies the H1 "Creators" heading is visible.
   * 6. Test clicks the "All-In Podcast" creator card.
   * 7. Test verifies the creator overview shows the creator H1 and the
   * "Top topics" section heading.
   * 8. Test clicks the first topic card whose label matches one of the
   * known seed topics (AI / Foreign Policy / Public Health).
   * 9. Test verifies the analyst-console topic analysis page shows the
   * "Stance trajectory", "Overall balance", "Per-video stance heatmap",
   * and evidence section eyebrows — i.e. every major section of the
   * redesigned topic analysis page renders.
   * 10. Test clicks the "Evidence" sidebar link.
   * 11. Test verifies the "Evidence Explorer" H1 is visible.
   * 12. Test clicks the first "View context" link to open evidence detail.
   * 13. Test verifies the evidence detail page shows the "Evidence detail"
   * title and the "Main chunk" section — guards against the previous /
   * main / next chunk pipeline breaking.
   */
  test("dashboard → creator → topic analysis → evidence", async ({
    page,
    request,
  }) => {
    const dashboardCreatorName = await pickDashboardCreatorName(request);
    const creator = await pickCreatorWithTopics(request);

    /* 1. Dashboard */
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();

    /* Wait for a current creator to render anywhere on the page. */
    await expect(page.getByText(dashboardCreatorName).first()).toBeVisible();

    /* 2. Open the Creators list from the sidebar nav. */
    await page.getByRole("link", { name: "Creators", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Creators" })).toBeVisible();
    await openCreatorFromList(page, creator.name);

    /* Creator overview. */
    await expect(
      page.getByRole("heading", { name: "Top topics" }),
    ).toBeVisible();

    /* 3. Open a topic analysis. */
    await openFirstTopicCard(page);

    /*
     * Topic analysis page (analyst console) renders the verdict + the four
     * console sections. The section eyebrows are matched with `exact: true`
     * so they don't collide with the subtitle (which also contains the
     * substring "stance trajectory").
     */
    await expect(
      page.getByText("Stance trajectory", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Overall balance", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Per-video stance heatmap/i).first(),
    ).toBeVisible();
    /* The evidence section eyebrow ("Evidence · click a row …"). */
    await expect(
      page.getByText(/Evidence · click a row/i).first(),
    ).toBeVisible();

    /* 4. Evidence Explorer from sidebar. */
    await page.getByRole("link", { name: "Evidence" }).click();
    await expect(
      page.getByRole("heading", { name: "Evidence Explorer" }),
    ).toBeVisible();
    /* Open the first evidence's context view. */
    const contextLink = page
      .getByRole("link", { name: /View context/ })
      .first();
    await contextLink.click();
    await expect(page.getByText("Evidence detail")).toBeVisible();
    await expect(page.getByText(/Main chunk/i)).toBeVisible();

  });
});
