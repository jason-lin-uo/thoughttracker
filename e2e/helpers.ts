import { expect, type APIRequestContext, type Page } from "@playwright/test";

interface CreatorListItem {
  id: string;
  name: string;
  topicCount: number;
  videoCount: number;
}

interface DashboardResponse {
  recentCreators: Array<{ name: string }>;
}

interface CreatorsResponse {
  items: CreatorListItem[];
}

const API_BASE = "http://localhost:4000/api";
const PREFERRED_CREATOR_NAMES = [
  "Andrew Huberman",
  "Marques Brownlee",
  "All In Podcast",
  "Thomas DeLauer",
  "John Campea",
];

/*
 * Hits the dashboard API and returns the name of the first recent creator
 * with a non-empty name; throws if the dashboard returns none.
 */
export async function pickDashboardCreatorName(
  request: APIRequestContext,
): Promise<string> {
  const response = await request.get(`${API_BASE}/dashboard`);
  expect(response.ok()).toBe(true);
  const dashboard = (await response.json()) as DashboardResponse;
  /* First recent creator whose name isn't blank/whitespace. */
  const creator = dashboard.recentCreators.find(
    (item) => item.name.trim().length > 0,
  );
  if (!creator)
    throw new Error("Dashboard did not return any recent creators.");
  return creator.name;
}

/*
 * Picks a creator that has both topics and videos, preferring the curated
 * PREFERRED_CREATOR_NAMES list before falling back to the first eligible one;
 * throws if none qualify.
 */
export async function pickCreatorWithTopics(
  request: APIRequestContext,
): Promise<CreatorListItem> {
  const response = await request.get(`${API_BASE}/creators`);
  expect(response.ok()).toBe(true);
  const data = (await response.json()) as CreatorsResponse;
  /* Creators that have at least one topic and one video. */
  const eligible = data.items.filter(
    (creator) => creator.topicCount > 0 && creator.videoCount > 0,
  );
  const preferred = PREFERRED_CREATOR_NAMES.map((name) =>
    eligible.find((creator) => creator.name === name),
  ).find(Boolean);
  const creator = preferred ?? eligible[0];
  if (!creator)
    throw new Error("No creator with topics is available for e2e tests.");
  return creator;
}

/*
 * Clicks the named creator in the current list view and waits for that
 * creator's overview heading to be visible.
 */
export async function openCreatorFromList(
  page: Page,
  creatorName: string,
): Promise<void> {
  await page.getByText(creatorName).first().click();
  await expect(page.getByRole("heading", { name: creatorName })).toBeVisible();
}

/*
 * Clicks the first topic card on the page and waits for the analyst-console
 * topic-analysis page to render — keyed off the "Stance trajectory" section
 * eyebrow (or the verdict hero), which the redesigned page always shows.
 */
export async function openFirstTopicCard(page: Page): Promise<void> {
  const topicCard = page.locator('a[href*="/topics/"]').first();
  await expect(topicCard).toBeVisible({ timeout: 10_000 });
  await topicCard.click();
  await expect(
    page.getByText(/Stance trajectory|No data in range/i).first(),
  ).toBeVisible({ timeout: 10_000 });
}
