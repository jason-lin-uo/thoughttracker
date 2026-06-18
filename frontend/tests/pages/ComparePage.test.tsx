import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(s: number, m: string) {
      super(m);
      this.status = s;
    }
  },
}));

import { api } from "../../src/lib/api";
import { ComparePage } from "../../src/pages/ComparePage";
/* Shared provider-stack render helper (de-duplicated, audit §9). */
import { renderPage } from "./_render";

const sampleCreators = [
  {
    id: "c1",
    name: "Alice",
    slug: "alice",
    description: null,
    thumbnailUrl: null,
    creatorType: "youtube",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    videoCount: 10,
    transcriptCount: 8,
    topicCount: 4,
    lastImportedAt: null,
  },
  {
    id: "c2",
    name: "Bob",
    slug: "bob",
    description: null,
    thumbnailUrl: null,
    creatorType: "youtube",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    videoCount: 5,
    transcriptCount: 4,
    topicCount: 3,
    lastImportedAt: null,
  },
  {
    id: "c3",
    name: "Carol",
    slug: "carol",
    description: null,
    thumbnailUrl: null,
    creatorType: "youtube",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    videoCount: 3,
    transcriptCount: 2,
    topicCount: 2,
    lastImportedAt: null,
  },
];

const sampleComparison = {
  creators: [
    {
      creatorId: "c1",
      name: "Alice",
      slug: "alice",
      thumbnailUrl: null,
      videoCount: 10,
      transcriptCount: 8,
      topicCount: 4,
      evidenceCount: 30,
    },
    {
      creatorId: "c2",
      name: "Bob",
      slug: "bob",
      thumbnailUrl: null,
      videoCount: 5,
      transcriptCount: 4,
      topicCount: 3,
      evidenceCount: 12,
    },
  ],
  sharedTopics: [
    {
      topicId: "t1",
      name: "Climate",
      slug: "climate",
      perCreator: [
        {
          creatorId: "c1",
          dominantStance: "supportive",
          mentionCount: 7,
          videoCount: 4,
        },
        {
          creatorId: "c2",
          dominantStance: "opposed",
          mentionCount: 3,
          videoCount: 2,
        },
      ],
    },
  ],
  timeline: {
    points: [
      { date: "2026-01", values: { c1: 0.6, c2: -0.4 } },
      { date: "2026-02", values: { c1: 0.5, c2: null } },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ComparePage", () => {
  it("prompts to pick creators when 0-1 selected", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: sampleCreators });
    renderPage(<ComparePage />);
    await waitFor(() =>
      expect(screen.getAllByText(/Pick creators/i).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/at least 2 creators/i).length).toBeGreaterThan(
      0,
    );
  });

  it("renders comparison once 2 creators are selected", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: sampleCreators };
      if (path === "/creators/compare") return sampleComparison;
      return {};
    });
    renderPage(<ComparePage />);

    /* Toggle Alice + Bob. */
    const alice = await screen.findByRole("button", { name: "Alice" });
    const bob = await screen.findByRole("button", { name: "Bob" });
    await user.click(alice);
    await user.click(bob);

    /* Comparison should appear with stat cards + shared topics + timeline. */
    await waitFor(() =>
      expect(screen.getByText("Climate")).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/Shared topics/i).length).toBeGreaterThan(0);
    /* Each per-creator stance cell renders its label. */
    expect(screen.getAllByText(/supportive/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/opposed/i).length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByRole("link", { name: /Open Climate analysis/i })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/creators/c1/topics/t1", "/creators/c2/topics/t1"]);
  });

  it("disables additional picks once 5 creators are selected", async () => {
    const user = userEvent.setup();
    /* Inflate to 6 creators so we can hit the cap. */
    const sixCreators = [
      ...sampleCreators,
      { ...sampleCreators[0], id: "c4", name: "Dan", slug: "dan" },
      { ...sampleCreators[0], id: "c5", name: "Eve", slug: "eve" },
      { ...sampleCreators[0], id: "c6", name: "Fran", slug: "fran" },
    ];
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: sixCreators };
      if (path === "/creators/compare") return sampleComparison;
      return {};
    });
    renderPage(<ComparePage />);

    for (const n of ["Alice", "Bob", "Carol", "Dan", "Eve"]) {
      const btn = await screen.findByRole("button", { name: n });
      await user.click(btn);
    }
    /* 6th button should now be disabled. */
    const fran = screen.getByRole("button", { name: "Fran" });
    expect(fran).toBeDisabled();
  });

  it("renders an error state when the comparison query fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: sampleCreators };
      if (path === "/creators/compare") throw new Error("compare-fail");
      return {};
    });
    renderPage(<ComparePage />);
    const alice = await screen.findByRole("button", { name: "Alice" });
    const bob = await screen.findByRole("button", { name: "Bob" });
    await user.click(alice);
    await user.click(bob);
    await waitFor(() =>
      expect(screen.getByText("compare-fail")).toBeInTheDocument(),
    );
  });

  it.each([
    [3, "lg:grid-cols-3"],
    [4, "lg:grid-cols-4"],
    [5, "lg:grid-cols-5"],
  ])(
    "renders the coverage grid with the static %i-column class (catches the H19 dynamic-class bug)",
    async (count, expectedClass) => {
      const user = userEvent.setup();
      /* Build `count` creators + a comparison payload with `count` columns. */
      const many = Array.from({ length: count }, (_, i) => ({
        ...sampleCreators[0],
        id: `c${i + 1}`,
        name: `Creator${i + 1}`,
        slug: `creator${i + 1}`,
      }));
      const comparison = {
        creators: many.map((c) => ({
          creatorId: c.id,
          name: c.name,
          slug: c.slug,
          thumbnailUrl: null,
          videoCount: 1,
          transcriptCount: 1,
          topicCount: 1,
          evidenceCount: 1,
        })),
        sharedTopics: [],
        timeline: { points: [] },
      };
      vi.mocked(api.get).mockImplementation(async (path: string) => {
        if (path === "/creators") return { items: many };
        if (path === "/creators/compare") return comparison;
        return {};
      });
      const { container } = renderPage(<ComparePage />);
      for (const c of many) {
        const btn = await screen.findByRole("button", { name: c.name });
        await user.click(btn);
      }
      /*
       * The coverage grid must carry the STATIC lg column class — a Tailwind
       * JIT-visible literal — not a runtime-built `lg:grid-cols-${n}` that
       * never compiles. Assert the class is present in the rendered DOM.
       */
      await waitFor(() =>
        expect(
          container.querySelector(`.${CSS.escape(expectedClass)}`),
        ).not.toBeNull(),
      );
    },
  );

  it("renders shared-topics empty + timeline empty when payload is bare", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/creators") return { items: sampleCreators };
      if (path === "/creators/compare") {
        return {
          creators: sampleComparison.creators,
          sharedTopics: [],
          timeline: { points: [] },
        };
      }
      return {};
    });
    renderPage(<ComparePage />);
    const alice = await screen.findByRole("button", { name: "Alice" });
    const bob = await screen.findByRole("button", { name: "Bob" });
    await user.click(alice);
    await user.click(bob);
    await waitFor(() =>
      expect(
        screen.getByText(/don't share any analyzed topics/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Not enough dated stance data/i),
    ).toBeInTheDocument();
  });
});
