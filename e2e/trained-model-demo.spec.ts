import { test, expect } from "@playwright/test";
import { openFirstTopicCard } from "./helpers";

/**
 * Real-corpus screenshots.
 *
 * This spec captures the dashboard / creator / topic / evidence /
 * compare flow as PNGs for portfolio/README use. It asserts on
 * "Andrew Huberman" because the shipped real corpus includes Huberman
 * transcripts. Against an empty or fixture-only DB, Huberman isn't present
 * and this test would fail.
 *
 * We probe the dashboard once up-front; if Huberman isn't there, we
 * skip the rest cleanly rather than hard-failing — the real corpus must be
 * restored first (see PERSONAL_MACHINE_SETUP.md).
 */
test("real-corpus screenshots", async ({ page }) => {
  /* Dashboard */
  await page.goto("/");
  const huberman = page.getByText("Andrew Huberman").first();
  try {
    await expect(huberman).toBeVisible({ timeout: 3000 });
  } catch {
    test.skip(
      true,
      "Real corpus not restored; run PERSONAL_MACHINE_SETUP.md to enable",
    );
    return;
  }
  await page.screenshot({
    path: "test-results/real-corpus/01-dashboard.png",
    fullPage: true,
  });

  /* Creators list */
  await page.goto("/creators");
  await expect(page.getByRole("heading", { name: "Creators" })).toBeVisible();
  await page.screenshot({
    path: "test-results/real-corpus/02-creators.png",
    fullPage: true,
  });

  /* Huberman overview */
  await page.getByText("Andrew Huberman").first().click();
  await expect(
    page.getByRole("heading", { name: "Andrew Huberman" }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("heading", { name: "Top topics" })).toBeVisible();
  await page.screenshot({
    path: "test-results/real-corpus/03-creator-overview.png",
    fullPage: true,
  });

  /*
   * Topic analysis — click any topic card. Some topics may have no
   * chart data yet; match either the title or the empty-state copy.
   */
  await openFirstTopicCard(page);
  await page.screenshot({
    path: "test-results/real-corpus/04-topic-analysis.png",
    fullPage: true,
  });

  /* Evidence */
  await page.goto("/evidence");
  await expect(
    page.getByRole("heading", { name: "Evidence Explorer" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/real-corpus/05-evidence.png",
    fullPage: true,
  });

  /* Compare — pick Huberman + All-In Podcast (any two) */
  await page.goto("/compare");
  await expect(
    page.getByRole("heading", { name: "Compare creators" }),
  ).toBeVisible();
  const compareButtons = page.getByRole("button", { pressed: false });
  await compareButtons.nth(0).click();
  await compareButtons.nth(0).click();
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible({
    timeout: 10000,
  });
  await page.screenshot({
    path: "test-results/real-corpus/06-compare.png",
    fullPage: true,
  });
});
