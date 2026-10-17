import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp, identity, remote } from '../server.mjs';
import { parseCollapsPlayback } from '../lib/streamExtractor.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('movie and TV identities never collide',()=>{assert.notEqual(identity(new URLSearchParams('id=1622&type=movie')).key,identity(new URLSearchParams('id=1622&type=tv')).key);assert.throws(()=>identity(new URLSearchParams('id=1622')));});
test('server refuses arbitrary fetch targets and does not substitute another episode',async()=>{await assert.rejects(remote('http://127.0.0.1/'));await assert.rejects(remote('https://example.org/'));assert.equal(parseCollapsPlayback('seasons: [{"season":1,"episodes":[{"episode":1,"hls":"https://cdn.example/a.m3u8"}]}]',2,20),null);});
test('API uses TV metadata and resolves exact season/episode without accepting user URLs',async()=>{
 const app=createApp({apiKey:'test',read:async url=>{
  if(url.includes('/tv/1622/external_ids'))return JSON.stringify({imdb_id:'tt0460681'});
  if(url.includes('/tv/1622?'))return JSON.stringify({name:'Supernatural',seasons:[{season_number:2,episode_count:22}]});
  if(url.includes('/api/players?'))return JSON.stringify([{type:'Collaps',iframeUrl:'https://collaps.org/embed/1'}]);
  if(url.includes('collaps.org'))return 'seasons: [{"season":2,"episodes":[{"episode":20,"hls":"https://cdn.example/2-20.m3u8"}]}]';
  throw Error('Unexpected request');
 }});const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{const list=await (await fetch(base+'/api/sources?id=1622&type=tv')).json();assert.equal(list.sources.length,1);const source=encodeURIComponent(list.sources[0].id);const response=await fetch(base+'/api/resolve?id=1622&type=tv&season=2&episode=20&source='+source);assert.equal(response.status,200);assert.equal((await response.json()).url,'https://cdn.example/2-20.m3u8');assert.equal((await fetch(base+'/api/resolve?id=1622&type=tv&source=https://127.0.0.1')).status,404);assert.equal((await fetch(base+'/api/resolve?id=1622&type=tv&season=2&episode=19&source='+source)).status,422);}finally{await new Promise(r=>server.close(r));}
});
test('plugin registers once and exposes card action and settings',()=>{let count=0,manifest;const element={on(){return this;},eq(){return this;},append(){return this;}};const Lampa={SettingsApi:{addComponent(){count++;},addParam(){}},Manifest:{set plugins(value){manifest=value;}}};const context=vm.createContext({window:{appready:true},document:{currentScript:{src:'https://example.org/aniplay.js'}},Lampa,$:()=>element});const source=readFileSync(new URL('../public/aniplay.js',import.meta.url),'utf8');vm.runInContext(source,context);vm.runInContext(source,context);assert.equal(count,1);assert.equal(manifest.type,'video');assert.equal(typeof manifest.onContextLauch,'function');});
