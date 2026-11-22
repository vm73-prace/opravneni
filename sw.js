// Cachuje jen shell appky. Data (Supabase) a PDF/fotky se necachují.
// Verzi zvyšuj spolu s VERZE v app.js.
var CACHE = 'opravneni-v10';
var SHELL = ['./', 'index.html', 'app.css', 'app.js', 'calc.js', 'demo.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase a CDN jdou přímo na síť
  // Síť první (aby se nová verze projevila hned), cache jako záloha offline
  e.respondWith(fetch(e.request).then(function (r) {
    if (r.ok && SHELL.indexOf(url.pathname.split('/').pop() || './') >= 0) {
      var kopie = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, kopie); });
    }
    return r;
  }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
});
