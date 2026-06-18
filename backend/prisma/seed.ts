/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import { slugify } from "../src/utils/slugify";
import {
  cleanTranscriptText,
  countWords,
} from "../src/services/transcript.service";
import { chunkTranscript } from "../src/services/chunking.service";
import { EMBEDDING_DIM } from "../src/ai/embeddingClient";
import { ensureVectorExtensionAndIndex } from "./setup-db";

const prisma = new PrismaClient();

const TOPIC_TAXONOMY = [
  {
    name: "Artificial Intelligence",
    description: "AI capabilities, models, safety, and societal impact.",
  },
  {
    name: "Foreign Policy",
    description: "International relations, alliances, conflict, and diplomacy.",
  },
  {
    name: "Public Health",
    description: "Healthcare systems, pandemics, vaccines, and policy.",
  },
  {
    name: "Free Speech",
    description: "Expression rights, platform moderation, and censorship.",
  },
  {
    name: "Cryptocurrency",
    description: "Digital assets, blockchain, regulation, and adoption.",
  },
  {
    name: "Nutrition",
    description: "Diet, supplements, performance, and health outcomes.",
  },
  {
    name: "Economics",
    description: "Markets, inflation, fiscal policy, employment.",
  },
  {
    name: "Education",
    description: "Schools, curricula, learning outcomes, and reform.",
  },
  {
    name: "Media",
    description: "Journalism, narrative, platforms, and trust.",
  },
  {
    name: "Technology",
    description: "Hardware, software, platforms, and infrastructure.",
  },
];

/*
 * Seed creators are DETERMINISTIC TEST FIXTURES for the unit/e2e suites and CI
 * — they use real creator identities so the fixtures mirror the product, but
 * their videos/topics/stances below are SYNTHETIC (generated, not analyzed).
 * The real, model-analyzed data for these creators lands in the app DB via the
 * ingestion pipeline, never from this seed. (We intentionally omit "huberman"
 * here so the trained-model-demo e2e can still detect real-vs-seed data.)
 */
const CREATORS = [
  {
    name: "All-In Podcast",
    handle: "allin",
    description:
      "Roundtable on technology, markets, geopolitics, and policy from four investors and operators.",
    thumbnailColor: "0f172a",
  },
  {
    name: "Thomas DeLauer",
    handle: "delauer",
    description:
      "Long-form videos on nutrition, metabolic health, fasting, and performance.",
    thumbnailColor: "1e293b",
  },
  {
    name: "John Campea",
    handle: "campea",
    description:
      "Daily conversations on film, the entertainment industry, media, and technology.",
    thumbnailColor: "0e2233",
  },
];

const STANCE_PROFILES: Record<
  string,
  Record<string, "supportive" | "opposed" | "neutral" | "mixed">
> = {
  allin: {
    "Artificial Intelligence": "mixed",
    "Foreign Policy": "neutral",
    "Public Health": "supportive",
    "Free Speech": "supportive",
    Cryptocurrency: "opposed",
    Nutrition: "neutral",
    Economics: "neutral",
    Education: "supportive",
    Media: "mixed",
    Technology: "supportive",
  },
  delauer: {
    "Artificial Intelligence": "opposed",
    "Foreign Policy": "mixed",
    "Public Health": "mixed",
    "Free Speech": "mixed",
    Cryptocurrency: "neutral",
    Nutrition: "supportive",
    Economics: "opposed",
    Education: "supportive",
    Media: "opposed",
    Technology: "neutral",
  },
  campea: {
    "Artificial Intelligence": "supportive",
    "Foreign Policy": "neutral",
    "Public Health": "neutral",
    "Free Speech": "supportive",
    Cryptocurrency: "supportive",
    Nutrition: "neutral",
    Economics: "supportive",
    Education: "neutral",
    Media: "mixed",
    Technology: "supportive",
  },
};

const TITLE_TEMPLATES = [
  "Where I land on {topic} in {year}",
  "A long sit-down on {topic}",
  "{topic} — three things I want to say",
  "Revisiting {topic} after a year",
  "What I think about {topic} right now",
  "{topic}: the conversation we should be having",
];

const SUPPORTIVE_LINES = [
  "I think we should embrace this. The benefits are real and the downside is overstated.",
  "I'm in favor of moving forward here. We have to encourage progress, not block it.",
  "This is a great example of what we need to do more of.",
  "I believe the data is on our side on this one.",
];
const OPPOSED_LINES = [
  "I disagree with this direction. It worries me, and I think it's harmful in ways we underrate.",
  "The problem with this approach is that we shouldn't be normalizing it.",
  "I am against rolling this out without more scrutiny.",
  "I worry we're missing the long-term cost here.",
];
const NEUTRAL_LINES = [
  "According to the data, there are tradeoffs in both directions.",
  "Research shows the picture is more complicated than people often assume.",
  "On one hand the upside is clear; the question is the magnitude.",
];
const MIXED_LINES = [
  "However, at the same time, I want to acknowledge the other side has reasonable points.",
  "But also, we need to be honest that this isn't all one way.",
];
const FILLER = [
  "Let me say a word about that.",
  "I want to take a minute on this.",
  "This is something I get asked about a lot.",
  "Anyway, that's where I am right now.",
  "I'll come back to that in a second.",
];

function generateTranscriptFor(
  topic: string,
  stance: "supportive" | "opposed" | "neutral" | "mixed",
): string {
  const lines: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    lines.push(FILLER[i % FILLER.length]!);
    if (stance === "supportive")
      lines.push(SUPPORTIVE_LINES[i % SUPPORTIVE_LINES.length]!);
    else if (stance === "opposed")
      lines.push(OPPOSED_LINES[i % OPPOSED_LINES.length]!);
    else if (stance === "mixed") {
      lines.push(SUPPORTIVE_LINES[i % SUPPORTIVE_LINES.length]!);
      lines.push(MIXED_LINES[i % MIXED_LINES.length]!);
      lines.push(OPPOSED_LINES[(i + 1) % OPPOSED_LINES.length]!);
    } else {
      lines.push(NEUTRAL_LINES[i % NEUTRAL_LINES.length]!);
    }
    lines.push(
      `When it comes to ${topic.toLowerCase()}, I want to be clear about what I mean. People sometimes hear what they want to hear, but I want to be measured about this.`,
    );
  }
  return lines.join("\n");
}

function pickEvidenceQuote(text: string, idx: number): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 20 && s.length < 200);
  return sentences[idx % Math.max(1, sentences.length)] ?? text.slice(0, 160);
}

function confidenceLabelFor(score: number): "low" | "medium" | "high" {
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

async function main() {
  /*
   * ---- SAFETY GUARD --------------------------------------------------------
   * `db:seed` deletes + repopulates EVERY table (see the cleanup block below),
   * so running it against a real/dev database destroys data. Refuse unless the
   * target DB name ends in `_test`, we're in CI (ephemeral DB), or `ALLOW_SEED=1`
   * is set explicitly. This closes the hole that let a stray `db:seed` wipe the
   * ingested dev data — mirrors the same guard in `tests/globalSetup.ts`.
   */
  const dbUrl = process.env.DATABASE_URL ?? "";
  const dbName =
    (/\/([^/?]+)(?:\?|$)/.exec(dbUrl.replace(/^[a-z]+:\/\/[^/]+/i, "")) ??
      [])[1] ?? "";
  const seedIsCI = process.env.CI === "true" || process.env.CI === "1";
  const seedAllowed = process.env.ALLOW_SEED === "1";
  if (!seedIsCI && !seedAllowed && !/_test$/.test(dbName)) {
    throw new Error(
      `Refusing to seed database "${dbName || "(unparsed)"}": db:seed DELETES + repopulates all tables and ` +
        `would DESTROY data in a real/dev database. Point DATABASE_URL at a *_test database, or set ` +
        `ALLOW_SEED=1 (or CI=1) to explicitly override.`,
    );
  }

  console.log("Seeding ThoughtTracker test fixture data...");

  /*
   * ---- pgvector extension + HNSW index -------------------------------------
   * Ensure the native vector column's extension and ANN index exist before we
   * dual-write embeddings below, so the seeded DB matches the "HNSW-indexed
   * ANN" claim in every environment (the CI seed step is what guarantees the
   * index exists in CI). Best-effort: a base Postgres without pgvector just
   * keeps the JSON-cosine fallback working.
   */
  try {
    const setup = await ensureVectorExtensionAndIndex(prisma);
    if (setup.indexReady)
      console.log("✔ pgvector extension + HNSW index ready");
  } catch (err) {
    console.warn("pgvector setup skipped:", (err as Error).message);
  }

  /* ---- Clean --------------------------------------------------------------- */
  await prisma.report.deleteMany({});
  await prisma.creatorTopicTimeline.deleteMany({});
  await prisma.videoTopicSummary.deleteMany({});
  await prisma.chunkTopicAnalysis.deleteMany({});
  await prisma.embedding.deleteMany({});
  await prisma.transcriptChunk.deleteMany({});
  await prisma.transcript.deleteMany({});
  await prisma.importJobItem.deleteMany({});
  await prisma.importJob.deleteMany({});
  await prisma.video.deleteMany({});
  await prisma.sourceChannel.deleteMany({});
  await prisma.creator.deleteMany({});
  await prisma.topic.deleteMany({});
  await prisma.analysisRun.deleteMany({});

  /* ---- Topics -------------------------------------------------------------- */
  const topics: Array<{ id: string; name: string; slug: string }> = [];
  for (const topicInput of TOPIC_TAXONOMY) {
    const slug = slugify(topicInput.name);
    const topic = await prisma.topic.create({
      data: {
        name: topicInput.name,
        slug,
        description: topicInput.description,
        source: "system_default",
      },
    });
    topics.push({ id: topic.id, name: topic.name, slug: topic.slug });
  }

  /* ---- Creators ------------------------------------------------------------ */
  const now = Date.now();
  for (const creatorInput of CREATORS) {
    const slug = slugify(creatorInput.handle);
    const creator = await prisma.creator.create({
      data: {
        name: creatorInput.name,
        slug,
        description: creatorInput.description,
        thumbnailUrl: `https://placehold.co/200x200/${creatorInput.thumbnailColor}/ffffff?text=${encodeURIComponent(
          creatorInput.name.slice(0, 2).toUpperCase(),
        )}`,
        creatorType: "youtube_channel",
      },
    });

    const sourceChannel = await prisma.sourceChannel.create({
      data: {
        creatorId: creator.id,
        platform: "youtube",
        channelUrl: `https://www.youtube.com/@${creatorInput.handle}`,
        channelId: `UC_${slug}_${slug.length}`,
        handle: creatorInput.handle,
        title: creatorInput.name,
        description: creatorInput.description,
        thumbnailUrl: creator.thumbnailUrl,
        lastImportedAt: new Date(now),
      },
    });

    /* ---- Videos (12 per creator) ------------------------------------------ */
    const videos: Array<{
      id: string;
      title: string;
      topic: string;
      publishedAt: Date;
      stance: string;
    }> = [];
    for (let i = 0; i < 12; i += 1) {
      const topic = TOPIC_TAXONOMY[i % TOPIC_TAXONOMY.length]!;
      const stanceProfile =
        STANCE_PROFILES[creatorInput.handle]?.[topic.name] ?? "neutral";
      const publishedAt = new Date(
        now - i * 1000 * 60 * 60 * 24 * 21,
      ); /* ~3 weeks apart */
      const titleTemplate = TITLE_TEMPLATES[i % TITLE_TEMPLATES.length]!;
      const title = titleTemplate
        .replace("{topic}", topic.name)
        .replace("{year}", String(publishedAt.getUTCFullYear()));
      const sourceVideoId = `seed_${slug}_${i}`;
      const video = await prisma.video.create({
        data: {
          creatorId: creator.id,
          sourceChannelId: sourceChannel.id,
          platform: "youtube",
          sourceVideoId,
          sourceUrl: `https://www.youtube.com/watch?v=${sourceVideoId}`,
          title,
          description: `An episode in which ${creator.name} discusses ${topic.name}.`,
          publishedAt,
          durationSeconds: 1200 + i * 60,
          thumbnailUrl: `https://placehold.co/480x270/${creatorInput.thumbnailColor}/ffffff?text=${encodeURIComponent(
            topic.name,
          )}`,
          transcriptStatus: i === 11 ? "unavailable" : "available",
          analysisStatus: i === 11 ? "pending" : "completed",
        },
      });

      /* Last video has no transcript on purpose so the UI can showcase fallback. */
      if (i === 11) {
        videos.push({
          id: video.id,
          title,
          topic: topic.name,
          publishedAt,
          stance: stanceProfile,
        });
        continue;
      }

      /* Build transcript + chunks */
      const rawText = generateTranscriptFor(
        topic.name,
        stanceProfile as "supportive" | "opposed" | "neutral" | "mixed",
      );
      const cleaned = cleanTranscriptText(rawText);
      const transcript = await prisma.transcript.create({
        data: {
          videoId: video.id,
          sourceType: "manual_upload",
          language: "en",
          rawText,
          cleanedText: cleaned,
          wordCount: countWords(cleaned),
        },
      });

      const builtChunks = chunkTranscript({ text: cleaned });
      for (const builtChunk of builtChunks) {
        const chunk = await prisma.transcriptChunk.create({
          data: {
            transcriptId: transcript.id,
            videoId: video.id,
            chunkIndex: builtChunk.chunkIndex,
            text: builtChunk.text,
            startSeconds: builtChunk.startSeconds,
            endSeconds: builtChunk.endSeconds,
            tokenCount: builtChunk.tokenCount,
          },
        });
        /*
         * Embed fixture chunks for owner/offline vector maintenance coverage.
         */
        const vector = new Array<number>(EMBEDDING_DIM).fill(0);
        const model = "test-fixture-vector-v1";
        const embedding = await prisma.embedding.create({
          data: {
            chunkId: chunk.id,
            embeddingModel: model,
            vectorJson: vector,
          },
        });
        /*
         * Best-effort populate the native pgvector column; silently skip
         * when the extension isn't installed so the seed still works on
         * base Postgres.
         */
        try {
          const vectorLiteral = `[${vector.join(",")}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE "Embedding" SET vector = $1::vector WHERE id = $2`,
            vectorLiteral,
            embedding.id,
          );
        } catch {
          /* pgvector not available — JSON-cosine fallback will be used. */
        }
      }

      videos.push({
        id: video.id,
        title,
        topic: topic.name,
        publishedAt,
        stance: stanceProfile,
      });
    }

    /* ---- Analysis runs + chunk topic analyses + video summaries ---------- */
    const detectionRun = await prisma.analysisRun.create({
      data: {
        analysisType: "topic_detection",
        status: "completed",
        provider: "test_fixture",
        modelName: "test-fixture-v1",
        promptVersion: "topic-detection-v1",
        startedAt: new Date(now),
        completedAt: new Date(now),
      },
    });

    const stanceRun = await prisma.analysisRun.create({
      data: {
        analysisType: "stance_classification",
        status: "completed",
        provider: "test_fixture",
        modelName: "test-fixture-v1",
        promptVersion: "stance-classification-v1",
        startedAt: new Date(now),
        completedAt: new Date(now),
      },
    });

    const summaryRun = await prisma.analysisRun.create({
      data: {
        analysisType: "video_summary",
        status: "completed",
        provider: "test_fixture",
        modelName: "test-fixture-v1",
        promptVersion: "video-topic-summary-v1",
        startedAt: new Date(now),
        completedAt: new Date(now),
      },
    });

    for (const v of videos) {
      const dbVideo = await prisma.video.findUnique({
        where: { id: v.id },
        include: { chunks: { orderBy: { chunkIndex: "asc" } } },
      });
      if (!dbVideo || dbVideo.chunks.length === 0) continue;
      const primaryTopic = topics.find((t) => t.name === v.topic);
      if (!primaryTopic) continue;
      const stanceProfile = v.stance as
        | "supportive"
        | "opposed"
        | "neutral"
        | "mixed";

      /* Stance analyses for the primary topic — high relevance */
      for (const chunk of dbVideo.chunks) {
        const score = 0.6 + (chunk.chunkIndex % 4) * 0.08;
        await prisma.chunkTopicAnalysis.create({
          data: {
            chunkId: chunk.id,
            videoId: dbVideo.id,
            creatorId: creator.id,
            topicId: primaryTopic.id,
            analysisRunId: stanceRun.id,
            relevanceScore: Math.min(0.95, score),
            stanceLabel: stanceProfile,
            confidenceScore: Math.min(0.95, score),
            confidenceLabel: confidenceLabelFor(score),
            claimSummary: `Speaker discusses ${primaryTopic.name.toLowerCase()} in this segment.`,
            rationale: `The chunk contains language consistent with a ${stanceProfile} stance toward ${primaryTopic.name.toLowerCase()}. No private beliefs are inferred.`,
            evidenceQuote: pickEvidenceQuote(chunk.text, chunk.chunkIndex),
          },
        });
      }

      /* Light-touch secondary analyses for two other topics (lower relevance) */
      const secondaryTopics = topics
        .filter((t) => t.id !== primaryTopic.id)
        .slice(0, 2);
      for (const secondaryTopic of secondaryTopics) {
        const chunk = dbVideo.chunks[0]!;
        await prisma.chunkTopicAnalysis.create({
          data: {
            chunkId: chunk.id,
            videoId: dbVideo.id,
            creatorId: creator.id,
            topicId: secondaryTopic.id,
            analysisRunId: stanceRun.id,
            relevanceScore: 0.3,
            stanceLabel: "insufficient_evidence",
            confidenceScore: 0.3,
            confidenceLabel: "low",
            claimSummary: `Brief tangential mention of ${secondaryTopic.name.toLowerCase()}.`,
            rationale:
              "Mention is tangential; not enough evidence to classify a stance.",
            evidenceQuote: pickEvidenceQuote(chunk.text, 1),
          },
        });
      }

      /* Video summary */
      const mentionCount = dbVideo.chunks.length;
      await prisma.videoTopicSummary.create({
        data: {
          videoId: dbVideo.id,
          creatorId: creator.id,
          topicId: primaryTopic.id,
          analysisRunId: summaryRun.id,
          dominantStance: stanceProfile,
          confidenceScore: 0.75,
          confidenceLabel: "high",
          mentionCount,
          summary: `Across the chunks in this video, the expressed stance toward ${primaryTopic.name.toLowerCase()} appears ${stanceProfile.replace(
            /_/g,
            " ",
          )}. The speaker references the topic in roughly ${mentionCount} segments.`,
          notableEvidence: dbVideo.chunks.slice(0, 3).map((c) => ({
            chunkIndex: c.chunkIndex,
            quote: pickEvidenceQuote(c.text, c.chunkIndex),
          })),
        },
      });
    }

    /* ---- Timelines per topic --------------------------------------------- */
    const timelineRun = await prisma.analysisRun.create({
      data: {
        analysisType: "creator_timeline",
        status: "completed",
        provider: "test_fixture",
        modelName: "test-fixture-v1",
        promptVersion: "creator-timeline-v1",
        startedAt: new Date(now),
        completedAt: new Date(now),
      },
    });

    const topicGroups = new Map<
      string,
      { topic: string; videos: typeof videos }
    >();
    for (const v of videos) {
      const g = topicGroups.get(v.topic) ?? { topic: v.topic, videos: [] };
      g.videos.push(v);
      topicGroups.set(v.topic, g);
    }
    for (const [, group] of topicGroups) {
      if (group.videos.length < 2) continue;
      const topic = topics.find((t) => t.name === group.topic);
      if (!topic) continue;
      const dates = group.videos
        .map((v) => v.publishedAt)
        .sort((a, b) => a.getTime() - b.getTime());
      const trendLabel =
        group.videos[0]?.stance ===
        group.videos[group.videos.length - 1]?.stance
          ? "stable"
          : "gradual_shift";
      await prisma.creatorTopicTimeline.create({
        data: {
          creatorId: creator.id,
          topicId: topic.id,
          analysisRunId: timelineRun.id,
          dateStart: dates[0]!,
          dateEnd: dates[dates.length - 1]!,
          trendLabel,
          summary: `Across imported transcripts, the expressed stance of ${creator.name} toward ${topic.name.toLowerCase()} appears ${trendLabel.replace(
            "_",
            " ",
          )} across ${group.videos.length} videos.`,
          evidence: group.videos.slice(0, 5).map((v) => ({
            videoId: v.id,
            publishedAt: v.publishedAt.toISOString(),
            note: `Dominant stance ${v.stance}.`,
          })),
        },
      });
    }

    /* ---- One creator summary report -------------------------------------- */
    const creatorReportRun = await prisma.analysisRun.create({
      data: {
        analysisType: "creator_report",
        status: "completed",
        provider: "test_fixture",
        modelName: "test-fixture-v1",
        promptVersion: "creator-report-v1",
        startedAt: new Date(now),
        completedAt: new Date(now),
      },
    });
    await prisma.report.create({
      data: {
        creatorId: creator.id,
        reportType: "creator_summary",
        title: `Creator Summary: ${creator.name}`,
        summary: `Across imported transcripts for ${creator.name}, recurring themes include ${TOPIC_TAXONOMY.slice(
          0,
          5,
        )
          .map((t) => t.name.toLowerCase())
          .join(", ")}.`,
        caveats:
          "This report is based only on the imported transcript data available in ThoughtTracker. It should be interpreted as an evidence-backed summary of transcript patterns, not a definitive judgment of the creator's beliefs.",
        evidence: {
          sections: [
            {
              heading: "Top Topics",
              body: TOPIC_TAXONOMY.slice(0, 5)
                .map((t) => `• ${t.name}`)
                .join("\n"),
            },
            {
              heading: "Limitations",
              body: "Findings are limited to the subset of videos imported into ThoughtTracker. Stance is inferred from transcript text only — not audio tone or prosody.",
            },
          ],
          evidence: [
            {
              videoId: videos[0]!.id,
              videoTitle: videos[0]!.title,
              note: "Representative source episode with a transcript available in ThoughtTracker.",
            },
          ],
        },
        analysisRunId: creatorReportRun.id,
      },
    });

    /* ---- Fixture completed import job ------------------------------------ */
    await prisma.importJob.create({
      data: {
        creatorId: creator.id,
        sourceChannelId: sourceChannel.id,
        channelUrl: `https://www.youtube.com/@${creatorInput.handle}`,
        requestedLimit: 25,
        status: "completed",
        totalVideosFound: 12,
        totalVideosImported: 12,
        totalTranscriptsImported: 11,
        totalFailed: 0,
        startedAt: new Date(now - 1000 * 60 * 60),
        completedAt: new Date(now - 1000 * 60 * 50),
      },
    });
  }

  console.log("✔ Seed complete.");
}

main()
  .catch(async (e) => {
    console.error("Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
