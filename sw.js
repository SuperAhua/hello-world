/* 随手记 Service Worker
   目标：装到手机桌面后，断网也能打开；有网时静默更新。
   改完代码重新发布时，把 V 改一下（如 v2），旧缓存会在 activate 阶段清掉。 */
var V = 'v9';
var CACHE = 'shoujizhang-' + V;

var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './parser.js',
  './app.js',
  './vendor/echarts.min.js',
  './manifest.json',
  './favicon.png',
  './icon.ico',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 打开页面：先走网络拿最新版本；断网或服务端拒绝（如授权过期）时退回缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
          return res;
        }
        return caches.match('./index.html').then(function (hit) { return hit || res; });
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  // 静态资源：先用缓存（秒开），同时后台拉新版本
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
