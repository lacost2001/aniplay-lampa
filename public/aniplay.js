(function () {
  'use strict';
  if (window.aniplay_lampa_ready) return;
  window.aniplay_lampa_ready = true;
  // Some TV builds of Lampa inject plugins without document.currentScript.
  function pluginSrc(){
    if(document.currentScript&&document.currentScript.src)return document.currentScript.src;
    var list=document.getElementsByTagName('script');
    for(var i=list.length-1;i>=0;i--)if(/\/aniplay\.js(?:\?|$)/.test(list[i].src||''))return list[i].src;
    return '';
  }
  var defaultServer = pluginSrc().replace(/\/aniplay\.js(?:\?.*)?$/, '');
  var generation = 0, activeRequest;
  function safe(value) { return String(value || '').replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function key(card) { return (card.media_type === 'tv' || card.first_air_date || card.name ? 'tv' : 'movie') + ':' + card.id; }
  function back() { generation++; if(activeRequest)activeRequest.abort(); Lampa.Controller.toggle('content'); }
  function request(route, args, done, attempt) {
    attempt=attempt||0;
    var server = Lampa.Storage.field('aniplay_server') || defaultServer;
    if(!/^https?:\/\/[^/]+(?:\/[^?#]*)?$/.test(server)){Lampa.Noty.show('Укажите адрес сервера AniPlay в настройках');return;}
    var token=++generation, xhr=new XMLHttpRequest(); activeRequest=xhr;
    var query=Object.keys(args).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(args[k]);}).join('&');
    if(attempt)Lampa.Modal.close(); // the loading modal stays open (Back cancels) while waiting to retry
    Lampa.Modal.open({title:'AniPlay — загрузка',html:Lampa.Template.get('modal_loading'),size:'small',onBack:function(){Lampa.Modal.close();back();}});
    function finish(error,data){if(token!==generation)return;activeRequest=null;Lampa.Modal.close();if(error){Lampa.Noty.show(error);back();}else done(data);}
    // Free Render instances sleep: the first request can fail while the server wakes up.
    function retry(error){if(token!==generation)return;if(attempt<2){activeRequest=null;Lampa.Noty.show('Сервер AniPlay просыпается, повтор…');setTimeout(function(){if(token===generation)request(route,args,done,attempt+1);},3000);}else finish(error);}
    xhr.open('GET',server.replace(/\/$/,'')+route+'?'+query);xhr.timeout=60000;
    xhr.onload=function(){try{var data=JSON.parse(xhr.responseText);finish(xhr.status===200?null:(data.error||'Ошибка сервера'),data);}catch(e){finish('Сервер вернул неверный ответ');}};
    xhr.onerror=function(){retry('Сервер недоступен. Проверьте адрес и подключение.');};
    xhr.ontimeout=function(){retry('Сервер не успел ответить. Повторите попытку.');};xhr.send();
  }
  function choose(title,items,onSelect,onBack){
    var selecting=false;
    Lampa.Select.show({title:title,items:items,nohide:true,onSelect:function(item){
      selecting=true;Lampa.Select.close();onSelect(item);
    },onBack:function(){if(!selecting)(onBack||back)();}});
  }
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
  // Veoveo blocks datacenter IPs (Render), so the TV resolves it with its own IP.
  // Port of lib/veoveoData.js: reads only literal config, never runs provider JS.
  var VEOVEO=/^https:\/\/(geralovod\.link|tazaromikaz\.link|player\.shortener2\.link|kurolesya\.link)(\/|$)/;
  function xget(url,headers,done){
    var xhr=new XMLHttpRequest(),finished=false;
    function end(error,text){if(finished)return;finished=true;done(error,text);}
    try{xhr.open('GET',url);for(var h in headers)if(headers.hasOwnProperty(h))xhr.setRequestHeader(h,headers[h]);}catch(e){end(e);return;}
    xhr.timeout=20000;xhr.onload=function(){if(xhr.status===200)end(null,xhr.responseText);else end(Error('HTTP '+xhr.status));};
    xhr.onerror=xhr.ontimeout=function(){end(Error('network'));};xhr.send();return xhr;
  }
  function param(url,name){var m=url.match(new RegExp('[?&]'+name+'=([^&#]*)'));return m?decodeURIComponent(m[1]):'';}
  function veoveoPick(episodes,isSeries,season,episode,linkedId){
    if(Object.prototype.toString.call(episodes)!=='[object Array]')return null;
    var selected=null,i;
    if(isSeries){for(i=0;i<episodes.length;i++){var e=episodes[i];if(e&&e.season&&String(e.season.order)===String(season)&&String(e.order)===String(episode)){selected=e;break;}}}
    else if(episodes.length===1)selected=episodes[0];
    if(!selected||selected.blocked)return null;
    var playable=[],russian=[],all=selected.episodeVariants||[];
    for(i=0;i<all.length;i++)if(all[i]&&VEOVEO.test(all[i].filepath||''))playable.push(all[i]);
    for(i=0;i<playable.length;i++)if(/рус|дубл|многоголос|двухголос|закадров|russian|\brus\b/i.test(playable[i].title||'')&&!/укра|субтитр/i.test(playable[i].title||''))russian.push(playable[i]);
    var list=russian.length?russian:playable,chosen=list[0];
    if(linkedId)for(i=0;i<list.length;i++)if(String(list[i].id)===String(linkedId))chosen=list[i];
    return chosen?chosen.filepath:null;
  }
  function veoveoOnTv(url,isSeries,season,episode,done){
    xget(url,{},function(error,html){
      if(error)return done(null);
      var base=(html.match(/window\.ENV_BASE_URL\s*=\s*['"]([^'"]+)/)||[])[1]||'',movieId=param(url,'movie_id');
      if(!VEOVEO.test(base)||!/\/balancer-api\/proxy\/playlists$/.test(base)||!/^\d+$/.test(movieId))return done(null);
      var raw=(html.match(/window\.REQUEST_HEADERS\s*=\s*({[^;]+})/)||[])[1]||'',headers={},re=/['"]([^'"]+)['"]\s*:\s*['"]([^'"]*)['"]/g,m;
      while((m=re.exec(raw)))if(m[1]==='DLE-API-TOKEN'||m[1]==='Iframe-Request-Id')headers[m[1]]=m[2];
      if(!headers['DLE-API-TOKEN'])return done(null);
      var q='domain='+encodeURIComponent(url)+'&locale=ru-RU&tz=UTC&referrer_host='+encodeURIComponent('http://localhost');
      xget(base+'/catalog-api/contents/'+movieId+'/available?'+q,headers,function(error,text){
        try{if(error||JSON.parse(text).available!==true)return done(null);}catch(e){return done(null);}
        xget(base+'/catalog-api/episodes?content-id='+movieId,headers,function(error,text){
          var stream=null;try{if(!error)stream=veoveoPick(JSON.parse(text),isSeries,season,episode,param(url,'episode_variant_id'));}catch(e){}
          done(stream);
        });
      });
    });
  }
  function play(card,source,season,episode){
    var query=args(card);query.source=source;query.season=season;query.episode=episode;
    request('/api/resolve',query,function(data){
      if(data.notice)Lampa.Noty.show(data.notice);
      if(data.iframeUrl&&VEOVEO.test(data.iframeUrl)){
        var token=++generation;
        Lampa.Modal.open({title:'AniPlay — поиск потока',html:Lampa.Template.get('modal_loading'),size:'small',onBack:function(){Lampa.Modal.close();back();}});
        veoveoOnTv(data.iframeUrl,query.type==='tv',season,episode,function(stream){
          if(token!==generation)return;Lampa.Modal.close();
          if(stream){data.url=stream;delete data.iframeUrl;}
          launch(data);
        });
        return;
      }
      launch(data);
    });
    function launch(data){
      if(data.iframeUrl){
        var previous=state()[key(card)], progress=previous && previous.progress[season+':'+episode];
        remember(card,source,season,episode,progress?progress.time:0,progress?progress.duration:0);
        var box=$('<div></div>');
        $('<div></div>').text('Внешний плеер. Серии и озвучка переключаются внутри него; прогресс с Lampa не синхронизируется. Назад — закрыть.').css({fontSize:'0.8em',marginBottom:'0.5em'}).appendTo(box);
        $('<iframe></iframe>').attr({src:data.iframeUrl,allow:'autoplay; fullscreen; encrypted-media',allowfullscreen:'',referrerpolicy:'no-referrer',title:'AniPlay — внешний плеер'}).css({width:'100%',height:'70vh',border:0,background:'#000'}).appendTo(box);
        var frameClosed=false;
        function closeFrame(){if(frameClosed)return;frameClosed=true;box.find('iframe').attr('src','about:blank');Lampa.Modal.close();back();}
        Lampa.Modal.open({title:'AniPlay · внешний плеер',html:box,size:'full',buttons:[{name:'Закрыть плеер',onSelect:closeFrame}],onBack:closeFrame});return;
      }
      var saved=state()[key(card)], prior=saved && saved.progress[season+':'+episode];
      var time=prior?prior.time:0,duration=prior?prior.duration:0,lastWrite=0,alive=true;
      function save(){remember(card,source,season,episode,time,duration);lastWrite=Date.now();}
      function tick(e){if(!alive)return;if(Number.isFinite(e.current))time=e.current;if(Number.isFinite(e.duration))duration=e.duration;if(Date.now()-lastWrite>=60000)save();}
      function ready(){Lampa.PlayerVideo.listener.remove('canplay',ready);if(time>0 && (!duration || time/duration<0.98))Lampa.PlayerVideo.to(time);}
      function ended(){time=duration;save();}
      function destroy(){if(!alive)return;save();alive=false;Lampa.PlayerVideo.listener.remove('timeupdate',tick);Lampa.PlayerVideo.listener.remove('canplay',ready);Lampa.PlayerVideo.listener.remove('ended',ended);Lampa.Player.listener.remove('destroy',destroy);}
      Lampa.Player.play({url:data.url,title:(card.title||card.name)+(query.type==='tv'?' · '+season+'×'+episode:''),movie:card});
      Lampa.PlayerVideo.listener.follow('timeupdate',tick);Lampa.PlayerVideo.listener.follow('canplay',ready);Lampa.PlayerVideo.listener.follow('ended',ended);Lampa.Player.listener.follow('destroy',destroy);save();
    }
  }
  function sources(card,season,episode){request('/api/sources',args(card),function(data){
    var saved=state()[key(card)], entries=data.sources;
    entries.sort(function(a,b){return Number(b.id===(saved||{}).source)-Number(a.id===(saved||{}).source);});
    if(!entries.length){Lampa.Noty.show('Провайдеры пока не предоставили источников для этого тайтла');back();return;}
    choose('AniPlay · источник',entries.map(function(s){return {title:safe(s.name),subtitle:(s.id===(saved||{}).source?'Последний выбранный · ':'')+(s.supported?'Плеер Lampa':'Внешний плеер · без синхронизации прогресса'),id:s.id};}),function(s){play(card,s.id,season,episode);},function(){open(card);});
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
    if(!card || !/^\d+$/.test(String(card.id)) || (card.source && card.source!=='tmdb' && card.source!=='cub')){Lampa.Noty.show('Откройте карточку из каталога TMDb');return;}
    var saved=state()[key(card)],items=[];
    if(saved)items.push({title:'Продолжить '+(key(card).indexOf('tv:')===0?saved.season+'×'+saved.episode:'просмотр'),action:'resume'});
    items.push({title:key(card).indexOf('tv:')===0?'Выбрать сезон и серию':'Выбрать источник',action:'choose'});
    choose('AniPlay · '+safe(card.title||card.name),items,function(item){if(item.action==='resume')play(card,saved.source,saved.season,saved.episode);else if(key(card).indexOf('tv:')===0)seasons(card);else sources(card,1,1);});
  }
  function history(){var records=state();var items=Object.keys(records).sort(function(a,b){return records[b].updatedAt-records[a].updatedAt;}).map(function(id){var r=records[id];return {title:safe(r.card.title||r.card.name),subtitle:id.indexOf('tv:')===0?'Сезон '+r.season+' · серия '+r.episode:'Фильм',card:r.card};});if(!items.length){Lampa.Noty.show('Откройте карточку, удерживайте ОК и выберите AniPlay');return;}choose('AniPlay · история',items,function(item){open(item.card);});}
  // Each step is independent: an API missing in an older TV build of Lampa must not hide the others.
  function step(name,fn){try{fn();return true;}catch(e){if(window.console)console.log('AniPlay: '+name+' failed',e);return false;}}
  function addWatchButton(body,movie){
    // New Lampa uses .full-start-new__buttons; older TV builds still use .full-start__buttons.
    var buttons=$(body).find('.full-start-new__buttons');if(!buttons.length)buttons=$(body).find('.full-start__buttons');
    if(!buttons.length||buttons.find('.aniplay-watch').length)return;
    $('<div class="full-start__button selector aniplay-watch"><span>Смотреть AniPlay</span></div>').on('hover:enter',function(){open(movie);}).prependTo(buttons);
    // Current Lampa lists source plugins from the hidden .buttons--container in its «Смотреть» menu.
    var sources=$(body).find('.buttons--container');
    if(sources.length&&!sources.find('.aniplay-source').length)$('<div class="full-start__button selector aniplay-source"><svg><use xlink:href="#sprite-play"></use></svg><span>AniPlay</span></div>').on('hover:enter',function(){open(movie);}).appendTo(sources);
  }
  function init(){
    var ok=step('card button',function(){Lampa.Listener.follow('full',function(e){
      if(e.type!=='complite'||!e.data||!e.data.movie)return;
      var body=e.body||(e.object&&e.object.activity&&e.object.activity.render());
      if(body)addWatchButton(body,e.data.movie);
    });});
    step('settings',function(){
      Lampa.SettingsApi.addComponent({component:'aniplay',name:'AniPlay'});
      Lampa.SettingsApi.addParam({component:'aniplay',param:{name:'aniplay_server',type:'input',values:'',default:defaultServer,placeholder:'https://your-service.onrender.com'},field:{name:'Адрес сервера AniPlay',description:'Сервер из репозитория aniplay-lampa'}});
    });
    ok=step('context menu',function(){Lampa.Manifest.plugins={type:'video',version:'1.1.3',name:'AniPlay',description:'Источники и история AniPlay для Lampa',onContextMenu:function(){return {name:'Смотреть через AniPlay',description:'Выбор источника, сезона и серии'};},onContextLauch:open};})||ok;
    ok=step('side menu',function(){var button=$('<li class="menu__item selector"><div class="menu__ico">▶</div><div class="menu__text">AniPlay</div></li>');button.on('hover:enter',history);$('.menu .menu__list').eq(0).append(button);})||ok;
    step('notice',function(){Lampa.Noty.show(ok?'AniPlay 1.1.3 подключён':'AniPlay: эта версия Lampa не поддерживается');});
  }
  if(window.appready)init();else Lampa.Listener.follow('app',function(e){if(e.type==='ready')init();});
})();
