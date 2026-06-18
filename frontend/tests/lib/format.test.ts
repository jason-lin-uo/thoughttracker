import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDuration,
  formatRelative,
  humanizeLabel,
} from "../../src/lib/format";

describe("format helpers", () => {
  it("formatDate handles null/undefined/invalid", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("formatDate renders ISO strings", () => {
    const out = formatDate("2026-05-23T00:00:00Z");
    expect(out).toMatch(/2026/);
  });

  it("formatDate renders in UTC, not the viewer's local zone", () => {
    /*
     * A boundary instant: 02:00 UTC on Feb 1 is still Jan 31 in any negative
     * offset (e.g. EST/EDT). The analyst console buckets/filters in UTC, so the
     * display MUST read "Feb 1" too — under the old local-time behavior this
     * rendered "Jan 31, 2026" on a UTC-negative runner and put the date out of
     * sync with its February heatmap column / range membership.
     */
    expect(formatDate("2026-02-01T02:00:00Z")).toBe("Feb 1, 2026");
    /* Symmetric: 23:00 UTC on Jan 31 must not roll forward to Feb for UTC+ viewers. */
    expect(formatDate("2026-01-31T23:00:00Z")).toBe("Jan 31, 2026");
  });

  it("formatDuration handles edge cases", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3725)).toBe("1h 2m");
  });

  it("humanizeLabel converts snake_case to Title Case", () => {
    expect(humanizeLabel("insufficient_evidence")).toBe(
      "Insufficient Evidence",
    );
    expect(humanizeLabel("opposed")).toBe("Opposed");
    expect(humanizeLabel("gradual_shift")).toBe("Gradual Shift");
  });

  it("formatRelative produces a string for recent times", () => {
    const out = formatRelative(new Date(Date.now() - 60_000));
    expect(typeof out).toBe("string");
    expect(out).not.toBe("—");
  });

  it("formatRelative selects the right unit per bucket", () => {
    /* One sample per branch: seconds, minutes, hours, days, months. */
    expect(formatRelative(new Date(Date.now() - 5_000))).toBe("5s ago");
    expect(formatRelative(new Date(Date.now() - 5 * 60_000))).toBe("5m ago");
    /* 3h ago — exercises the `hours < 24` arm (previously uncovered). */
    expect(formatRelative(new Date(Date.now() - 3 * 60 * 60_000))).toBe(
      "3h ago",
    );
    /* 5d ago — exercises the `days < 30` arm (previously uncovered). */
    expect(formatRelative(new Date(Date.now() - 5 * 24 * 60 * 60_000))).toBe(
      "5d ago",
    );
    expect(formatRelative(new Date(Date.now() - 90 * 24 * 60 * 60_000))).toBe(
      "3mo ago",
    );
  });

  it("formatRelative returns '—' for null/undefined", () => {
    expect(formatRelative(null)).toBe("—");
    expect(formatRelative(undefined)).toBe("—");
  });
});
