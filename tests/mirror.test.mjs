import test from 'node:test';
import assert from 'node:assert/strict';
import { isVeoveoUrl, parseVeoveoConfig, selectVeoveoPlayback } from '../lib/veoveoData.js';
test('current Veoveo mirror is supported without accepting arbitrary hosts',()=>{
 assert.equal(isVeoveoUrl('https://kurolesya.link/balancer-api/iframe?movie_id=1'),true);
 assert.equal(isVeoveoUrl('https://kurolesya.link.evil.example/'),false);
 const config=parseVeoveoConfig(`window.ENV_BASE_URL = 'https://kurolesya.link/balancer-api/proxy/playlists'; window.REQUEST_HEADERS = {'DLE-API-TOKEN':'test'};`,'https://kurolesya.link/balancer-api/iframe?movie_id=1');
 assert.equal(config.movieId,'1');
 assert.equal(selectVeoveoPlayback([{order:20,season:{order:2},episodeVariants:[]}],{isSeries:true,season:2,episode:20}),null);
});
