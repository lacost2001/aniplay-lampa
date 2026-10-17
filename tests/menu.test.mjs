import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('selecting a route does not invoke Back while closing its menu',()=>{
 let selection,manifest,backCount=0,requested='';
 const element={on(){return this;},eq(){return this;},append(){return this;}};
 const Lampa={Listener:{follow(){}},SettingsApi:{addComponent(){},addParam(){}},Manifest:{set plugins(v){manifest=v;}},Storage:{get(){return {};},field(){return '';}},Controller:{toggle(){backCount++;}},Select:{show(v){selection=v;},close(){selection.onBack();}},Modal:{open(){},close(){}},Template:{get(){return '';}}};
 class Request{open(method,url){requested=url;}send(){}abort(){}}
 const context=vm.createContext({window:{appready:true},document:{currentScript:{src:'https://example.org/aniplay.js'}},Lampa,$:()=>element,XMLHttpRequest:Request});
 vm.runInContext(readFileSync(new URL('../public/aniplay.js',import.meta.url),'utf8'),context);
 manifest.onContextLauch({id:550,title:'Movie',source:'tmdb'});
 assert.equal(selection.nohide,true);
 selection.onSelect({action:'choose'});
 assert.equal(backCount,0);
 assert.match(requested,/api\/sources\?id=550&type=movie/);
});
