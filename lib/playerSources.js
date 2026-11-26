import { isVeoveoUrl } from './veoveoData.js';
import { isCollapsUrl } from './streamExtractor.js';
import { isRussianAudio } from './audioLanguage.js';
import { parseVibixSource, vibixSourceUrl } from './vibixEmbed.js';

export function mediaUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function flattenPlayerProviders(providers, { russianOnly = false, originalLanguage = '' } = {}) {
  const result = [];
  for (const provider of Array.isArray(providers) ? providers : []) {
    if (!provider || typeof provider !== 'object') continue;
    const name = String(provider.type || 'Источник');
    const variants = new Map();
    for (const entry of provider.translations || []) {
      const label = entry?.name || entry?.title || '';
      const language = entry?.language || entry?.lang || provider.language || provider.lang;
      const russian = !/^(subtitles?|subs)$/i.test(entry?.type || '') && isRussianAudio(label, language, {originalLanguage});
      if (russianOnly && !russian) continue;
      const url = mediaUrl(entry?.iframeUrl) || (/^vibix$/i.test(name) ? vibixSourceUrl(entry?.iframeUrl, entry?.id) : null);
      if (!url) continue;
      const prior = variants.get(url);
      const evidence = russian ? (language && !/^(und|unknown)$/i.test(language) ? 'language' : isRussianAudio(label) ? 'translation' : 'original-language') : '';
      const displayLabel = evidence === 'original-language' ? 'Русский оригинал' : label;
      if (prior) {
        prior.names.push(displayLabel || 'Озвучка');
        if (entry.id != null) prior.ids.push(String(entry.id));
        if (evidence) prior.evidence ||= evidence;
      } else variants.set(url, { url, names: [displayLabel || 'Озвучка'], ids: entry.id == null ? [] : [String(entry.id)], evidence });
    }
    const base = mediaUrl(provider.iframeUrl) || (/^vibix$/i.test(name) ? vibixSourceUrl(provider.iframeUrl) : null);
    const baseRussian = isRussianAudio(provider.name, provider.language || provider.lang, {originalLanguage});
    if (!variants.size && base && (!russianOnly || (!provider.translations?.length && baseRussian))) {
      const evidence = baseRussian ? (provider.language || provider.lang ? 'language' : isRussianAudio(provider.name) ? 'translation' : 'original-language') : '';
      variants.set(base, { url: base, names: evidence === 'original-language' ? ['Русский оригинал'] : [], ids: [], evidence });
    }
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
        translationIds: [...new Set(variant.ids)],
        audioLanguage: variant.evidence ? 'ru' : '',
        audioEvidence: variant.evidence,
      });
    }
  }
  return [...new Map(result.map(source => [source.key, source])).values()];
}

// Aggregators return different subsets. Keep usable sources from every mirror.
export async function collectProviderMirrors(requests) {
  const results = await Promise.allSettled(requests);
  return results.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
}

export function withEpisode(url, season, episode) {
  const normalized = parseVibixSource(url)?.url.href || mediaUrl(url);
  if (!normalized) return '';
  if (/\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(normalized)) return normalized;
  const target = new URL(normalized);
  target.searchParams.set('season', String(season || 1));
  target.searchParams.set('episode', String(episode || 1));
  return target.href;
}
