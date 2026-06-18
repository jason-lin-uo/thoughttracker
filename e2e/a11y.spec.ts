import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Routes audited by the accessibility suite.
 *
 * Every top-level routed page is included here because a recruiter or a
 * hiring manager landing on ANY route should never see a serious/critical
 * WCAG violation. Adding a new top-level route? Add it to this list — the
 * spec below builds one test per entry so coverage stays in lock-step with
 * the navigation.
 *
 * Each entry is `{ path, label }` where `path` is the URL the test visits
 * and `label` is the human-readable name used in the test title — picking
 * a label that matches the sidebar entry makes failures self-locating.
 */
const PAGES_TO_AUDIT = [
  { path: "/", label: "dashboard" },
  { path: "/creators", label: "creators" },
  { path: "/imports", label: "imports" },
  { path: "/add-creators", label: "add-creators" },
  { path: "/videos", label: "videos" },
  { path: "/evidence", label: "evidence" },
  { path: "/reports", label: "reports" },
  { path: "/compare", label: "compare" },
];

test.describe("axe-core accessibility audit", () => {
  /**
   * One test per entry in PAGES_TO_AUDIT. Each one navigates to the route,
   * waits for any in-flight queries to settle, then runs axe-core against
   * the rendered DOM and asserts that NO violation has impact "serious" or
   * "critical".
   *
   * We allow "minor" and "moderate" violations through deliberately —
   * those are typically advisory (color contrast on disabled buttons,
   * landmark redundancy on already-screen-reader-friendly sections) and
   * fixing them adds noise without improving real-world accessibility.
   * The bar we hold to is "no blocker for keyboard or screen-reader users".
   *
   * Expected outcome: zero violations of impact "serious" or "critical"
   * against the WCAG 2.0 A, 2.0 AA, and 2.1 AA tagsets on the page under
   * test. If any are found, the test logs each violation's id, help text,
   * and offending node count so a maintainer can fix without re-running
   * axe locally.
   *
   * What each test does:
   * 1. Test navigates to the page's URL via `page.goto(path)`.
   * 2. Test waits for `networkidle` so React Query has finished
   * hydrating and there are no `<Skeleton>` placeholders left in the
   * DOM (Skeletons can sometimes trigger contrast warnings).
   * 3. Test runs `new AxeBuilder({ page })` configured with the WCAG
   * tagsets we care about.
   * 4. Test filters the resulting violations down to ones with impact
   * "serious" or "critical".
   * 5. If any survived the filter, test prints a per-violation summary
   * to stdout so the CI log explains what broke.
   * 6. Test asserts the filtered violations array is empty.
   */
  for (const p of PAGES_TO_AUDIT) {
    test(`${p.label} has no serious/critical a11y violations`, async ({
      page,
    }) => {
      await page.goto(p.path);
      /* Wait for content to render */
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );

      if (serious.length > 0) {
        const summary = serious
          .map(
            (v) =>
              ` - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${
                v.nodes.length === 1 ? "" : "s"
              })`,
          )
          .join("\n");
        console.log(`\n${p.label}:\n${summary}`);
      }
      expect(serious).toEqual([]);
    });
  }
});
