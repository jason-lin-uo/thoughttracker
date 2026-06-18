export interface ResolvedChannel {
  channelId: string;
  handle: string;
  title: string;
  description: string;
  thumbnailUrl: string;
}

export interface DiscoveredVideo {
  sourceVideoId: string;
  sourceUrl: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  thumbnailUrl: string;
}

export interface FetchedTranscript {
  available: boolean;
  language: string;
  segments: Array<{ start: number; end: number; text: string }>;
  rawText: string;
}

export interface YoutubeProvider {
  resolveChannel(channelUrl: string): Promise<ResolvedChannel>;
  listRecentVideos(
    channelId: string,
    limit: number,
  ): Promise<DiscoveredVideo[]>;
  fetchTranscript(videoId: string): Promise<FetchedTranscript>;
}

class RealYoutubeProviderNotConfiguredError extends Error {
  constructor() {
    super(
      "Backend YouTube runtime import is not configured. Use the owner transcript refresh scripts and restore the real-data snapshot instead of creating unverified creator records.",
    );
    this.name = "RealYoutubeProviderNotConfiguredError";
  }
}

const unavailableProvider: YoutubeProvider = {
  async resolveChannel(): Promise<ResolvedChannel> {
    throw new RealYoutubeProviderNotConfiguredError();
  },
  async listRecentVideos(): Promise<DiscoveredVideo[]> {
    throw new RealYoutubeProviderNotConfiguredError();
  },
  async fetchTranscript(): Promise<FetchedTranscript> {
    throw new RealYoutubeProviderNotConfiguredError();
  },
};

/**
 * Return the product YouTube provider.
 *
 * The old runtime path fabricated creators/videos/transcripts when a real
 * provider was unavailable. That made the app look populated while hiding the
 * fact that no actual YouTube data had been imported. The product now refuses
 * that behavior: real transcript acquisition happens through the owner-managed
 * transcript refresh tooling and committed real-data snapshot.
 */
export function getYoutubeProvider(): YoutubeProvider {
  return unavailableProvider;
}

/**
 * validateChannelUrl - guard the channel URL the user pasted on the
 * Imports/Add Creator flow. Accepts the common YouTube channel URL shapes
 * (/channel/, /@handle, /c/, /user/) and rejects everything else.
 */
export function validateChannelUrl(url: string): boolean {
  if (!url) return false;
  return (
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url) ||
    url.startsWith("@") ||
    /^[A-Za-z0-9._-]+$/.test(url)
  );
}
