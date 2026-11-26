/** Read public player configuration as data; never execute provider scripts. */
export function isCollapsUrl(value) {
  try {
    const host = new URL(value?.startsWith('//') ? `https:${value}` : value).hostname;
    return ['ortified.ws', 'collaps.me', 'collaps.org'].some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}
export function findExtractableSource(entries) {
  return Array.isArray(entries) ? entries.find(entry => isCollapsUrl(entry.iframeUrl || entry.iframe || entry.link)) : null;
}

function jsonValue(html, field) {
  const match = new RegExp(`\\b${field}\\s*:\\s*([\\[{])`).exec(html);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  const stack = [];
  let quoted = false, escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '[' || char === '{') stack.push(char);
    else if (char === ']' || char === '}') {
      const open = stack.pop();
      if ((char === ']' && open !== '[') || (char === '}' && open !== '{')) return null;
      if (!stack.length) { try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; } }
    }
  }
  return null;
}
function safeStream(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function playbackData(source) {
  const hlsUrl = safeStream(source?.hls);
  if (!hlsUrl) return null;
  const audio = source.audio || {};
  const names = Array.isArray(audio.names) ? audio.names : [];
  const audioNames = Array.isArray(audio.order) ? audio.order.map(index => names[index] || '') : names;
  return { hlsUrl, audioNames, subtitles: (Array.isArray(source.cc) ? source.cc : []).filter(track => safeStream(track.url)) };
}
export function parseCollapsPlayback(html, season, episode) {
  const seasons = jsonValue(html, 'seasons');
  if (Array.isArray(seasons)) {
    // Match explicit IDs, never array offsets or the first stream on the page.
    const selectedSeason = seasons.find(item => String(item.season) === String(season));
    const selectedEpisode = selectedSeason?.episodes?.find(item => String(item.episode) === String(episode));
    if (!selectedEpisode || selectedEpisode.blocked || selectedSeason.blocked) return null;
    return playbackData(selectedEpisode);
  }
  const hlsMatch = /\bhls\s*:\s*("(?:\\.|[^"\\])*")/.exec(html);
  if (hlsMatch) {
    try { return playbackData({ hls: JSON.parse(hlsMatch[1]), audio: jsonValue(html, 'audio'), cc: jsonValue(html, 'cc') }); } catch { return null; }
  }
  // Compatibility with a simple page exposing exactly one manifest.
  const urls = [...new Set((html.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g) || []))];
  return urls.length === 1 ? playbackData({ hls: urls[0] }) : null;
}

export function collapsAvailability(html, { isSeries, season = 1, episode = 1 } = {}) {
  const seasons = jsonValue(html, 'seasons');
  if (Array.isArray(seasons)) {
    // An empty or malformed catalog is not reliable negative evidence.
    if (!seasons.length || !seasons.every(item => item && item.season != null && Array.isArray(item.episodes))) return 'unknown';
    const selected = seasons.find(item => String(item.season) === String(season));
    if (!selected) return 'unavailable';
    if (!selected.episodes.every(item => item && item.episode != null)) return 'unknown';
    const entry = selected.episodes.find(item => String(item.episode) === String(episode));
    if (!entry || selected.blocked || entry.blocked) return 'unavailable';
    return playbackData(entry) ? 'available' : 'unknown';
  }
  // A lone trailer/movie URL cannot confirm a requested series episode.
  return !isSeries && parseCollapsPlayback(html)?.hlsUrl ? 'available' : 'unknown';
}
async function loadPlayer(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return response.ok ? response.text() : null;
}
export async function extractCollapsStream(iframeUrl) {
  try {
    const url = iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl;
    const html = await loadPlayer(url);
    return html ? parseCollapsPlayback(html) : null;
  } catch { return null; }
}
export async function extractCollapsEpisodeData(iframeUrl, season, episode) {
  try {
    const url = new URL(iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl);
    url.searchParams.set('season', String(season));
    url.searchParams.set('episode', String(episode));
    const html = await loadPlayer(url.href);
    return html ? parseCollapsPlayback(html, season, episode) : null;
  } catch { return null; }
}
export async function extractCollapsEpisode(iframeUrl, season, episode) {
  return (await extractCollapsEpisodeData(iframeUrl, season, episode))?.hlsUrl || null;
}
