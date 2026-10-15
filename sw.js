// オフライン用キャッシュ。アプリのファイルを更新したら VERSION を上げる。
const VERSION = 'v2';
const CACHE = `pocket-editor-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'syntax.js',
  'runner.js',
  'workers/python-worker.js',
  'workers/js-worker.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PYODIDE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pyodide（バージョン付き URL なので中身は不変）はキャッシュ優先で保存し、オフラインでも Python を動かす
const PYODIDE_CACHE = 'pocket-editor-pyodide';
const PYODIDE_PREFIX = 'https://cdn.jsdelivr.net/pyodide/';

function pyodideFetch(request) {
  return caches.open(PYODIDE_CACHE).then((cache) => cache.match(request).then((hit) => {
    if (hit) return hit;
    return fetch(request).then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    });
  }));
}

// アプリ本体はネットワーク優先、失敗したらキャッシュ（更新がすぐ反映され、オフラインでも動く）
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.url.startsWith(PYODIDE_PREFIX)) {
    event.respondWith(pyodideFetch(request));
    return;
  }
  if (new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || caches.match('index.html'))),
  );
});
