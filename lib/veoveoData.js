export function isVeoveoUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['geralovod.link', 'tazaromikaz.link', 'kurolesya.link'].includes(url.hostname) && !url.username && !url.password; } catch { return false; }
}

// Read only literal page configuration, never execute downloaded JavaScript.
export function parseVeoveoConfig(html, iframeUrl) {
  if (!isVeoveoUrl(iframeUrl)) return null;
  const movieId = new URL(iframeUrl).searchParams.get('movie_id');
  const base = html.match(/window\.ENV_BASE_URL\s*=\s*['"]([^'"]+)/)?.[1];
  if (!/^\d+$/.test(movieId || '') || !isVeoveoUrl(base)) return null;
  const endpoint = new URL(base);
  if (endpoint.pathname !== '/balancer-api/proxy/playlists' || endpoint.search || endpoint.hash) return null;
  const raw = html.match(/window\.REQUEST_HEADERS\s*=\s*({[^;]+})/)?.[1] || '';
  const headers = {};
  for (const match of raw.matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]*)['"]/g)) {
    if (['DLE-API-TOKEN', 'Iframe-Request-Id'].includes(match[1])) headers[match[1]] = match[2];
  }
  return headers['DLE-API-TOKEN'] ? { movieId, base, headers } : null;
}

export function selectVeoveoPlayback(episodes, { isSeries, season, episode, variant } = {}) {
  if (!Array.isArray(episodes)) return null;
  const selected = isSeries
    ? episodes.find(item => String(item.season?.order) === String(season) && String(item.order) === String(episode))
    : episodes.length === 1 ? episodes[0] : null;
  if (!selected || selected.blocked) return null;
  const variants = (selected.episodeVariants || []).filter(item => isVeoveoUrl(item.filepath));
  const chosen = variant ? variants.find(item => item.title === variant || String(item.id) === String(variant)) : variants[0];
  variants.sort((a, b) => Number(b === chosen) - Number(a === chosen));
  return chosen ? { hlsUrl: chosen.filepath, selectedVariant: String(chosen.id), variants: variants.map(item => ({ id: String(item.id), name: item.title || 'Озвучка', hlsUrl: item.filepath })) } : null;
}

export function nextVeoveoPlayback(result, failedIds) {
  const next = result?.variants?.find(item => !failedIds.has(item.id));
  return next ? { ...result, hlsUrl: next.hlsUrl, selectedVariant: next.id } : null;
}

export async function resolveVeoveo(iframeUrl, options, read) {
  const unavailable = reason => { options?.onUnavailable?.(reason); return null; };
  const config = parseVeoveoConfig((await read(iframeUrl)).data, iframeUrl);
  if (!config) return unavailable('provider_config');
  const query = new URLSearchParams({ domain: iframeUrl, locale: 'ru-RU', tz: 'UTC', referrer_host: 'http://localhost' });
  const availability = await read(`${config.base}/catalog-api/contents/${config.movieId}/available?${query}`, config.headers);
  if (JSON.parse(availability.data)?.available !== true) return unavailable('provider_unavailable');
  const response = await read(`${config.base}/catalog-api/episodes?content-id=${config.movieId}`, config.headers);
  const episodes = JSON.parse(response.data);
  // Provider IDs belong to one episode. Follow the translation name when a
  // shared iframe points to a variant from another episode of the same series.
  const linkedId = new URL(iframeUrl).searchParams.get('episode_variant_id');
  const linked = Array.isArray(episodes) && episodes.flatMap(item => item.episodeVariants || []).find(item => String(item.id) === linkedId);
  const selected = selectVeoveoPlayback(episodes, { ...options, variant: options?.variant || linked?.title });
  // Aggregator links can name a translation from a different episode. New
  // provider responses sometimes call all translations "Default" instead.
  // Never change the requested episode or an explicitly selected variant.
  if (selected || options?.variant) return selected;
  const fallback = selectVeoveoPlayback(episodes, { ...options, variant: undefined });
  if (fallback && linked?.title) fallback.notice = 'У этой серии источник изменил список озвучек. Выбрана доступная озвучка.';
  return fallback || unavailable('episode_stream_missing');
}
