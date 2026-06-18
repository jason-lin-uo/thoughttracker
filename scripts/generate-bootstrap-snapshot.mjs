import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = (
  process.env.BOOTSTRAP_API_BASE_URL ?? "http://localhost:4000/api"
).replace(/\/$/, "");

const outputPath = path.resolve(
  "frontend",
  "src",
  "generated",
  "bootstrapSnapshot.json",
);

const baseRequests = [
  { key: ["dashboard"], path: "/dashboard" },
  { key: ["creators", ""], path: "/creators?search=" },
  { key: ["creators-for-filter"], path: "/creators" },
  { key: ["topics-index"], path: "/topics" },
  { key: ["topics-for-filter"], path: "/topics" },
  {
    key: ["reports", "", "", "", "date_desc", 1],
    path: "/reports?sort=date_desc&page=1&pageSize=12",
  },
];

async function getJson(pathname) {
  const url = `${apiBase}${pathname}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Snapshot fetch failed ${res.status}: ${url}`);
  }
  return res.json();
}

async function main() {
  const queries = [];
  for (const request of baseRequests) {
    queries.push({ key: request.key, data: await getJson(request.path) });
  }

  const reportsPage = queries.find(
    (entry) =>
      JSON.stringify(entry.key) ===
      JSON.stringify(["reports", "", "", "", "date_desc", 1]),
  )?.data;
  const firstReport = Array.isArray(reportsPage?.items)
    ? reportsPage.items[0]
    : null;
  if (firstReport?.id) {
    queries.push({
      key: ["report", firstReport.id],
      data: await getJson(`/reports/${encodeURIComponent(firstReport.id)}`),
    });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: apiBase,
        queries,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote ${outputPath} with ${queries.length} query snapshots.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
