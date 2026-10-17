import { isVeoveoUrl } from './veoveoData.js';
import { isCollapsUrl } from './streamExtractor.js';

export function mediaUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function flattenPlayerProviders(providers) {
  const result = [];
  for (const provider of Array.isArray(providers) ? providers : []) {
    if (!provider || typeof provider !== 'object') continue;
    const name = String(provider.type || 'Источник');
    const variants = new Map();
    for (const entry of provider.translations || []) {
      const url = mediaUrl(entry?.iframeUrl);
      if (!url) continue;
      const prior = variants.get(url);
      if (prior) prior.names.push(entry.name || 'Озвучка');
      else variants.set(url, { url, names: [entry.name || 'Озвучка'] });
    }
    const base = mediaUrl(provider.iframeUrl);
    if (!variants.size && base) variants.set(base, { url: base, names: [] });
    for (const variant of variants.values()) {
      // Stable across refreshes; provider query parameters still distinguish voiceovers.
      let hash = 0;
      for (const char of variant.url) hash = Math.imul(hash, 31) + char.charCodeAt(0) | 0;
      const native = /\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(variant.url) || isCollapsUrl(variant.url) || isVeoveoUrl(variant.url);
      result.push({
        key: `${name}_${(hash >>> 0).toString(16)}`,
        label: variant.names.length === 1 ? `${variant.names[0]} (${name})` : variant.names.length > 1 ? `${name} · ${variant.names.length} озвучек в плеере` : name,
        iframeUrl: variant.url,
        provider: name,
        native,
        translations: variant.names,
      });
    }
  }
  return [...new Map(result.map(source => [source.key, source])).values()]
    .sort((a, b) => Number(b.native) - Number(a.native));
}

// Aggregators return different subsets. Keep usable sources from every mirror.
export async function collectProviderMirrors(requests) {
  const results = await Promise.allSettled(requests);
  return results.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
}

export function withEpisode(url, season, episode) {
  const normalized = mediaUrl(url);
  if (!normalized) return '';
  if (/\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(normalized)) return normalized;
  const target = new URL(normalized);
  target.searchParams.set('season', String(season || 1));
  target.searchParams.set('episode', String(episode || 1));
  return target.href;
}
