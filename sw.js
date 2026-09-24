const CACHE_NAME="fuutai-sequential-v12-loop";
const APP_FILES=["./","./index.html","./manifest.webmanifest"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_FILES)));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 if(e.request.mode==="navigate"){
   e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{const x=r.clone();caches.open(CACHE_NAME).then(c=>c.put("./index.html",x));return r;}).catch(()=>caches.match("./index.html")));
   return;
 }
 e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});