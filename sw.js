const CACHE="fuutai-offline-v1";
const ASSETS=["./","./index.html","./manifest.webmanifest"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(self.clients.claim());});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
  const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return res;
 }).catch(()=>caches.match("./index.html"))));
});