# ADR-004 — Neutral framing as a hard product constraint

- **Status:** Accepted
- **Date:** 2026-05
- **Authors:** Jason Lin

## Context

ThoughtTracker classifies stance in transcripts of real public figures.
That is uncomfortably close to two failure modes:

1. **Surveillance-tool framing.** A "track what creators believe" app
   reads as creepy even when technically restricted to public transcripts.
2. **Inflammatory mis-summarization.** A confident-sounding "this creator
   is supportive of X" headline can be wrong, lose context, or be used
   out of context to attack someone.

Both are easy to fall into, especially with LLMs that will happily write
confident summaries on whatever evidence you give them.

## Decision

Neutral, evidence-first framing is **a non-negotiable product constraint**,
enforced at every layer:

1. **Prompts.** Every prompt file in `backend/src/ai/prompts/`:

- Forbids inferring private beliefs.
- Forbids inflammatory wording.
- Requires an evidence quote with every stance classification.
- Requires `insufficient_evidence` (or `unclear`) when the text doesn't
  say enough.

2. **Schemas.** `StanceLabel` includes `unclear` and `insufficient_evidence`
   as first-class labels — not as last-resort fallbacks.
3. **Reports.** Every generated report carries a caveats panel:
   > "This report is based only on the imported transcript data available
   > in ThoughtTracker. It should be interpreted as an evidence-backed
   > summary of transcript patterns, not a definitive judgment of the
   > creator's beliefs."
4. **UI copy.** Headings and stat labels read as observations, not
   judgments: "Across imported transcripts, the expressed stance appears…"
5. **README.** The first non-trivial block of `README.md` is a framing
   disclaimer that anyone landing on the repo sees in the first 30 seconds.

## Tests for neutrality

- Backend integration tests check that report responses contain the
  literal phrase "transcript data" (so the caveat hasn't been silently
  removed).
- The mock LLM returns analytical, non-inflammatory language by
  construction.

## What good looks like

A new contributor adding a new prompt or analysis type **must** be able to
read this ADR and produce output that:

- Frames conclusions as "patterns in imported transcripts" not "what the
  creator believes."
- Surfaces an evidence quote.
- Includes a confidence label and a clear caveat.
- Never uses inflammatory wording (no "hypocrisy", "dishonest", "extremist",
  etc.).

If a PR drifts away from this posture, it should be rejected on the
substance, not the tests.

## Consequences

- LLM outputs are sometimes less "punchy" than they could be. That's the
  point.
- We give up on certain features intentionally: a "contradiction
  detector" headline, "biggest flips by creator" leaderboard, etc. Those
  are listed as future-roadmap items in the README but not built.
- Reviewers (recruiters, peers) should be able to look at this project
  and see deliberate restraint on a topic that's easy to over-claim about.

## Alternatives considered

- **Lean into the headline punch.** Rejected: the product is more useful
  long-term as an analyst tool, and the surveillance/judgment framing is
  a real reputational risk.
- **Disable the feature in the demo.** Rejected: defeats the purpose of
  the demo. The right answer is to do the feature *carefully*.
