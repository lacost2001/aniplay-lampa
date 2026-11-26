import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createApp } from '../server.mjs';
import { isVeoveoUrl, selectVeoveoPlayback } from '../lib/veoveoData.js';

function call(app, path) {
  return new Promise(resolve => {
    const res = { setHeader() {}, writeHead(code) { this.code = code; }, end(body) { resolve({ code: this.code ?? 200, body: String(body || '') }); } };
    app({ method: 'GET', url: path }, res);
  });
}

test('current Veoveo host (player.shortener2.link) plays in Lampa, not as an iframe', async () => {
  assert.equal(isVeoveoUrl('https://player.shortener2.link/balancer-api/iframe?movie_id=7'), true);
  assert.equal(isVeoveoUrl('https://player.shortener2.link:8443/x'), false);
  const app = createApp({ apiKey: 'test', read: async url => {
    if (url.includes('/movie/603?')) return JSON.stringify({ title: 'Matrix', imdb_id: 'tt0133093' });
    if (url.includes('/api/players?')) return JSON.stringify([
      { type: 'Alloha', iframeUrl: 'https://alloha.example/embed/1' },
      { type: 'Vibix', iframeUrl: '<ins data-publisher-id="1" data-type="movie" data-id="2"></ins>' },
      { type: 'Veoveo', iframeUrl: 'https://player.shortener2.link/balancer-api/iframe?movie_id=7' },
    ]);
    throw Error('Unexpected request ' + url);
  } });
  const { sources } = JSON.parse((await call(app, '/api/sources?id=603&type=movie')).body);
  assert.ok(sources.every(s => !/vibix/i.test(s.id)), 'Vibix needs a browser SDK and must not be offered');
  assert.equal(sources[0].supported, true, 'playable sources are listed first');
  assert.match(sources[0].id, /^Veoveo/);
});

test('Veoveo prefers Russian audio but never drops an episode labelled only "Default"', () => {
  const variant = (id, title) => ({ id, title, filepath: `https://player.shortener2.link/p/${id}.m3u8` });
  const mixed = selectVeoveoPlayback([{ episodeVariants: [variant(1, 'English'), variant(2, 'Дубляж')] }], {});
  assert.equal(mixed.selectedVariant, '2');
  const unlabeled = selectVeoveoPlayback([{ episodeVariants: [variant(3, 'Default')] }], {});
  assert.equal(unlabeled.selectedVariant, '3');
});

test('plugin finds its server address without document.currentScript (TV builds)', () => {
  let param;
  const element = { on() { return this; }, eq() { return this; }, append() { return this; } };
  const Lampa = { Listener: { follow() {} }, SettingsApi: { addComponent() {}, addParam(value) { param = value; } }, Manifest: { set plugins(value) {} } };
  const document = { currentScript: null, getElementsByTagName: () => [{ src: 'https://lampa.example/app.js' }, { src: 'https://aniplay.example/aniplay.js?v=2' }] };
  vm.runInContext(readFileSync(new URL('../public/aniplay.js', import.meta.url), 'utf8'), vm.createContext({ window: { appready: true }, document, Lampa, $: () => element }));
  assert.equal(param.param.default, 'https://aniplay.example');
});
