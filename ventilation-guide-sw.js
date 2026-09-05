/* Guide to Ventilation · fast cache-first service worker · internal build v1.10.129 */
'use strict';

const BUILD='v1.10.129';
const CACHE_NAME=`ventilation-guide-core-${BUILD}`;
const ASSET_CACHE='ventilation-guide-assets-v1';
const FALLBACK_CACHE='ventilation-guide-readers-fallback-v1';
function isBuildCache(name){return /^ventilation-guide-(?:core-)?v\d+\.\d+\.\d+$/.test(name);}
const SCOPE_URL=new URL(self.registration.scope);
const APP_URL=new URL('ventilation-guide-app.html',SCOPE_URL).href;
const CANONICAL_URL=new URL('mechanical-ventilation-teaching-reference.html',SCOPE_URL).href;
const LAB_URL=new URL('ventilation_guide_CASE_LAB_v1_0.html',SCOPE_URL).href;
const VERSION_URL=new URL('ventilation-guide-version.json',SCOPE_URL).href;
const SMALL_CORE=[
  'ventilation-guide-version.json',
  'manifest.webmanifest',
  'apple-touch-icon-v1-10-115.png',
  'icon-192-v1-10-115.png',
  'icon-512-v1-10-115.png',
  'favicon-32-v1-10-115.png',
  'og-card.png'
].map(x=>new URL(x,SCOPE_URL).href);

const APP_OFFLINE_HTML='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guide unavailable offline</title><style>body{font-family:system-ui;max-width:42rem;margin:auto;padding:2rem;line-height:1.5}</style><h1>Guide unavailable offline</h1><p>Reconnect once and open the mobile guide so this build can be saved.</p>';

function cacheable(response){
  return !!response&&(response.ok||response.type==='opaque');
}

function fileOf(url){
  return (url.pathname.split('/').pop()||'').toLowerCase();
}

function legacyEntry(url){
  const file=fileOf(url);
  return /^ventilation_guide_master_.*\.html$/i.test(file)||/^ventilation_guide_chapter_6_revised_.*\.html$/i.test(file);
}

function guideNavigation(url){
  const file=fileOf(url);
  return url.origin===SCOPE_URL.origin&&(
    file==='ventilation-guide-app.html'||
    file==='mechanical-ventilation-teaching-reference.html'||
    legacyEntry(url)
  );
}

function labNavigation(url){return url.origin===SCOPE_URL.origin&&url.pathname===new URL(LAB_URL).pathname;}

function versionedMetadata(url){
  return url.origin===SCOPE_URL.origin&&(
    url.href===VERSION_URL||
    /\/manifest\.webmanifest$/i.test(url.pathname)||
    /\/ventilation-guide-version\.json$/i.test(url.pathname)
  );
}

function knownAsset(url){
  if(url.origin===SCOPE_URL.origin){
    return versionedMetadata(url)||
      /\/ventilation-guide-assets\//.test(url.pathname)||
      /\/fonts\//.test(url.pathname)||
      SMALL_CORE.includes(url.href);
  }
  return /(^|\.)cdn\.jsdelivr\.net$/i.test(url.hostname)&&/katex/i.test(url.pathname);
}

async function fresh(url){
  const target=new URL(url);
  const same=target.origin===SCOPE_URL.origin;
  return fetch(new Request(target.href,{
    method:'GET',
    credentials:same?'same-origin':'omit',
    mode:same?'same-origin':'cors',
    cache:'no-store',
    redirect:'follow'
  }));
}

async function revalidate(event,url){
  if(sameEntry(event.request,url)){
    try{
      const preloaded=await event.preloadResponse;
      if(preloaded)return preloaded;
    }catch(_){}
  }
  const target=new URL(url);
  const same=target.origin===SCOPE_URL.origin;
  return fetch(new Request(target.href,{
    method:'GET',
    credentials:same?'same-origin':'omit',
    mode:same?'same-origin':'cors',
    cache:'no-cache',
    redirect:'follow'
  }));
}

async function save(cache,key,response,cloneResponse){
  if(!cacheable(response))return false;
  try{
    await cache.put(key,cloneResponse?response.clone():response);
    return true;
  }catch(_){
    return false;
  }
}

async function findCached(key){
  const names=await caches.keys();
  const ordered=[CACHE_NAME,ASSET_CACHE,FALLBACK_CACHE].concat(
    names.filter(name=>isBuildCache(name)&&name!==CACHE_NAME).sort(newestCacheFirst)
  );
  for(const name of ordered){
    if(!names.includes(name))continue;
    try{
      const response=await (await caches.open(name)).match(key,{ignoreSearch:true});
      if(response)return response;
    }catch(_){}
  }
  return null;
}

function buildParts(name){
  const match=String(name).match(/v(\d+)\.(\d+)\.(\d+)/i);
  return match?[Number(match[1]),Number(match[2]),Number(match[3])]:[0,0,0];
}

function newestCacheFirst(a,b){
  const left=buildParts(a);
  const right=buildParts(b);
  for(let i=0;i<3;i++){
    if(left[i]!==right[i])return right[i]-left[i];
  }
  return String(b).localeCompare(String(a));
}

/* Move reusable assets and both reader entries before retiring any old cache.
   A quota/copy failure keeps the source cache intact. Migrated HTML is fallback
   only: it never masquerades as an HTML hit from the newly installed build. */
let migrationPromise=null;
function migrateOldCaches(){
  if(migrationPromise)return migrationPromise;
  migrationPromise=(async()=>{
    const assets=await caches.open(ASSET_CACHE);
    const fallback=await caches.open(FALLBACK_CACHE);
    const names=(await caches.keys()).filter(name=>isBuildCache(name)&&name!==CACHE_NAME).sort(newestCacheFirst);
    const migratedReaders=new Set();
    for(const name of names){
      const old=await caches.open(name);
      let complete=true;
      for(const request of await old.keys()){
        try{
          const url=new URL(typeof request==='string'?request:request.url);
          const response=await old.match(request);
          if(!cacheable(response))continue;
          const reader=guideNavigation(url)||labNavigation(url);
          if(reader){
            const key=normalize(url.href,SCOPE_URL);
            if(migratedReaders.has(key))continue;
            if(!await save(fallback,key,response,false)){complete=false;continue;}
            migratedReaders.add(key);
          }else if(!await assets.match(request,{ignoreSearch:true})){
            if(!await save(assets,request,response,false))complete=false;
          }
        }catch(_){complete=false;}
      }
      if(complete)await caches.delete(name);
    }
  })().catch(()=>{});
  return migrationPromise;
}

/* The initially opened HTML predates worker control. Cache that reader after
   activation, independently of first paint; do not download the other edition. */
const readerWarmups=new Map();
function warmReader(raw){
  let url;
  try{url=new URL(raw,SCOPE_URL);}catch(_){return Promise.resolve(false);}
  if(!guideNavigation(url)&&!labNavigation(url))return Promise.resolve(false);
  const key=normalize(url.href,SCOPE_URL);
  if(readerWarmups.has(key))return readerWarmups.get(key);
  const task=(async()=>{
    const cache=await caches.open(CACHE_NAME);
    if(await cache.match(key,{ignoreSearch:true}))return true;
    const response=await revalidate({request:{url:key}},key);
    return save(cache,key,response,false);
  })().catch(()=>false).then(ok=>{if(!ok)readerWarmups.delete(key);return ok;});
  readerWarmups.set(key,task);
  return task;
}

function sameEntry(request,target){
  try{
    const requested=new URL(request.url);
    const intended=new URL(target);
    return requested.origin===intended.origin&&requested.pathname===intended.pathname;
  }catch(_){
    return false;
  }
}

async function preloadOrFresh(event,url){
  if(sameEntry(event.request,url)){
    try{
      const preloaded=await event.preloadResponse;
      if(preloaded)return preloaded;
    }catch(_){}
  }
  return fresh(url);
}

function discardPreloadPromise(event){
  return Promise.resolve(event.preloadResponse).then(response=>{
    if(response&&response.body&&typeof response.body.cancel==='function')return response.body.cancel();
    return undefined;
  }).catch(()=>{});
}

/*
 * Each intercepted request resolves to two independent promises:
 *   response — delivered to respondWith as soon as possible;
 *   done     — cache writes/revalidation/cleanup held by waitUntil.
 * The fetch listener attaches both synchronously for WebKit reliability.
 */
function attach(event,work){
  const task=Promise.resolve(work);
  event.respondWith(task.then(result=>result.response));
  event.waitUntil(task.then(result=>result.done).catch(()=>{}));
}

async function refreshEntry(event,cache,url,key){
  try{
    /* no-cache permits an HTTP conditional request; no-store would force the
       multi-megabyte guide body to be transferred again on every launch. */
    const response=await revalidate(event,url);
    if(!cacheable(response))return false;
    const stored=await save(cache,key,response,false);
    return stored;
  }catch(_){
    return false;
  }
}

async function entryWork(event,url,key){
  let cache;
  try{
    cache=await caches.open(CACHE_NAME);
  }catch(_){
    try{return {response:await preloadOrFresh(event,url),done:Promise.resolve()};}
    catch(__){return {response:null,done:Promise.resolve()};}
  }

  /* Current-build hit: paint immediately; refresh in the background. */
  try{
    const current=await cache.match(key,{ignoreSearch:true});
    if(current){
      return {
        response:current,
        done:refreshEntry(event,cache,url,key)
      };
    }
  }catch(_){}

  /* Cold/upgrade path: stream successful network HTML and cache its clone.
     An HTTP error is also a network failure for offline-fallback purposes. */
  try{
    const response=await preloadOrFresh(event,url);
    if(!cacheable(response)){
      const cached=await findCached(key);
      return {response:cached||response,done:Promise.resolve()};
    }
    return {response,done:save(cache,key,response.clone(),false)};
  }catch(_){
    return {response:await findCached(key),done:Promise.resolve()};
  }
}

async function appNavigationWork(event){
  const result=await entryWork(event,APP_URL,APP_URL);
  if(result.response)return result;
  return {
    response:new Response(APP_OFFLINE_HTML,{
      status:503,
      headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}
    }),
    done:result.done
  };
}

function deviceAwareOfflineFallback(){
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guide unavailable offline</title><style>body{font-family:system-ui;max-width:42rem;margin:auto;padding:2rem;line-height:1.5}</style><script>(function(){var ua=navigator.userAgent||"",uad=navigator.userAgentData,p=(uad&&uad.mobile===true)||/iPhone|iPod|IEMobile|Windows Phone|webOS|BlackBerry|Opera Mini/i.test(ua)||(/Android/i.test(ua)&&/Mobile/i.test(ua));if(p)location.replace("ventilation-guide-app.html"+location.hash);})();<\/script><h1>Guide unavailable offline</h1><p>Reconnect once and open the guide so the continuous desktop edition can be saved on this device.</p>',{
    status:200,
    headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}
  });
}

async function canonicalNavigationWork(event,url){
  if(legacyEntry(url)){
    return {
      response:Response.redirect(CANONICAL_URL,302),
      done:discardPreloadPromise(event)
    };
  }
  const result=await entryWork(event,CANONICAL_URL,CANONICAL_URL);
  if(result.response)return result;
  return {response:deviceAwareOfflineFallback(),done:result.done};
}

async function metadataWork(event,url){
  let cache;
  try{cache=await caches.open(CACHE_NAME);}catch(_){
    try{return {response:await fresh(url.href),done:Promise.resolve()};}
    catch(__){return {response:new Response('',{status:504,statusText:'Offline'}),done:Promise.resolve()};}
  }
  try{
    const response=await fresh(url.href);
    if(cacheable(response)){
      const copy=response.clone();
      return {
        response,
        done:save(cache,event.request,copy,false)
      };
    }
    const cached=await findCached(event.request);
    return {response:cached||response,done:Promise.resolve()};
  }catch(_){
    const cached=await findCached(event.request);
    return {
      response:cached||new Response('',{status:504,statusText:'Offline'}),
      done:Promise.resolve()
    };
  }
}

async function assetWork(event,url){
  if(versionedMetadata(url))return metadataWork(event,url);

  let cache;
  try{cache=await caches.open(ASSET_CACHE);}catch(_){
    try{return {response:await fetch(event.request),done:Promise.resolve()};}
    catch(__){return {response:new Response('',{status:504,statusText:'Offline'}),done:Promise.resolve()};}
  }
  try{
    const current=await cache.match(event.request,{ignoreSearch:true});
    if(current)return {response:current,done:Promise.resolve()};
  }catch(_){}

  const older=await findCached(event.request);
  if(older){
    let done=Promise.resolve();
    if(cacheable(older)){
      const copy=older.clone();
      done=save(cache,event.request,copy,false);
    }
    return {response:older,done};
  }

  try{
    const response=await fetch(event.request);
    let done=Promise.resolve();
    if(cacheable(response)&&(knownAsset(url)||url.origin!==SCOPE_URL.origin)){
      const copy=response.clone();
      done=save(cache,event.request,copy,false);
    }
    return {response,done};
  }catch(_){
    return {
      response:new Response('',{status:504,statusText:'Offline'}),
      done:Promise.resolve()
    };
  }
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try{
      const cache=await caches.open(CACHE_NAME);
      await Promise.all(SMALL_CORE.map(async url=>{
        try{
          const response=await fresh(url);
          await save(cache,url,response,false);
        }catch(_){}
      }));
    }catch(_){}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    try{
      if(self.registration.navigationPreload)await self.registration.navigationPreload.enable();
    }catch(_){}
    await self.clients.claim();
    const migration=migrateOldCaches();
    try{
      const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      await Promise.all(clients.map(client=>warmReader(client.url)));
    }catch(_){}
    await migration;
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;

  let url;
  try{url=new URL(request.url);}catch(_){return;}
  if(!/^https?:$/.test(url.protocol))return;

  if(labNavigation(url)){
    attach(event,entryWork(event,LAB_URL,LAB_URL).then(result=>({
      response:result.response||new Response(APP_OFFLINE_HTML,{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}}),
      done:result.done
    })));
    return;
  }

  if(request.mode==='navigate'&&guideNavigation(url)){
    attach(event,fileOf(url)==='ventilation-guide-app.html'
      ?appNavigationWork(event)
      :canonicalNavigationWork(event,url));
    return;
  }

  if(knownAsset(url))attach(event,assetWork(event,url));
});

function normalize(raw,base){
  const url=new URL(raw,base);
  if(legacyEntry(url))return CANONICAL_URL;
  const file=fileOf(url);
  if(file==='ventilation-guide-app.html')return APP_URL;
  if(file==='mechanical-ventilation-teaching-reference.html')return CANONICAL_URL;
  if(labNavigation(url))return LAB_URL;
  url.hash='';
  return url.href;
}

self.addEventListener('message',event=>{
  const data=event.data||{};

  if(data.type==='skip-waiting'||data.type==='SKIP_WAITING'){
    event.waitUntil(self.skipWaiting());
    return;
  }

  if(data.type==='get-version'||data.type==='GET_VERSION'){
    const payload={
      type:'vent-guide-version',
      build:BUILD,
      cache:CACHE_NAME,
      canonical:CANONICAL_URL,
      app:APP_URL
    };
    if(event.ports&&event.ports[0])event.ports[0].postMessage(payload);
    else if(event.source&&event.source.postMessage)event.source.postMessage(payload);
    return;
  }

  if(data.type==='warm-reader'){
    const raw=event.source&&event.source.url;
    event.waitUntil(warmReader(raw).then(saved=>{
      if(event.source&&event.source.postMessage)event.source.postMessage({type:'reader-cached',saved,build:BUILD});
    }));
    return;
  }

  if(data.type!=='prefetch'||!Array.isArray(data.urls))return;

  const id=data.id||null;
  const base=event.source&&event.source.url?event.source.url:self.registration.scope;
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const assets=await caches.open(ASSET_CACHE);
    const urls=[...new Set(data.urls.map(raw=>{
      try{
        const href=normalize(raw,base),url=new URL(href);
        if(url.origin!==SCOPE_URL.origin&&!knownAsset(url))return null;
        return href;
      }catch(_){return null;}
    }).filter(Boolean))];
    let ok=0,failed=0,cursor=0;
    const failures=[];
    async function next(){
      while(cursor<urls.length){
        const href=urls[cursor++],url=new URL(href);
        const target=guideNavigation(url)||labNavigation(url)||versionedMetadata(url)?cache:assets;
        try{
          /* Versioned math/fonts/figures already in cache need no redownload. */
          const existing=target===assets?await findCached(href):null;
          const response=existing||await fresh(href);
          if(!cacheable(response)||!await save(target,href,response,false))throw new Error('Unavailable');
          ok++;
        }catch(_){failed++;failures.push(href);}
      }
    }
    await Promise.all([next(),next(),next()]);

    const payload={
      type:'prefetch-done',
      id,
      ok,
      failed,
      total:urls.length,
      failures,
      build:BUILD
    };
    try{
      if(event.source&&event.source.postMessage)event.source.postMessage(payload);
    }catch(_){}
  })());
});
