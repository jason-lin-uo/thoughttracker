import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  StanceBadge,
  ConfidenceBadge,
  TranscriptStatusBadge,
  AnalysisStatusBadge,
  ImportStatusBadge,
  TrendBadge,
} from "../../src/components/Badges";

describe("badges", () => {
  it("StanceBadge renders all 6 labels with human-readable text", () => {
    const labels = [
      "supportive",
      "opposed",
      "neutral",
      "mixed",
      "unclear",
      "insufficient_evidence",
    ] as const;
    for (const l of labels) {
      const { unmount } = render(<StanceBadge stance={l} />);
      expect(
        screen.getByText(new RegExp(l.replace(/_/g, " "), "i")),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("ConfidenceBadge appends 'confidence' suffix for every level", () => {
    /* Each level routes through a distinct tone arm (purple/blue/neutral). */
    const levels = ["high", "medium", "low"] as const;
    for (const c of levels) {
      const { unmount } = render(<ConfidenceBadge confidence={c} />);
      expect(
        screen.getByText(new RegExp(`${c} confidence`, "i")),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("TranscriptStatusBadge renders every status (each tone arm)", () => {
    const statuses = [
      "available",
      "manual",
      "pending",
      "unavailable",
      "failed",
    ] as const;
    for (const s of statuses) {
      const { unmount } = render(<TranscriptStatusBadge status={s} />);
      expect(screen.getByText(new RegExp(s, "i"))).toBeInTheDocument();
      unmount();
    }
  });

  it("AnalysisStatusBadge renders every status (each tone arm)", () => {
    const statuses = ["completed", "processing", "pending", "failed"] as const;
    for (const s of statuses) {
      const { unmount } = render(<AnalysisStatusBadge status={s} />);
      expect(screen.getByText(new RegExp(s, "i"))).toBeInTheDocument();
      unmount();
    }
  });

  it("ImportStatusBadge renders both job- and item-level statuses", () => {
    /*
     * Covers the merged ImportJobStatus + ImportJobItemStatus tone chain,
     * including the `transcript_imported || metadata_imported` binary arm.
     */
    const statuses = [
      "completed",
      "completed_with_errors",
      "processing",
      "pending",
      "failed",
      "transcript_unavailable",
      "analysis_completed",
      "transcript_imported",
      "metadata_imported",
    ] as const;
    for (const s of statuses) {
      const { unmount } = render(<ImportStatusBadge status={s} />);
      expect(
        screen.getByText(new RegExp(s.replace(/_/g, " "), "i")),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("TrendBadge renders every trend (each tone arm)", () => {
    const trends = [
      "stable",
      "gradual_shift",
      "abrupt_shift",
      "mixed",
      "insufficient_data",
    ] as const;
    for (const t of trends) {
      const { unmount } = render(<TrendBadge trend={t} />);
      expect(
        screen.getByText(new RegExp(t.replace(/_/g, " "), "i")),
      ).toBeInTheDocument();
      unmount();
    }
  });
});
