import { test, expect } from "@playwright/test";

const API_BASE = "http://localhost:4000/api";

function creatorPairCandidates<T>(items: T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1)
      pairs.push([items[i], items[j]]);
  }
  return pairs;
}

/**
 * E2E spec for the multi-creator Compare flow (Milestone #5).
 *
 * The Compare page exposes a chip-style picker that lets a user select
 * 2-5 creators, then renders three sections side-by-side once two are
 * selected:
 * - "Coverage" — one stat card cluster per creator
 * - "Shared topics" — a table of topics every selected creator has
 * analyzed, with each creator's dominant stance per row
 * - "Stance over time" — a multi-line overlay chart, one line per creator
 *
 * Pre-requisites: the test DB has at least 3 fixture creators with
 * overlapping topics (i.e. `npm run db:seed` has run successfully against a
 * dedicated test DB). With fewer than 3 the cap test will fail because there
 * aren't enough chips to click.
 */
test.describe("ThoughtTracker compare flow", () => {
  /**
   * Verifies the happy path: pick 2 creators, all 3 result sections show up.
   *
   * Expected outcome: with 0 selected, the page shows the empty-state
   * prompt ("Pick at least 2 creators…"); after toggling 2 chips on, the
   * Coverage / Shared topics / Stance-over-time section headings all
   * become visible. We don't assert on specific cell contents here because
   * seed data can shift over time; instead we anchor on the section
   * headings, which are stable.
   *
   * What the test does:
   * 1. Test navigates to `/compare`.
   * 2. Test verifies the H1 "Compare creators" heading is visible.
   * 3. Test verifies the empty-state "at least 2 creators" hint is
   * visible — guards against the picker accidentally fetching before
   * a selection exists.
   * 4. Test clicks the first chip in the picker (All-In Podcast by seed order).
   * 5. Test clicks the next un-pressed chip (which becomes the new
   * first un-pressed chip after step 4). This selects Thomas DeLauer.
   * 6. Test waits for "Coverage" section heading — proves the
   * `/api/creators/compare` request returned and the result component
   * rendered.
   * 7. Test verifies "Shared topics" section heading is visible.
   * 8. Test verifies "Stance over time" section heading is visible
   * (rendered even when timeline points are empty — the section's
   * heading + empty-state copy is what shows up).
   */
  test("picker → side-by-side cards → shared topics + timeline", async ({
    page,
  }) => {
    await page.goto("/compare");
    await expect(
      page.getByRole("heading", { name: "Compare creators" }),
    ).toBeVisible();
    await expect(page.getByText(/at least 2 creators/i).first()).toBeVisible();

    /* Toggle the first two seed creators. */
    const buttons = page.getByRole("button", { pressed: false });
    await buttons.nth(0).click();
    await buttons
      .nth(0)
      .click(); /* After first click, the next 'pressed=false' button is index 0 again. */

    /* Stat cards header should appear once two creators are selected. */
    await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();

    /* Shared topics section is always rendered (empty-state included). */
    await expect(
      page.getByRole("heading", { name: "Shared topics" }),
    ).toBeVisible();
    /* Timeline section is always rendered. */
    await expect(
      page.getByRole("heading", { name: "Stance over time" }),
    ).toBeVisible();
  });

  /**
   * Verifies the picker is forgiving — users can add a third creator and
   * then drop one back out without the result region crashing or going
   * blank between selections.
   *
   * This guards against two real bugs we've seen in similar pickers:
   * - The result query cache going stale and showing the WRONG creators
   * after a deselect (we sync the cache key to `selected`).
   * - The chip's `aria-pressed` state desyncing from internal state
   * (we always derive it from the `selected.includes(id)` check).
   *
   * Expected outcome: after adding 3 chips then removing the first, the
   * "Coverage" heading remains visible (the page still has ≥2 selections
   * and so still renders the result region).
   *
   * What the test does:
   * 1. Test navigates to `/compare`.
   * 2. Test clicks the first un-pressed chip three times in a row,
   * each time grabbing the new "first un-pressed" so it ends up
   * selecting three distinct creators.
   * 3. Test grabs the first currently-pressed chip via the role
   * selector `{ pressed: true }`.
   * 4. Test clicks it to deselect, leaving 2 selected.
   * 5. Test verifies the "Coverage" heading is still visible.
   */
  test("third creator can be added then deselected without crashing", async ({
    page,
  }) => {
    await page.goto("/compare");
    const buttons = page.getByRole("button", { pressed: false });
    await buttons.nth(0).click();
    await buttons.nth(0).click();
    await buttons.nth(0).click();
    /* Now there are 3 pressed; deselect the first. */
    const pressed = page.getByRole("button", { pressed: true });
    await pressed.first().click();
    /* Coverage heading should still be visible (2 still selected). */
    await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
  });

  test("shared-topic stance cells link to creator topic analysis", async ({
    page,
    request,
  }) => {
    const creatorsResponse = await request.get(`${API_BASE}/creators`);
    expect(creatorsResponse.ok()).toBe(true);
    const creators = (
      (await creatorsResponse.json()) as {
        items: Array<{ id: string; name: string }>;
      }
    ).items;

    let selectedIds: [string, string] | null = null;
    for (const [first, second] of creatorPairCandidates(creators)) {
      const compareResponse = await request.get(
        `${API_BASE}/creators/compare?creatorIds=${first.id},${second.id}`,
      );
      expect(compareResponse.ok()).toBe(true);
      const comparison = (await compareResponse.json()) as {
        sharedTopics: unknown[];
      };
      if (comparison.sharedTopics.length > 0) {
        selectedIds = [first.id, second.id];
        break;
      }
    }

    test.skip(
      !selectedIds,
      "No creator pair with shared topics is available for this data set.",
    );
    const [firstId, secondId] = selectedIds!;

    await page.goto(`/compare?creators=${firstId},${secondId}`);
    await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();

    const sharedTopicLink = page
      .locator('tbody a[href^="/creators/"][href*="/topics/"]')
      .first();
    await expect(sharedTopicLink).toBeVisible();
    await expect(sharedTopicLink).toHaveAttribute(
      "href",
      /^\/creators\/[^/]+\/topics\/[^/]+$/,
    );

    await sharedTopicLink.click();
    await expect(page).toHaveURL(/\/creators\/[^/]+\/topics\/[^/]+$/);
    await expect(
      page.getByText(/Stance trajectory|No data in range/i).first(),
    ).toBeVisible({
      timeout: 10_000,
    });
  });
});
