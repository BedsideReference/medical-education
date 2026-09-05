/* Guide to Ventilation · bounded offline service worker · internal build v1.10.140 */
'use strict';

const BUILD='v1.10.140';
const CACHE_NAME=`ventilation-guide-core-${BUILD}`;
const FALLBACK_PREFIX='ventilation-guide-fallback-';
const LEGACY_ASSET_CACHE='ventilation-guide-assets-v1';
const LEGACY_FALLBACK_CACHE='ventilation-guide-readers-fallback-v1';
const SCOPE_URL=new URL(self.registration.scope);
const APP_URL=new URL('ventilation-guide-app.html',SCOPE_URL).href;
const CANONICAL_URL=new URL('mechanical-ventilation-teaching-reference.html',SCOPE_URL).href;
const INDEX_URL=new URL('index.html',SCOPE_URL);
const LAB_URL=new URL('ventilation_guide_CASE_LAB_v1_0.html',SCOPE_URL).href;
const VERSION_URL=new URL('ventilation-guide-version.json',SCOPE_URL).href;
const OFFLINE_MANIFEST_URL=new URL('.ventilation-guide-offline-manifest.json',SCOPE_URL).href;
const OFFLINE_MINIMUM_REQUIRED=[CANONICAL_URL,APP_URL,LAB_URL];

const SMALL_CORE=[
  'ventilation-guide-version.json',
  'manifest.webmanifest',
  'apple-touch-icon-v1-10-115.png',
  'icon-192-v1-10-115.png',
  'icon-512-v1-10-115.png',
  'favicon-32-v1-10-115.png',
  'og-card.png'
].map(name=>new URL(name,SCOPE_URL).href);

/*
 * Offline simulator contract:
 *   full        The standalone document is same-origin, explicitly saveable,
 *               verified, and served by this worker while offline.
 *   shell       The launch surface is part of a saved reader, but there is no
 *               separately cacheable standalone document to verify.
 *   online-only The interactive document is cross-origin and is never fetched,
 *               cached, verified, or intercepted by this worker.
 */
const OFFLINE_MODES=Object.freeze({
  full:'The document and every required subresource are versioned and controlled by the guide service worker.',
  shell:'Only the launch document is cached; the interface must disclose that some functions require a connection.',
  'online-only':'The URL is excluded from offline completeness and is labeled as requiring a connection.'
});
/* IDs and classifications mirror simulator-contract-v134.json. */
const SIMULATOR_CONTRACT=Object.freeze([
  Object.freeze({id:'abg-sim-iframe',label:'ABG acid-base simulator',url:'https://bedsidereference.github.io/medical-education/abg-acid-base-simulator.html',offline:'online-only'}),
  Object.freeze({id:'vent-sim-iframe',label:'Ventilator waveform simulator',url:'https://bedsidereference.github.io/medical-education/mechanical-ventilation-waveform-simulator.html',offline:'online-only'}),
  Object.freeze({id:'capno-sim-iframe',label:'Capnography simulator',url:'https://bedsidereference.github.io/medical-education/mechanical-ventilation-capnography-simulator.html',offline:'online-only'}),
  Object.freeze({id:'dys-explorer-iframe',label:'Dyssynchrony identifier',url:'https://bedsidereference.github.io/medical-education/dyssynchrony_identifier_v10.html',offline:'online-only'}),
  Object.freeze({id:'case-lab-iframe',label:'Case Lab',url:LAB_URL,offline:'full',required:[LAB_URL]})
]);

const APP_OFFLINE_HTML='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guide unavailable offline</title><style>body{font-family:system-ui;max-width:42rem;margin:auto;padding:2rem;line-height:1.5}</style><h1>Guide unavailable offline</h1><p>Reconnect once and open the mobile guide so this build can be saved.</p>';
const SIMULATOR_OFFLINE_HTML='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulator unavailable offline</title><style>body{font-family:system-ui;max-width:42rem;margin:auto;padding:2rem;line-height:1.5}</style><h1>Simulator unavailable offline</h1><p>Reconnect and save the guide for offline use to make this simulator available.</p>';

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

/* Only exact app landing URLs share the canonical reader fallback. */
function guideLanding(url){
  return url.origin===SCOPE_URL.origin&&
    (url.pathname===SCOPE_URL.pathname||url.pathname===INDEX_URL.pathname);
}

function guideNavigation(url){
  const file=fileOf(url);
  return url.origin===SCOPE_URL.origin&&(
    file==='ventilation-guide-app.html'||
    file==='mechanical-ventilation-teaching-reference.html'||
    guideLanding(url)||
    legacyEntry(url)
  );
}

function simulatorRecord(url){
  return SIMULATOR_CONTRACT.find(record=>{
    if(record.offline!=='full')return false;
    const target=new URL(record.url);
    return target.origin===url.origin&&target.pathname===url.pathname;
  })||null;
}

function fullSimulatorNavigation(url){
  return url.origin===SCOPE_URL.origin&&!!simulatorRecord(url);
}

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

function allowedOfflineUrl(url){
  if(!/^https?:$/.test(url.protocol))return false;
  if(url.origin!==SCOPE_URL.origin)return knownAsset(url);
  return guideNavigation(url)||fullSimulatorNavigation(url)||knownAsset(url);
}

function buildParts(value){
  const match=String(value).match(/v(\d+)\.(\d+)\.(\d+)/i);
  return match?[Number(match[1]),Number(match[2]),Number(match[3])]:[0,0,0];
}

function compareBuildsNewest(a,b){
  const left=buildParts(a),right=buildParts(b);
  for(let i=0;i<3;i++)if(left[i]!==right[i])return right[i]-left[i];
  return String(b).localeCompare(String(a));
}

function coreBuild(name){
  const match=String(name).match(/^ventilation-guide-(?:core-)?(v\d+\.\d+\.\d+)$/i);
  return match?match[1]:null;
}

function fallbackBuild(name){
  const match=String(name).match(/^ventilation-guide-fallback-(v\d+\.\d+\.\d+)$/i);
  return match?match[1]:null;
}

function managedCache(name){
  return !!coreBuild(name)||!!fallbackBuild(name)||name===LEGACY_ASSET_CACHE||name===LEGACY_FALLBACK_CACHE;
}

function fallbackName(build){
  return `${FALLBACK_PREFIX}${build}`;
}

async function fresh(url,signal){
  const target=new URL(url),same=target.origin===SCOPE_URL.origin;
  return fetch(new Request(target.href,{
    method:'GET',credentials:same?'same-origin':'omit',mode:same?'same-origin':'cors',
    cache:'no-store',signal,redirect:'follow'
  }));
}

async function revalidate(event,url){
  if(sameEntry(event.request,url)){
    try{const preloaded=await event.preloadResponse;if(preloaded)return preloaded;}catch(_){}
  }
  const target=new URL(url),same=target.origin===SCOPE_URL.origin;
  return fetch(new Request(target.href,{
    method:'GET',credentials:same?'same-origin':'omit',mode:same?'same-origin':'cors',
    cache:'no-cache',redirect:'follow'
  }));
}

async function save(cache,key,response,cloneResponse){
  if(!cacheable(response))return false;
  try{await cache.put(key,cloneResponse?response.clone():response);return true;}catch(_){return false;}
}

async function cacheSearchOrder(){
  const names=await caches.keys();
  const fallbacks=names.filter(name=>fallbackBuild(name)).sort(compareBuildsNewest);
  const oldCores=names.filter(name=>coreBuild(name)&&name!==CACHE_NAME).sort(compareBuildsNewest);
  return [CACHE_NAME].concat(fallbacks,oldCores,[LEGACY_FALLBACK_CACHE,LEGACY_ASSET_CACHE])
    .filter((name,index,list)=>names.includes(name)&&list.indexOf(name)===index);
}

async function findCached(key){
  let names;
  try{names=await cacheSearchOrder();}catch(_){return null;}
  for(const name of names){
    try{const response=await (await caches.open(name)).match(key,{ignoreSearch:true});if(response)return response;}catch(_){}
  }
  return null;
}

function normalize(raw,base){
  const url=new URL(raw,base);
  if(legacyEntry(url)||guideLanding(url))return CANONICAL_URL;
  const file=fileOf(url);
  if(file==='ventilation-guide-app.html')return APP_URL;
  if(file==='mechanical-ventilation-teaching-reference.html')return CANONICAL_URL;
  const simulator=simulatorRecord(url);
  if(simulator)return simulator.url;
  url.hash='';
  return url.href;
}

function normalizeAllowed(raw,base){
  try{
    const href=normalize(raw,base),url=new URL(href);
    return allowedOfflineUrl(url)?href:null;
  }catch(_){return null;}
}

async function readOfflineManifest(cacheName){
  try{
    const response=await (await caches.open(cacheName)).match(OFFLINE_MANIFEST_URL);
    if(!response)return null;
    const manifest=await response.json();
    const expected=coreBuild(cacheName)||fallbackBuild(cacheName);
    return manifest&&manifest.schema===1&&manifest.complete===true&&
      Array.isArray(manifest.urls)&&(!expected||manifest.build===expected)?manifest:null;
  }catch(_){return null;}
}

async function writeOfflineManifest(cache,requiredUrls,optionalUrls){
  const manifest={
    schema:1,build:BUILD,complete:true,savedAt:new Date().toISOString(),
    requiredUrls:[...requiredUrls],optionalUrls:[...optionalUrls],
    urls:[...new Set(requiredUrls.concat(optionalUrls))],simulators:SIMULATOR_CONTRACT
  };
  await cache.put(OFFLINE_MANIFEST_URL,new Response(JSON.stringify(manifest),{
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  }));
  return manifest;
}

async function copyCache(sourceName,targetName,options){
  if(sourceName===targetName)return true;
  const source=await caches.open(sourceName),target=await caches.open(targetName);
  const manifest=options.manifestOnly?await readOfflineManifest(sourceName):null;
  const keys=manifest
    ?manifest.urls.concat([OFFLINE_MANIFEST_URL])
    :await source.keys();
  const required=manifest?new Set(manifest.requiredUrls||[]):null;
  for(const key of keys){
    const request=typeof key==='string'?key:key.url;
    const response=await source.match(key,{ignoreSearch:true});
    if(!cacheable(response)){
      if(required&&required.has(request))throw new Error('Incomplete fallback source: '+request);
      continue;
    }
    if(!options.overwrite&&await target.match(request,{ignoreSearch:true}))continue;
    await target.put(request,response);
  }
  return true;
}

async function chooseFallback(names){
  const priorCores=names.filter(name=>coreBuild(name)&&name!==CACHE_NAME).sort(compareBuildsNewest);
  const priorFallbacks=names.filter(name=>fallbackBuild(name)).sort(compareBuildsNewest);
  const completed=[];
  for(const name of priorCores.concat(priorFallbacks)){
    if(await readOfflineManifest(name))completed.push(name);
  }
  /* A versioned fallback is already a vetted, transactionally copied set.
     Compare it with completed cores by version; never regress to an older
     manifest merely because the newer fallback predates manifest support. */
  const vetted=[...new Set(completed.concat(priorFallbacks))].sort(compareBuildsNewest);
  if(vetted.length){
    const primary=vetted[0],manifestOnly=completed.includes(primary);
    return {build:coreBuild(primary)||fallbackBuild(primary),primary,manifestOnly,legacy:false};
  }
  if(priorCores.length){
    return {build:coreBuild(priorCores[0]),primary:priorCores[0],manifestOnly:false,legacy:true};
  }
  if(names.includes(LEGACY_FALLBACK_CACHE)||names.includes(LEGACY_ASSET_CACHE)){
    return {build:'v0.0.0',primary:names.includes(LEGACY_FALLBACK_CACHE)?LEGACY_FALLBACK_CACHE:LEGACY_ASSET_CACHE,manifestOnly:false,legacy:true};
  }
  return null;
}

/*
 * Keep one current generation and one fallback generation. Pruning is
 * transactional with respect to copy errors: source caches are only removed
 * after the current build anchor is present and the fallback copy completes.
 * v1.10.133's unversioned asset/reader caches are folded into the first fallback.
 */
let maintenancePromise=null;
function maintainCacheGenerations(){
  if(maintenancePromise)return maintenancePromise;
  maintenancePromise=(async()=>{
    const current=await caches.open(CACHE_NAME);
    if(!await current.match(VERSION_URL,{ignoreSearch:true}))return {ok:false,reason:'current-unverified'};
    const before=await caches.keys(),choice=await chooseFallback(before);
    let target=null,targetExisted=false;
    if(choice){
      target=fallbackName(choice.build);targetExisted=before.includes(target);
      try{
        await copyCache(choice.primary,target,{manifestOnly:choice.manifestOnly,overwrite:true});
        if(choice.legacy){
          for(const legacyName of [LEGACY_FALLBACK_CACHE,LEGACY_ASSET_CACHE]){
            if(before.includes(legacyName)&&legacyName!==choice.primary){
              await copyCache(legacyName,target,{manifestOnly:false,overwrite:false});
            }
          }
        }
      }catch(error){
        if(!targetExisted)try{await caches.delete(target);}catch(_){}
        return {ok:false,reason:'fallback-copy-failed',error:String(error&&error.message||error)};
      }
    }
    const keep=new Set([CACHE_NAME]);if(target)keep.add(target);
    const deleted=[];
    for(const name of before){
      if(managedCache(name)&&!keep.has(name)){
        try{if(await caches.delete(name))deleted.push(name);}catch(_){}
      }
    }
    return {ok:true,current:CACHE_NAME,fallback:target,deleted};
  })().catch(error=>({ok:false,reason:'maintenance-failed',error:String(error&&error.message||error)}));
  return maintenancePromise;
}

/* The initially opened HTML predates worker control. Cache that exact reader. */
const readerWarmups=new Map();
function warmReader(raw){
  let url;
  try{url=new URL(raw,SCOPE_URL);}catch(_){return Promise.resolve(false);}
  if(!guideNavigation(url)&&!fullSimulatorNavigation(url))return Promise.resolve(false);
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
    const requested=new URL(request.url),intended=new URL(target);
    return requested.origin===intended.origin&&requested.pathname===intended.pathname;
  }catch(_){return false;}
}

async function preloadOrFresh(event,url){
  if(sameEntry(event.request,url)){
    try{const preloaded=await event.preloadResponse;if(preloaded)return preloaded;}catch(_){}
  }
  return fresh(url);
}

function discardPreloadPromise(event){
  return Promise.resolve(event.preloadResponse).then(response=>{
    if(response&&response.body&&typeof response.body.cancel==='function')return response.body.cancel();
  }).catch(()=>{});
}

function attach(event,work){
  const task=Promise.resolve(work);
  event.respondWith(task.then(result=>result.response));
  event.waitUntil(task.then(result=>result.done).catch(()=>{}));
}

async function refreshEntry(event,cache,url,key){
  try{
    const response=await revalidate(event,url);
    return cacheable(response)&&await save(cache,key,response,false);
  }catch(_){return false;}
}

async function entryWork(event,url,key){
  let cache;
  try{cache=await caches.open(CACHE_NAME);}catch(_){
    try{return {response:await preloadOrFresh(event,url),done:Promise.resolve()};}
    catch(__){return {response:null,done:Promise.resolve()};}
  }
  try{
    const current=await cache.match(key,{ignoreSearch:true});
    if(current)return {response:current,done:refreshEntry(event,cache,url,key)};
  }catch(_){}
  try{
    const response=await preloadOrFresh(event,url);
    if(!cacheable(response))return {response:await findCached(key)||response,done:Promise.resolve()};
    return {response,done:save(cache,key,response.clone(),false)};
  }catch(_){return {response:await findCached(key),done:Promise.resolve()};}
}

async function appNavigationWork(event){
  const result=await entryWork(event,APP_URL,APP_URL);
  if(result.response)return result;
  return {response:new Response(APP_OFFLINE_HTML,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}),done:result.done};
}

function deviceAwareOfflineFallback(){
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guide unavailable offline</title><style>body{font-family:system-ui;max-width:42rem;margin:auto;padding:2rem;line-height:1.5}</style><script>(function(){var ua=navigator.userAgent||"",uad=navigator.userAgentData,p=(uad&&uad.mobile===true)||/iPhone|iPod|IEMobile|Windows Phone|webOS|BlackBerry|Opera Mini/i.test(ua)||(/Android/i.test(ua)&&/Mobile/i.test(ua));if(p)location.replace("ventilation-guide-app.html"+location.search+location.hash);})();<\/script><h1>Guide unavailable offline</h1><p>Reconnect once and open the guide so the continuous desktop edition can be saved on this device.</p>',{
    status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}
  });
}

async function canonicalNavigationWork(event,url){
  if(legacyEntry(url))return {response:Response.redirect(CANONICAL_URL,302),done:discardPreloadPromise(event)};
  const result=await entryWork(event,CANONICAL_URL,CANONICAL_URL);
  return result.response?result:{response:deviceAwareOfflineFallback(),done:result.done};
}

async function simulatorNavigationWork(event,url){
  const record=simulatorRecord(url),key=record&&record.url;
  if(!key)return {response:null,done:Promise.resolve()};
  const result=await entryWork(event,key,key);
  if(result.response)return result;
  return {response:new Response(SIMULATOR_OFFLINE_HTML,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}),done:result.done};
}

async function metadataWork(event,url){
  let cache;
  try{cache=await caches.open(CACHE_NAME);}catch(_){
    try{return {response:await fresh(url.href),done:Promise.resolve()};}
    catch(__){return {response:new Response('',{status:504,statusText:'Offline'}),done:Promise.resolve()};}
  }
  try{
    const response=await fresh(url.href);
    if(cacheable(response))return {response,done:save(cache,event.request,response.clone(),false)};
    return {response:await findCached(event.request)||response,done:Promise.resolve()};
  }catch(_){
    return {response:await findCached(event.request)||new Response('',{status:504,statusText:'Offline'}),done:Promise.resolve()};
  }
}

async function assetWork(event,url){
  if(versionedMetadata(url))return metadataWork(event,url);
  let cache;
  try{cache=await caches.open(CACHE_NAME);}catch(_){
    try{return {response:await fetch(event.request),done:Promise.resolve()};}
    catch(__){return {response:new Response('',{status:504,statusText:'Offline'}),done:Promise.resolve()};}
  }
  try{const current=await cache.match(event.request,{ignoreSearch:true});if(current)return {response:current,done:Promise.resolve()};}catch(_){}
  const older=await findCached(event.request);
  if(older)return {response:older,done:cacheable(older)?save(cache,event.request,older.clone(),false):Promise.resolve()};
  try{
    const response=await fetch(event.request);
    return {response,done:cacheable(response)?save(cache,event.request,response.clone(),false):Promise.resolve()};
  }catch(_){return {response:new Response('',{status:504,statusText:'Offline'}),done:Promise.resolve()};}
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try{
      const cache=await caches.open(CACHE_NAME);
      await Promise.all(SMALL_CORE.map(async url=>{try{await save(cache,url,await fresh(url),false);}catch(_){}}));
    }catch(_){}
    /* First install has no incumbent worker. Updates remain waiting until the
       visible update UI sends SKIP_WAITING, preventing surprise mid-session
       controller replacement. */
    if(!self.registration.active)await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    try{if(self.registration.navigationPreload)await self.registration.navigationPreload.enable();}catch(_){}
    await self.clients.claim();
    const maintenance=maintainCacheGenerations();
    try{
      const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      await Promise.all(clients.map(client=>warmReader(client.url)));
    }catch(_){}
    await maintenance;
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  let url;try{url=new URL(request.url);}catch(_){return;}
  if(!/^https?:$/.test(url.protocol))return;

  if(request.mode==='navigate'&&fullSimulatorNavigation(url)){
    attach(event,simulatorNavigationWork(event,url));return;
  }
  if(request.mode==='navigate'&&guideNavigation(url)){
    attach(event,fileOf(url)==='ventilation-guide-app.html'?appNavigationWork(event):canonicalNavigationWork(event,url));return;
  }
  if(knownAsset(url))attach(event,assetWork(event,url));
});

const OFFLINE_FILE_TIMEOUT=90000;
const OFFLINE_JOB_TIMEOUT=600000;
function offlineWithin(task,ms,onTimeout){
  let timer;
  return Promise.race([
    task,
    new Promise((_,reject)=>{timer=setTimeout(()=>{if(onTimeout)onTimeout();const error=new Error('Timed out');error.name='TimeoutError';reject(error);},Math.max(1,ms));})
  ]).finally(()=>clearTimeout(timer));
}

function offlineReply(event,payload){
  try{
    if(event.ports&&event.ports[0])event.ports[0].postMessage(payload);
    else if(event.source&&event.source.postMessage)event.source.postMessage(payload);
  }catch(_){}
}

function offlineReason(error){
  if(error&&error.name==='QuotaExceededError')return 'storage-full';
  if(error&&(error.name==='TimeoutError'||error.name==='AbortError'))return 'timeout';
  return String(error&&error.message||'Unavailable');
}

async function cachedIn(cacheNames,href){
  for(const name of cacheNames){
    try{if(await (await caches.open(name)).match(href,{ignoreSearch:true}))return true;}catch(_){}
  }
  return false;
}

async function verifyOffline(event,data){
  const id=data.id||null,base=event.source&&event.source.url?event.source.url:self.registration.scope;
  const supplied=Array.isArray(data.urls)?data.urls:[];
  function candidate(raw){
    try{
      const url=new URL(raw,base);if(!/^https?:$/.test(url.protocol))return null;
      const href=normalize(url.href,base);
      return {href,allowed:allowedOfflineUrl(new URL(href))};
    }catch(_){return null;}
  }
  const entries=[];
  for(const raw of supplied){
    const item=candidate(raw);if(item&&!entries.some(entry=>entry.href===item.href))entries.push(item);
  }
  const optionalSet=new Set((Array.isArray(data.optionalUrls)?data.optionalUrls:[]).map(candidate).filter(Boolean).map(item=>item.href));
  const required=entries.filter(item=>!optionalSet.has(item.href)),optional=entries.filter(item=>optionalSet.has(item.href));
  const payload={
    type:'offline-verification',id,build:BUILD,
    requiredTotal:required.length,requiredReady:0,optionalTotal:optional.length,optionalReady:0,
    complete:false,missing:[],offlineModes:OFFLINE_MODES,simulators:SIMULATOR_CONTRACT
  };
  try{
    const names=await cacheSearchOrder();
    for(const item of required){if(item.allowed&&await cachedIn(names,item.href))payload.requiredReady++;else payload.missing.push(item.href);}
    for(const item of optional){if(item.allowed&&await cachedIn(names,item.href))payload.optionalReady++;else payload.missing.push(item.href);}
    payload.complete=payload.requiredReady===payload.requiredTotal;
  }catch(error){
    payload.error='storage-unavailable';payload.missing=required.concat(optional).map(item=>item.href);
  }
  offlineReply(event,payload);
  return payload;
}

async function prefetchOffline(event,data){
  const id=data.id||null,base=event.source&&event.source.url?event.source.url:self.registration.scope;
  const supplied=Array.isArray(data.urls)?data.urls:[];
  /* A caller cannot accidentally create a "complete" marker without both
     reader editions and every full-offline standalone simulator. */
  const urls=[...new Set(supplied.map(raw=>normalizeAllowed(raw,base)).filter(Boolean).concat(OFFLINE_MINIMUM_REQUIRED))];
  const optional=new Set((Array.isArray(data.optionalUrls)?data.optionalUrls:[]).map(raw=>normalizeAllowed(raw,base)).filter(Boolean));
  OFFLINE_MINIMUM_REQUIRED.forEach(href=>optional.delete(href));
  let ok=0,failed=0,cursor=0,requiredFailed=0,optionalFailed=0;
  const failures=[],optionalFailures=[],failureDetails=[];
  const deadline=Date.now()+OFFLINE_JOB_TIMEOUT;
  function recordFailure(href,reason){
    failed++;failures.push(href);failureDetails.push({url:href,reason});
    if(optional.has(href)){optionalFailed++;optionalFailures.push(href);}else requiredFailed++;
  }
  function progress(){offlineReply(event,{type:'prefetch-progress',id,ok,failed,total:urls.length,build:BUILD});}
  function done(error,complete){offlineReply(event,{
    type:'prefetch-done',id,ok,failed,total:urls.length,failures,
    requiredFailed,optionalFailed,optionalFailures,failureDetails,build:BUILD,
    complete:complete===true,error:error||null
  });}
  progress();
  let cache;
  try{cache=await offlineWithin(caches.open(CACHE_NAME),OFFLINE_FILE_TIMEOUT);}catch(error){
    const reason=offlineReason(error);urls.forEach(href=>recordFailure(href,reason));
    done(reason==='storage-full'?reason:'storage-unavailable',false);return;
  }
  progress();
  async function next(){
    while(cursor<urls.length){
      const href=urls[cursor++],left=deadline-Date.now();
      if(left<=0){recordFailure(href,'timeout');continue;}
      const controller=typeof AbortController==='function'?new AbortController():null;
      try{
        await offlineWithin((async()=>{
          const current=await cache.match(href,{ignoreSearch:true});if(cacheable(current))return;
          const existing=await findCached(href);
          const response=existing||await fresh(href,controller?controller.signal:undefined);
          if(!cacheable(response))throw new Error('HTTP '+(response&&response.status||0));
          await cache.put(href,response);
        })(),Math.min(OFFLINE_FILE_TIMEOUT,left),()=>{if(controller)controller.abort();});
        ok++;
      }catch(error){recordFailure(href,offlineReason(error));}
      progress();
    }
  }
  await Promise.all([next(),next(),next()]);
  let complete=requiredFailed===0,completionError=null;
  if(complete){
    const required=urls.filter(href=>!optional.has(href)),optionalUrls=urls.filter(href=>optional.has(href));
    try{await writeOfflineManifest(cache,required,optionalUrls);}catch(error){
      complete=false;completionError='manifest-'+offlineReason(error);
    }
  }
  done(completionError,complete);
}

self.addEventListener('message',event=>{
  const data=event.data||{};
  if(data.type==='skip-waiting'||data.type==='SKIP_WAITING'){event.waitUntil(self.skipWaiting());return;}
  if(data.type==='get-version'||data.type==='GET_VERSION'){
    offlineReply(event,{type:'vent-guide-version',build:BUILD,cache:CACHE_NAME,canonical:CANONICAL_URL,app:APP_URL,offlineModes:OFFLINE_MODES,simulators:SIMULATOR_CONTRACT});return;
  }
  if(data.type==='get-offline-contract'){
    offlineReply(event,{type:'offline-contract',id:data.id||null,build:BUILD,modes:OFFLINE_MODES,simulators:SIMULATOR_CONTRACT});return;
  }
  if(data.type==='warm-reader'){
    const raw=event.source&&event.source.url;
    event.waitUntil(warmReader(raw).then(saved=>offlineReply(event,{type:'reader-cached',saved,build:BUILD})));return;
  }
  if(data.type==='verify-offline'){
    event.waitUntil(verifyOffline(event,data));return;
  }
  if(data.type==='prefetch'&&Array.isArray(data.urls))event.waitUntil(prefetchOffline(event,data));
});
