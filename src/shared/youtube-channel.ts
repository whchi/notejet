const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const YOUTUBE_VIDEO_BASE_URL = 'https://www.youtube.com/watch';

export function extractYouTubeChannelIdentifier(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch (_error) {
    return null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0] || '';

  if (first === 'channel' && segments[1]?.startsWith('UC')) {
    const channelId = segments[1];
    return {
      type: 'channelId',
      value: channelId,
      canonicalUrl: `https://www.youtube.com/channel/${channelId}`,
    };
  }

  if (first.startsWith('@') && first.length > 1) {
    return {
      type: 'handle',
      value: first,
      canonicalUrl: `https://www.youtube.com/${first}`,
    };
  }

  return null;
}

export function mapYouTubePlaylistItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(item => {
      const snippet = item?.snippet || {};
      const videoId = snippet?.resourceId?.videoId || item?.contentDetails?.videoId;
      if (!videoId) {
        return null;
      }

      return {
        id: String(videoId),
        title: String(snippet.title || 'Untitled video'),
        url: buildYouTubeVideoUrl(videoId),
        channelTitle: String(snippet.channelTitle || ''),
        publishedAt: String(snippet.publishedAt || ''),
        thumbnailUrl: getThumbnailUrl(snippet.thumbnails),
      };
    })
    .filter(Boolean);
}

export function filterYouTubeVideosByQuery(videos, query) {
  if (!Array.isArray(videos)) {
    return [];
  }

  const normalizedQuery = String(query || '')
    .trim()
    .toLowerCase();
  if (!normalizedQuery) {
    return videos;
  }

  return videos.filter(video => {
    const title = String(video?.title || '').toLowerCase();
    const channelTitle = String(video?.channelTitle || '').toLowerCase();
    return title.includes(normalizedQuery) || channelTitle.includes(normalizedQuery);
  });
}

function buildYouTubeVideoUrl(videoId) {
  const url = new URL(YOUTUBE_VIDEO_BASE_URL);
  url.searchParams.set('v', String(videoId || ''));
  return url.toString();
}

function getThumbnailUrl(thumbnails) {
  if (!thumbnails || typeof thumbnails !== 'object') {
    return '';
  }

  const fallback = Object.values(thumbnails).find(
    item => item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string',
  ) as { url?: string } | undefined;

  return thumbnails.medium?.url || thumbnails.high?.url || thumbnails.default?.url || fallback?.url || '';
}
