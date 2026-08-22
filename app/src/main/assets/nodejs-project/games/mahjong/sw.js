/**
 * 万能麻将 - Service Worker
 * 缓存静态资源，支持离线运行
 */
const CACHE_NAME = 'mahjong-v20';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/tiles/red-dragon.svg',
  './assets/ui/icons.svg',
  './css/main.css',
  './css/themes.css',
  './css/game.css',
  './css/animations.css',
  './css/ui-overhaul.css',
  './js/main.js',
  './js/utils/helpers.js',
  './js/core/tiles.js',
  './js/core/rules.js',
  './js/core/player.js',
  './js/core/engine.js',
  './js/ai/ai-utils.js',
  './js/ai/ai-player.js',
  './js/network/p2p.js',
  './js/data/storage.js',
  './js/data/stats.js',
  './js/data/replay.js',
  './js/audio/audio-manager.js',
  './js/ui/components.js',
  './js/app/event-bus.js',
  './js/app/game-renderer.js',
  './js/app/game-input.js',
  './js/app/event-bindings.js',
  './js/app/engine-events.js',
  './js/app/game-result.js',
  './js/app/settings-ui.js',
  './js/app/menu-ui.js',
  './js/app/network-ui.js',
  './js/app/stats-ui.js',
  './js/app/replay-ui.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request)).catch(() => {
      if (e.request.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    })
  );
});
