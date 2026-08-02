/**
 * Content-type detection for URLs — inspired by Nostra Search
 * (github.com/nostrasearch/nostrasearch.github.io, GPL-3.0).
 * Fresh implementation of the same idea: classify a link by protocol,
 * host, and file extension so results can show type badges and onion
 * links can be routed to the Tor tab with a warning.
 */

export type ContentType =
  | 'torrent'
  | 'onion'
  | 'ipfs'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'web'
  | 'other';

const VIDEO_EXTENSIONS = /\.(mp4|webm|mkv|avi|mov|m4v|ogv)(\?|#|$)/i;
const VIDEO_HOSTS = [
  'youtube.com', 'youtu.be', 'peertube', 'odysee.com', 'vimeo.com',
  'bitchute.com', 'rumble.com', 'dailymotion.com', 'twitch.tv',
];

const AUDIO_EXTENSIONS = /\.(mp3|ogg|wav|flac|aac|m4a|opus)(\?|#|$)/i;

/** Detect the content type of a URL / magnet / ipfs link. */
export function detectContentType(rawUrl: string): ContentType {
  const url = rawUrl.trim();
  if (!url) return 'other';

  // Protocol-level detection first.
  if (url.startsWith('magnet:?')) return 'torrent';
  if (url.startsWith('ipfs://') || url.includes('/ipfs/') || url.startsWith('ipns://')) return 'ipfs';
  if (url.includes('.onion')) return 'onion';

  // Extension-level detection.
  if (/\.pdf(\?|#|$)/i.test(url)) return 'pdf';
  if (VIDEO_EXTENSIONS.test(url)) return 'video';
  if (AUDIO_EXTENSIONS.test(url)) return 'audio';

  // Host-level detection for video platforms.
  let hostname = '';
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { /* not a standard URL */ }
  if (hostname && VIDEO_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`) || hostname.includes(h))) {
    return 'video';
  }

  if (url.startsWith('http://') || url.startsWith('https://')) return 'web';

  return 'other';
}

/** Display label for a content type (used as the result `kind` badge). */
export function contentTypeLabel(type: ContentType): string {
  switch (type) {
    case 'torrent': return 'Torrent';
    case 'onion': return '.onion';
    case 'ipfs': return 'IPFS';
    case 'video': return 'Video';
    case 'audio': return 'Audio';
    case 'pdf': return 'PDF';
    case 'web': return 'Link';
    case 'other': return 'Link';
  }
}

/**
 * Validate a user-submitted link for the community index.
 * Allows https/http, magnet:, ipfs:, ipns: — anything else is rejected
 * (blocks javascript:, data:, and other dangerous or useless schemes).
 */
export function isValidSubmissionUrl(rawUrl: string): boolean {
  const url = rawUrl.trim();
  if (!url || url.length > 2048) return false;

  if (url.startsWith('magnet:?')) return url.length > 20; // must carry an xt hash
  if (url.startsWith('ipfs://') || url.startsWith('ipns://')) return url.length > 15;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
