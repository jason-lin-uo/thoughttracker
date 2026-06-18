# ADR-008 — VirtualizedList: threshold-gated, not always-on

- **Status:** Accepted
- **Date:** 2026-05
- **Authors:** Jason Lin

## Context

`VideosPage` and `EvidencePage` render paginated lists. Default page
sizes are 24 and 12 respectively. The original audit recommended
"always-virtualize" via `@tanstack/react-virtual` for simpler code.

After implementing it, I realized always-virtualize trades real wins for
real losses:

**Pros of always-virtualize:**

- One render path instead of two.
- Future pageSize bumps just work.

**Cons of always-virtualize:**

- The desktop videos table loses its native `<table>` element. Screen
  readers and keyboard nav handle `<table>` better than a CSS-grid
  fake-table.
- Virtualizer needs a fixed-height scroll viewport (currently `60vh`).
  At 12 items, that creates an awkward inner scrollbar where the page
  would naturally flow.
- Every page-rendering test would need the
  `vi.mock("@tanstack/react-virtual")` plumbing — including tests for
  the small-list common case.

## Decision

Keep virtualization **threshold-gated**: render normally (CSS grid /
native `<table>`) when `items.length <= VIRTUALIZE_THRESHOLD` (25),
and switch to `VirtualizedList` only above the threshold.

Implementation lives in `src/components/VirtualizedList.tsx`; the
threshold constant is exported so both consumer pages reference the
same number.

## Consequences

- Best of both worlds for current pageSize defaults: real `<table>`
  on desktop, natural flow on mobile.
- Future-proof: if anyone raises pageSize > 25, virtualization
  activates automatically.
- Tests for the threshold-crossing case still need the
  `useVirtualizer` mock (because jsdom can't compute layout), but
  small-list tests don't.

## Rejected alternatives

- **Always render the virtualizer.** See cons above.
- **Never virtualize.** Doesn't scale past ~50 items.
- **Custom intersection-observer virtualization.** Reinventing what
  `@tanstack/react-virtual` already does correctly.
