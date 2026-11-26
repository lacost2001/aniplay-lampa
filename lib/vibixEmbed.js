// Vibix returns SDK attributes, not an iframe URL. Keep a validated internal
// locator until the selected player mounts; never insert provider markup.
const positiveId = value => /^[1-9]\d{0,15}$/.test(String(value ?? ''));

export function vibixSourceUrl(value, translationId) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let text = value.trim();
  const queryMatch = text.match(/\?voiceover=([1-9]\d{0,15})$/);
  const queryVoice = queryMatch?.[1];
  if (queryMatch) text = text.slice(0, queryMatch.index).trim();
  if (text.startsWith('<ins ')) {
    const tag = text.match(/^<ins\s+([^<>]+)>\s*<\/ins>$/i);
    if (!tag) return null;
    text = tag[1];
  }
  const attributes = {};
  const rest = text.replace(/(data-(?:publisher-id|type|id|voiceover))\s*=\s*(["'])([^"']*)\2/g, (_, key, quote, data) => {
    if (Object.hasOwn(attributes, key)) attributes.invalid = true;
    attributes[key] = data;
    return '';
  });
  if (rest.trim() || attributes.invalid || !positiveId(attributes['data-publisher-id']) || !positiveId(attributes['data-id']) || !['movie', 'serial', 'series'].includes(attributes['data-type'])) return null;
  const voices = [translationId, queryVoice, attributes['data-voiceover']].filter(item => item != null).map(String);
  if (voices.some(voice => !positiveId(voice)) || new Set(voices).size > 1) return null;
  const type = attributes['data-type'] === 'series' ? 'serial' : attributes['data-type'];
  const url = new URL(`vibix://embed/${type}/${attributes['data-id']}`);
  url.searchParams.set('publisher', attributes['data-publisher-id']);
  if (voices[0]) url.searchParams.set('voiceover', voices[0]);
  return url.href;
}

export function parseVibixSource(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/(movie|serial)\/([1-9]\d{0,15})$/);
    if (url.protocol !== 'vibix:' || url.host !== 'embed' || url.username || url.password || !match || !positiveId(url.searchParams.get('publisher'))) return null;
    const voiceover = url.searchParams.get('voiceover');
    if (voiceover !== null && !positiveId(voiceover)) return null;
    return { url, type: match[1], id: match[2], publisher: url.searchParams.get('publisher'), voiceover };
  } catch { return null; }
}

// These attributes are handled by the official Rendex SDK v2. In particular,
// data-episodes (plural) becomes episode[]=N; data-episode is ignored by it.
export function vibixPlayerAttributes(value) {
  const source = parseVibixSource(value);
  if (!source) return null;
  const attributes = {
    'data-publisher-id': source.publisher,
    'data-type': source.type,
    'data-id': source.id,
    'data-width': '100%',
    'data-height': '100%',
    'data-sync': 'true',
  };
  if (source.voiceover) {
    attributes['data-voiceover'] = source.voiceover;
    attributes['data-voiceover-only'] = 'true';
  }
  if (source.type === 'serial') {
    const season = source.url.searchParams.get('season') ?? '1';
    const episode = source.url.searchParams.get('episode') ?? '1';
    if (!/^\d{1,4}$/.test(season) || !/^[1-9]\d{0,4}$/.test(episode)) return null;
    attributes['data-season'] = season;
    attributes['data-episodes'] = episode;
  }
  return attributes;
}

const sdkLoads = new WeakMap();
const sdkUrls = ['https://graphicslab.io/sdk/v2/rendex-sdk.min.js', 'https://alt.graphicslab.io/sdk/v2/rendex-sdk.min.js'];
export function loadVibixSdk({ document = globalThis.document } = {}) {
  const scope = document.defaultView;
  if (typeof scope.RendexSDK?.process === 'function') return Promise.resolve(scope.RendexSDK);
  if (sdkLoads.has(document)) return sdkLoads.get(document);
  const pending = (async () => {
    for (const src of sdkUrls) {
      try {
        return await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          let settled = false;
          const finish = failed => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            script.onload = script.onerror = null;
            if (failed || typeof scope.RendexSDK?.process !== 'function') {
              script.remove();
              reject(new Error('Vibix SDK unavailable'));
            } else resolve(scope.RendexSDK);
          };
          const timer = setTimeout(() => finish(true), 10000);
          script.src = src;
          script.async = true;
          script.onload = () => finish(false);
          script.onerror = () => finish(true);
          document.head.appendChild(script);
        });
      } catch { /* The official alternative is used only if the primary failed. */ }
    }
    throw new Error('Не удалось загрузить плеер Vibix. Попробуйте повторить или выбрать другой источник.');
  })();
  sdkLoads.set(document, pending);
  pending.then(() => sdkLoads.delete(document), () => sdkLoads.delete(document));
  return pending;
}

let nextInstance = 0;
export function mountVibixPlayer(container, value, { onReady, onError, initialTime, autoPlay = false, title = 'Vibix — источник видео', loadSdk = loadVibixSdk } = {}) {
  const attributes = vibixPlayerAttributes(value);
  if (!attributes) { onError?.('Источник Vibix вернул некорректные параметры. Обновите источники.'); return () => {}; }
  if (autoPlay) attributes['data-autoplay'] = 'true';
  const startFrom = Number(initialTime ?? parseVibixSource(value).url.searchParams.get('start_from'));
  const document = container.ownerDocument;
  let disposed = false, activeFrame = null, ready = false;
  const loaded = () => { if (!disposed && !ready) { ready = true; onReady?.(); } };
  const failed = () => { if (!disposed) onError?.('Не удалось подключиться к Vibix. Выберите другой источник или повторите загрузку.'); };
  function attach(frame) {
    if (disposed || !frame || frame === activeFrame || frame.tagName !== 'IFRAME' || !container.contains(frame)) return;
    activeFrame?.removeEventListener('load', loaded);
    activeFrame?.removeEventListener('error', failed);
    activeFrame = frame;
    frame.title = title;
    frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('data-aniplay-start-from', Number.isFinite(startFrom) && startFrom > 0 ? String(startFrom) : '0');
    frame.setAttribute('data-aniplay-autoplay', String(autoPlay));
    frame.addEventListener('load', loaded);
    frame.addEventListener('error', failed);
  }
  const created = event => attach(event.detail?.iframe || event.iframe);
  document.addEventListener('rendexIframeReady', created);
  const ins = document.createElement('ins');
  ins.id = `aniplay-vibix-${++nextInstance}`;
  for (const [key, data] of Object.entries(attributes)) ins.setAttribute(key, data);
  container.replaceChildren(ins);
  loadSdk({ document }).then(sdk => {
    if (disposed) return;
    // The SDK may already have processed the element on its initial DOM scan.
    if (ins.parentNode === container) sdk.process(ins);
    attach(container.querySelector('iframe'));
    if (!activeFrame) failed();
  }).catch(failed);
  return () => {
    disposed = true;
    document.removeEventListener('rendexIframeReady', created);
    activeFrame?.removeEventListener('load', loaded);
    activeFrame?.removeEventListener('error', failed);
    container.replaceChildren();
  };
}
