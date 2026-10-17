(function () {
  'use strict';
  if (window.aniplay_lampa_ready) return;
  window.aniplay_lampa_ready = true;
  var script = document.currentScript;
  var defaultServer = script && script.src ? script.src.replace(/\/aniplay\.js(?:\?.*)?$/, '') : '';
  var generation = 0, activeRequest;
  function safe(value) { return String(value || '').replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function key(card) { return (card.media_type === 'tv' || card.first_air_date || card.name ? 'tv' : 'movie') + ':' + card.id; }
  function back() { generation++; if(activeRequest)activeRequest.abort(); Lampa.Controller.toggle('content'); }
  function request(route, args, done) {
    var server = Lampa.Storage.field('aniplay_server') || defaultServer;
    if(!/^https?:\/\/[^/]+(?:\/[^?#]*)?$/.test(server)){Lampa.Noty.show('Укажите адрес сервера AniPlay в настройках');return;}
    var token=++generation, xhr=new XMLHttpRequest(); activeRequest=xhr;
    var query=Object.keys(args).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(args[k]);}).join('&');
    Lampa.Modal.open({title:'AniPlay — загрузка',html:Lampa.Template.get('modal_loading'),size:'small',onBack:function(){Lampa.Modal.close();back();}});
    function finish(error,data){if(token!==generation)return;activeRequest=null;Lampa.Modal.close();if(error){Lampa.Noty.show(error);back();}else done(data);}
    xhr.open('GET',server.replace(/\/$/,'')+route+'?'+query);xhr.timeout=45000;
    xhr.onload=function(){try{var data=JSON.parse(xhr.responseText);finish(xhr.status===200?null:(data.error||'Ошибка сервера'),data);}catch(e){finish('Сервер вернул неверный ответ');}};
    xhr.onerror=function(){finish('Сервер недоступен. Проверьте адрес и подключение.');};
    xhr.ontimeout=function(){finish('Сервер не успел ответить. Если он спал, повторите попытку.');};xhr.send();
  }
  function choose(title,items,onSelect,onBack){Lampa.Select.show({title:title,items:items,onSelect:function(item){Lampa.Select.close();onSelect(item);},onBack:onBack||back});}
  function args(card){return {id:card.id,type:key(card).split(':')[0]};}
  function state(){return Lampa.Storage.get('aniplay_lampa_history',{});}
  function remember(card,source,season,episode,time,duration){
    var records=state(), id=key(card), previous=records[id]||{};
    var episodeKey=season+':'+episode, progress=previous.progress||{};
    progress[episodeKey]={time:time||0,duration:duration||0,completed:duration>0 && time/duration>=0.65};
    var episodeKeys=Object.keys(progress);while(episodeKeys.length>300)delete progress[episodeKeys.shift()];
    records[id]={card:card,source:source,season:season,episode:episode,progress:progress,updatedAt:Date.now()};
    var ordered=Object.keys(records).sort(function(a,b){return records[b].updatedAt-records[a].updatedAt;});
    ordered.slice(100).forEach(function(k){delete records[k];});Lampa.Storage.set('aniplay_lampa_history',records);
  }
  function play(card,source,season,episode){
    var query=args(card);query.source=source;query.season=season;query.episode=episode;
    request('/api/resolve',query,function(data){
      var saved=state()[key(card)], prior=saved && saved.progress[season+':'+episode];
      var time=prior?prior.time:0,duration=prior?prior.duration:0,lastWrite=0,alive=true;
      function save(){remember(card,source,season,episode,time,duration);lastWrite=Date.now();}
      function tick(e){if(!alive)return;if(Number.isFinite(e.current))time=e.current;if(Number.isFinite(e.duration))duration=e.duration;if(Date.now()-lastWrite>=60000)save();}
      function ready(){Lampa.PlayerVideo.listener.remove('canplay',ready);if(time>0 && (!duration || time/duration<0.98))Lampa.PlayerVideo.to(time);}
      function ended(){time=duration;save();}
      function destroy(){if(!alive)return;save();alive=false;Lampa.PlayerVideo.listener.remove('timeupdate',tick);Lampa.PlayerVideo.listener.remove('canplay',ready);Lampa.PlayerVideo.listener.remove('ended',ended);Lampa.Player.listener.remove('destroy',destroy);}
      Lampa.Player.play({url:data.url,title:(card.title||card.name)+(query.type==='tv'?' · '+season+'×'+episode:''),movie:card});
      Lampa.PlayerVideo.listener.follow('timeupdate',tick);Lampa.PlayerVideo.listener.follow('canplay',ready);Lampa.PlayerVideo.listener.follow('ended',ended);Lampa.Player.listener.follow('destroy',destroy);save();
    });
  }
  function sources(card,season,episode){request('/api/sources',args(card),function(data){
    var saved=state()[key(card)], entries=data.sources.filter(function(s){return s.supported;});
    entries.sort(function(a,b){return Number(b.id===(saved||{}).source)-Number(a.id===(saved||{}).source);});
    if(!entries.length){Lampa.Noty.show('Для этого тайтла нет поддерживаемых прямых источников');back();return;}
    choose('AniPlay · источник',entries.map(function(s){return {title:safe(s.name),subtitle:s.id===(saved||{}).source?'Последний выбранный источник':'',id:s.id};}),function(s){play(card,s.id,season,episode);},function(){open(card);});
  });}
  function seasons(card){request('/api/details',args(card),function(data){
    if(!data.seasons.length){Lampa.Noty.show('Список серий пока недоступен');back();return;}
    choose('Сезон',data.seasons.map(function(s){return {title:'Сезон '+s.number,number:s.number,count:s.count};}),function(s){
      var episodes=[],saved=state()[key(card)];
      for(var i=1;i<=Math.min(s.count,1000);i++){var p=saved&&saved.progress[s.number+':'+i];episodes.push({title:'Серия '+i,subtitle:p&&p.completed?'Просмотрено':p&&p.time?'Продолжить с '+Math.floor(p.time/60)+' мин':'',episode:i});}
      if(!episodes.length){Lampa.Noty.show('Серий ещё нет');back();return;}
      choose('Сезон '+s.number,episodes,function(e){sources(card,s.number,e.episode);},function(){seasons(card);});
    });
  });}
  function open(card){
    if(!card || !/^\d+$/.test(String(card.id)) || (card.source && card.source!=='tmdb')){Lampa.Noty.show('Откройте карточку из каталога TMDb');return;}
    var saved=state()[key(card)],items=[];
    if(saved)items.push({title:'Продолжить '+(key(card).indexOf('tv:')===0?saved.season+'×'+saved.episode:'просмотр'),action:'resume'});
    items.push({title:key(card).indexOf('tv:')===0?'Выбрать сезон и серию':'Выбрать источник',action:'choose'});
    choose('AniPlay · '+safe(card.title||card.name),items,function(item){if(item.action==='resume')play(card,saved.source,saved.season,saved.episode);else if(key(card).indexOf('tv:')===0)seasons(card);else sources(card,1,1);});
  }
  function history(){var records=state();var items=Object.keys(records).sort(function(a,b){return records[b].updatedAt-records[a].updatedAt;}).map(function(id){var r=records[id];return {title:safe(r.card.title||r.card.name),subtitle:id.indexOf('tv:')===0?'Сезон '+r.season+' · серия '+r.episode:'Фильм',card:r.card};});if(!items.length){Lampa.Noty.show('Откройте карточку, удерживайте ОК и выберите AniPlay');return;}choose('AniPlay · история',items,function(item){open(item.card);});}
  function init(){
    Lampa.SettingsApi.addComponent({component:'aniplay',name:'AniPlay'});
    Lampa.SettingsApi.addParam({component:'aniplay',param:{name:'aniplay_server',type:'input',default:defaultServer,placeholder:'https://your-service.onrender.com'},field:{name:'Адрес сервера AniPlay',description:'Сервер из репозитория aniplay-lampa'}});
    Lampa.Manifest.plugins={type:'video',version:'1.0.0',name:'AniPlay',description:'Источники и история AniPlay для Lampa',onContextMenu:function(){return {name:'Смотреть через AniPlay',description:'Выбор источника, сезона и серии'};},onContextLauch:open};
    var button=$('<li class="menu__item selector"><div class="menu__ico">▶</div><div class="menu__text">AniPlay</div></li>');button.on('hover:enter',history);$('.menu .menu__list').eq(0).append(button);
  }
  if(window.appready)init();else Lampa.Listener.follow('app',function(e){if(e.type==='ready')init();});
})();
