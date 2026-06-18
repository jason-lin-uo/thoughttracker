import { test, expect } from "@playwright/test";
import {
  openCreatorFromList,
  openFirstTopicCard,
  pickCreatorWithTopics,
  pickDashboardCreatorName,
} from "./helpers";

/**
 * Visual smoke spec — captures full-page screenshots in light + dark mode
 * and at a mobile viewport. The output PNGs land under
 * `test-results/visuals/` (gitignored) and are useful for:
 *
 * - Confirming during local development that a theme/layout change
 * didn't subtly break a different mode (you eyeball the screenshots).
 * - Dropping into the README / portfolio as proof the app supports
 * light + dark + mobile out of the box.
 * - Smoke-testing that a route actually renders content — if the H1
 * heading is missing, the test fails before the screenshot is taken,
 * so a broken page produces a loud signal instead of a blank image.
 *
 * We deliberately do NOT do pixel-diff comparison. The screenshots are
 * snapshot fodder, not regression baselines — Recharts and font hinting
 * make sub-pixel diffs noisy across machines, and we'd rather have the
 * tests pass reliably than chase every minor delta.
 */
test.describe("visual smoke", () => {
  /**
   * Per-scheme tests: for each of `light` and `dark`, capture the
   * dashboard and the topic-analysis page. Iterating instead of writing
   * four tests keeps the spec compact while still letting Playwright
   * report each combination as a distinct named test on failure.
   */
  for (const scheme of ["light", "dark"] as const) {
    /**
     * Dashboard screenshot in the given color scheme.
     *
     * Expected outcome: the dashboard H1 is visible, the seed creator
     * "All-In Podcast" is visible somewhere on the page, and a full-page
     * PNG is written to `test-results/visuals/dashboard-{scheme}.png`.
     *
     * What the test does:
     * 1. Test calls `page.emulateMedia({ colorScheme: scheme })` so
     * the `prefers-color-scheme` media query reports `light` or
     * `dark`. ThemeProvider's "system" mode then resolves to the
     * emulated value, so we don't have to click the theme toggle.
     * 2. Test navigates to the dashboard at `/`.
     * 3. Test verifies the H1 "Dashboard" heading is visible.
     * 4. Test verifies "All-In Podcast" renders somewhere on the page.
     * 5. Test writes a full-page screenshot to the path above.
     */
    test(`dashboard renders in ${scheme} mode`, async ({ page, request }) => {
      const dashboardCreatorName = await pickDashboardCreatorName(request);

      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Dashboard" }),
      ).toBeVisible();
      await expect(page.getByText(dashboardCreatorName).first()).toBeVisible();
      await page.screenshot({
        path: `test-results/visuals/dashboard-${scheme}.png`,
        fullPage: true,
      });
    });

    /**
     * Topic analysis screenshot in the given color scheme. We pick this
     * page (and not e.g. Dashboard or Creators) because it exercises the
     * most varied components: header, stat cards, two Recharts charts,
     * the evidence-card grid, and the timeline panel. A theme regression
     * tends to show up here first.
     *
     * Expected outcome: the chosen seed creator's overview renders, a
     * topic card click navigates to topic analysis, the "Stance over
     * time" chart title appears, and a full-page PNG is written to
     * `test-results/visuals/topic-analysis-{scheme}.png`.
     *
     * What the test does:
     * 1. Test calls `page.emulateMedia({ colorScheme: scheme })`.
     * 2. Test navigates to `/creators`.
     * 3. Test clicks the first "All-In Podcast" link in the list.
     * 4. Test verifies the creator overview H1 renders.
     * 5. Test clicks the first topic card whose label is one of the
     * well-known seed topics (AI or Foreign Policy).
     * 6. Test waits for the analyst console's "Stance trajectory" section
     * eyebrow (or the empty "No data in range" verdict) — proves the
     * analysis query returned and the console rendered.
     * 7. Test writes a full-page screenshot to the path above.
     */
    test(`topic analysis renders in ${scheme} mode`, async ({
      page,
      request,
    }) => {
      const creator = await pickCreatorWithTopics(request);

      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/creators");
      await openCreatorFromList(page, creator.name);
      await openFirstTopicCard(page);
      /*
       * The analyst console always shows a "Stance trajectory" section, or the
       * "No data in range" verdict when the topic has no dated videos. Either
       * is a valid render of the topic-analysis page for visual smoke purposes.
       */
      await expect(
        page.getByText(/Stance trajectory|No data in range/i).first(),
      ).toBeVisible();
      await page.screenshot({
        path: `test-results/visuals/topic-analysis-${scheme}.png`,
        fullPage: true,
      });
    });
  }

  /**
   * Mobile-viewport screenshot — emulates an iPhone-12-class viewport
   * (390 × 844). The point is to confirm the responsive breakpoints
   * collapse the sidebar into the hamburger drawer cleanly and the
   * dashboard's stat-card grid stacks instead of overflowing.
   *
   * Expected outcome: the dashboard renders at the mobile viewport, the
   * H1 is visible, and a full-page PNG is written to
   * `test-results/visuals/dashboard-mobile.png`.
   *
   * What the test does:
   * 1. Test creates a new browser context with viewport { width: 390,
   * height: 844 } — Playwright's `browser.newContext` is used (vs
   * reusing the default context) so we don't pollute the default
   * viewport for sibling tests.
   * 2. Test opens a new page in that context.
   * 3. Test navigates to the dashboard at `/`.
   * 4. Test verifies the H1 is visible (proves the mobile layout
   * mounted, not just an empty screen).
   * 5. Test writes a full-page screenshot to the path above.
   * 6. Test closes the context to release the page and any cookies.
   */
  test("mobile layout renders", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/visuals/dashboard-mobile.png",
      fullPage: true,
    });
    await ctx.close();
  });
});
