import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVeoveo } from '../lib/veoveoData.js';

test('stale aggregator voice falls back only within the exact requested episode', async () => {
  const frame='https://kurolesya.link/balancer-api/iframe?movie_id=1&episode_variant_id=10';
  const read=async url=>({data:url===frame
    ? `window.ENV_BASE_URL='https://kurolesya.link/balancer-api/proxy/playlists';window.REQUEST_HEADERS={'DLE-API-TOKEN':'test'};`
    : url.includes('/available?') ? JSON.stringify({available:true})
    : JSON.stringify([
      {order:2,season:{order:1},episodeVariants:[{id:10,title:'RenTV',filepath:'https://kurolesya.link/other.mp4'}]},
      {order:1,season:{order:1},episodeVariants:[{id:11,title:'Default',filepath:'https://kurolesya.link/exact.mp4'}]},
    ])});
  const result=await resolveVeoveo(frame,{isSeries:true,season:1,episode:1},read);
  assert.equal(result.hlsUrl,'https://kurolesya.link/exact.mp4');
  assert.ok(result.notice);
  assert.equal(await resolveVeoveo(frame,{isSeries:true,season:1,episode:3},read),null);
  assert.equal(await resolveVeoveo(frame,{isSeries:true,season:1,episode:1,variant:'RenTV'},read),null);
});
