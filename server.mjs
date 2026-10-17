import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { flattenPlayerProviders } from './lib/playerSources.js';
import { isCollapsUrl, parseCollapsPlayback } from './lib/streamExtractor.js';
import { isVeoveoUrl, resolveVeoveo } from './lib/veoveoData.js';

export function identity(query) {
  const id = query.get('id'), type = query.get('type');
  if (!/^\d{1,10}$/.test(id || '') || !['tv','movie'].includes(type)) throw Error('Нужны ID и категория TMDb');
  return { id, type, key: `${type}:${id}` };
}
export function positive(value) {
  if (!/^[1-9]\d{0,3}$/.test(String(value))) throw Error('Неверный номер сезона или серии');
  return Number(value);
}
export async function remote(url, headers = {}, redirects = 0) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') ||
      !(['api.themoviedb.org','p2.ddbb.lol','a.ddbb.live'].includes(u.hostname) || isCollapsUrl(url) || isVeoveoUrl(url))) throw Error('Недопустимый источник');
  const response = await fetch(u, { headers, redirect:'manual', signal:AbortSignal.timeout(12000) });
  if ([301,302,303,307,308].includes(response.status)) {
    if (redirects >= 3) throw Error('Слишком много перенаправлений');
    const location = response.headers.get('location');
    if (!location) throw Error('Некорректное перенаправление');
    const target = new URL(location, u);
    if (target.origin !== u.origin) throw Error('Перенаправление на другой сервер запрещено');
    await response.body?.cancel();
    return remote(target.href, headers, redirects + 1);
  }
  if (!response.ok) throw Error(`Источник ответил ${response.status}`);
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try { while (true) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>4*1024*1024)throw Error('Ответ слишком большой'); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}
export function createApp({read=remote, apiKey=process.env.TMDB_API_KEY} = {}) {
  const cache = new Map();
  async function tmdb(route) {
    if (!apiKey) throw Error('На сервере не задан TMDB_API_KEY');
    return JSON.parse(await read(`https://api.themoviedb.org/3/${route}?api_key=${encodeURIComponent(apiKey)}&language=ru-RU`));
  }
  async function sources(item) {
    const cached = cache.get(item.key); if(cached && cached.expires>Date.now())return cached.sources;
    const details=await tmdb(`${item.type}/${item.id}`);
    let imdb=details.imdb_id;
    if(!imdb)imdb=(await tmdb(`${item.type}/${item.id}/external_ids`)).imdb_id;
    if(!/^tt\d+$/.test(imdb||''))throw Error('У тайтла нет IMDb ID: поиск по одному названию небезопасен');
    const results=await Promise.allSettled(['https://p2.ddbb.lol','https://a.ddbb.live'].map(async base=>{
      const data=JSON.parse(await read(`${base}/api/players?imdb=${encodeURIComponent(imdb)}`));
      return data.data||data.results||(Array.isArray(data)?data:[]);
    }));
    const list=flattenPlayerProviders(results.flatMap(result=>result.status==='fulfilled'?result.value:[]));
    if(cache.size>=100)cache.delete(cache.keys().next().value);
    if(list.length)cache.set(item.key,{sources:list,expires:Date.now()+120000});
    return list;
  }
  return async function app(req,res) {
    res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','no-store');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    const url=new URL(req.url,'http://localhost');
    const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      if(url.pathname==='/health')return json(200,{ok:true,version:'1.0.0',configured:!!apiKey});
      if(url.pathname==='/aniplay.js'){res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(await readFile(new URL('./public/aniplay.js',import.meta.url)));return;}
      if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(new URL('./public/index.html',import.meta.url)));return;}
      if(!['/api/details','/api/sources','/api/resolve'].includes(url.pathname))return json(404,{error:'Не найдено'});
      const item=identity(url.searchParams);
      if(url.pathname==='/api/details') {
        const detail=await tmdb(`${item.type}/${item.id}`);
        return json(200,{title:detail.title||detail.name,seasons:(detail.seasons||[]).filter(s=>s.season_number>0).map(s=>({number:s.season_number,count:s.episode_count}))});
      }
      const list=await sources(item);
      if(url.pathname==='/api/sources')return json(200,{sources:list.map(s=>({id:s.key,name:s.label,supported:isCollapsUrl(s.iframeUrl)||isVeoveoUrl(s.iframeUrl)||/\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(s.iframeUrl)}))});
      const source=list.find(s=>s.key===url.searchParams.get('source'));
      if(!source)return json(404,{error:'Источник исчез. Обновите список.'});
      const season=positive(url.searchParams.get('season')||'1'),episode=positive(url.searchParams.get('episode')||'1');
      let stream, reason;
      if(isCollapsUrl(source.iframeUrl)) {
        const frame=new URL(source.iframeUrl);frame.searchParams.set('season',season);frame.searchParams.set('episode',episode);
        stream=parseCollapsPlayback(await read(frame.href),season,episode);
      } else if(isVeoveoUrl(source.iframeUrl)) stream=await resolveVeoveo(source.iframeUrl,{isSeries:item.type==='tv',season,episode,onUnavailable:value=>{reason=value;}},async (url,headers)=>({data:await read(url,headers)}));
      else if(item.type==='movie' && /\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(source.iframeUrl))stream={hlsUrl:source.iframeUrl};
      if(!stream?.hlsUrl) {
        const frame = new URL(source.iframeUrl);
        if (frame.protocol !== 'https:') return json(422,{error:'Источник недоступен'});
        frame.searchParams.set('season', season); frame.searchParams.set('episode', episode);
        return json(200,{iframeUrl:frame.href,source:source.key,reason});
      }
      return json(200,{url:stream.hlsUrl,source:source.key,notice:stream.notice});
    } catch(error){return json(400,{error: error.message.includes('api_key')?'Ошибка каталога':error.message});}
  };
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  createServer(createApp()).listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('AniPlay Lampa server started'));
}
